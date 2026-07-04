import { createReadStream, existsSync, readdirSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { estimateTokens, formatNumber, readSessionRows } from "./core.js";

// Snippet cap used for the counterfactual estimate: "what if this read had
// been returned as a capped snippet instead of in full". Matches the hook's
// default pack snippet budget order of magnitude.
export const AUDIT_SNIPPET_LINE_CAP = 80;

// Claude Code stores transcripts under ~/.claude/projects/<munged-cwd>/,
// where the cwd path has every separator replaced with "-".
export function resolveTranscriptDir(cwd, home = homedir()) {
  const munged = cwd.split(sep).join("-");
  return join(home, ".claude", "projects", munged);
}

// Bash commands that fetch file content into context. Search intent wins over
// viewing intent ("cat x | grep y" is a search), and only pipe-free viewing
// commands count as views. `ls` and other existence checks are ignored (#90).
export function classifyBashCommand(command) {
  const cmd = String(command || "");
  if (/(^|[|;&]\s*)(rg|grep|egrep|fgrep|find)\b/.test(cmd)) {
    return "search";
  }
  if (/^\s*(cat|head|tail|less|more)\b[^|]*$/.test(cmd)) {
    return "view";
  }
  if (/^\s*sed\s+-n\b[^|]*$/.test(cmd) || /^\s*awk\b[^|]*$/.test(cmd)) {
    return "view";
  }
  return "other";
}

const MCP_TOOL_PREFIX = "mcp__token-ops__";

// The four MCP tools token-ops exposes (mcp/server.js). Used to tell a
// "compliant" MCP call (agent used token-ops) from any other MCP tool.
export const TOKEN_OPS_MCP_TOOLS = new Set([
  "build_compact_context",
  "estimate_context_cost",
  "list_high_cost_files",
  "report_saved_tokens"
]);

// A tool label references token-ops if it names the server or one of its tools,
// whatever prefixing scheme the client uses (bare, "mcp__token-ops__x",
// "token-ops__x", ...).
function isTokenOpsMcp(name) {
  const label = String(name || "");
  if (label.includes("token-ops") || label.includes("token_ops")) {
    return true;
  }
  for (const tool of TOKEN_OPS_MCP_TOOLS) {
    if (label.includes(tool)) {
      return true;
    }
  }
  return false;
}

// First string-valued field that plausibly names an MCP tool/server in a
// Cursor beforeMCPExecution payload (schema varies; probe the likely keys).
function mcpToolName(payload) {
  for (const key of ["tool_name", "name", "tool", "server_name", "server"]) {
    if (typeof payload[key] === "string" && payload[key]) {
      return payload[key];
    }
  }
  return "mcp";
}

// Turn a raw Cursor/Codex hook stdin payload into a metadata-only observe
// record: { event, tool, kind, bytes, tokens }. NEVER returns file contents or
// command text — only the event name, a coarse kind, a tool label, and
// size/token counts. Pure and defensive: any malformed field degrades to
// "other"/0 and it never throws. Returns null when there is nothing to record.
export function extractObserveEvent(client, input) {
  const payload = input && typeof input === "object" ? input : {};
  if (client === "cursor") {
    return extractCursorObserveEvent(payload);
  }
  if (client === "codex") {
    return extractCodexObserveEvent(payload);
  }
  return null;
}

function extractCursorObserveEvent(payload) {
  const event = String(payload.hook_event_name || "");
  if (event === "beforeReadFile") {
    // content is present in the payload but is used only to derive a size — it
    // is estimated and then discarded, never stored.
    const content = typeof payload.content === "string" ? payload.content : "";
    return { event, tool: "read", kind: "read", bytes: content.length, tokens: estimateTokens(content) };
  }
  if (event === "beforeShellExecution") {
    const command = payload.command || (payload.tool_input && payload.tool_input.command) || payload.shell_command;
    const kind = classifyBashCommand(command); // search | view | other — command text is discarded
    return { event, tool: "shell", kind, bytes: 0, tokens: 0 };
  }
  if (event === "beforeMCPExecution") {
    const tool = mcpToolName(payload);
    return { event, tool, kind: isTokenOpsMcp(tool) ? "mcp" : "other", bytes: 0, tokens: 0 };
  }
  return null;
}

function extractCodexObserveEvent(payload) {
  const event = String(payload.hook_event_name || "PostToolUse");
  const toolName = String(payload.tool_name || "");
  // A real PostToolUse always names a tool; an empty payload is malformed —
  // record nothing rather than log noise.
  if (!toolName) {
    return null;
  }
  // PostToolUse carries the tool result; size it for a token estimate, discard text.
  const response = resultText(payload.tool_response);
  const bytes = response.length;
  const tokens = estimateTokens(response);

  if (isTokenOpsMcp(toolName)) {
    return { event, tool: toolName, kind: "mcp", bytes, tokens };
  }
  const lower = toolName.toLowerCase();
  if (lower === "bash" || lower === "shell" || lower.includes("exec")) {
    const command = payload.tool_input && payload.tool_input.command;
    const kind = classifyBashCommand(command); // search | view | other
    return { event, tool: toolName || "shell", kind, bytes, tokens };
  }
  if (lower === "read" || lower === "readfile" || lower.includes("read_file")) {
    return { event, tool: toolName, kind: "read", bytes, tokens };
  }
  return { event, tool: toolName || "other", kind: "other", bytes, tokens };
}

function emptyObserveClientStats() {
  return {
    reads: { calls: 0, tokens: 0 },
    searches: { calls: 0, tokens: 0 },
    mcp: { calls: 0, tokens: 0, byTool: {} },
    other: { calls: 0 }
  };
}

// Bucket observe rows (type "observe") from the session log into per-client
// { reads, searches, mcp, other } stats — the same shape the Claude audit uses,
// so Cn/Ct is computed identically. Read/view fold into reads; anything not a
// fetch or a token-ops MCP call lands in "other" and is excluded from Cn/Ct.
export function aggregateObserveStats(rows) {
  const byClient = {};
  for (const row of rows) {
    if (!row || row.type !== "observe") {
      continue;
    }
    const client = row.client === "cursor" || row.client === "codex" ? row.client : null;
    if (!client) {
      continue;
    }
    const stats = byClient[client] || (byClient[client] = emptyObserveClientStats());
    const tokens = Number(row.tokens || 0);
    if (row.kind === "read" || row.kind === "view") {
      stats.reads.calls += 1;
      stats.reads.tokens += tokens;
    } else if (row.kind === "search") {
      stats.searches.calls += 1;
      stats.searches.tokens += tokens;
    } else if (row.kind === "mcp") {
      stats.mcp.calls += 1;
      stats.mcp.tokens += tokens;
      if (row.tool) {
        stats.mcp.byTool[row.tool] = (stats.mcp.byTool[row.tool] || 0) + 1;
      }
    } else {
      stats.other.calls += 1;
    }
  }
  return byClient;
}

function emptyStats() {
  return {
    files: 0,
    lines: 0,
    unparseableLines: 0,
    reads: { builtinCalls: 0, bashViewCalls: 0, tokens: 0, cappedTokens: 0 },
    searches: { grepCalls: 0, globCalls: 0, bashSearchCalls: 0, tokens: 0 },
    mcp: { calls: 0, tokens: 0, byTool: {} },
    // Read tool_use events ({ timestamp, filePath }) for the hook-delivery
    // metrics — paths only, file contents are never kept.
    readEvents: []
  };
}

// Extract only size/line-count from a tool_result without retaining content.
function resultText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item) => item && item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n");
  }
  return "";
}

function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      lines += 1;
    }
  }
  return lines;
}

// Streams one transcript JSONL file and accumulates into stats. Pending map
// links tool_use ids to their category so the later tool_result line can be
// token-counted. Read-only; prompt text and file contents are never kept.
export function auditTranscriptFile(path, stats) {
  return new Promise((resolveFn, reject) => {
    const pending = new Map();
    const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });

    rl.on("line", (line) => {
      stats.lines += 1;
      if (!line.trim()) {
        return;
      }
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        stats.unparseableLines += 1;
        return;
      }

      const content = row && row.message && Array.isArray(row.message.content) ? row.message.content : [];

      if (row.type === "assistant") {
        for (const block of content) {
          if (!block || block.type !== "tool_use") {
            continue;
          }
          if (block.name === "Read") {
            stats.reads.builtinCalls += 1;
            pending.set(block.id, "read");
            if (typeof row.timestamp === "string" && block.input && typeof block.input.file_path === "string") {
              stats.readEvents.push({ timestamp: row.timestamp, filePath: block.input.file_path });
            }
          } else if (block.name === "Grep") {
            stats.searches.grepCalls += 1;
            pending.set(block.id, "search");
          } else if (block.name === "Glob") {
            stats.searches.globCalls += 1;
            pending.set(block.id, "search");
          } else if (block.name === "Bash") {
            const kind = classifyBashCommand(block.input && block.input.command);
            if (kind === "view") {
              stats.reads.bashViewCalls += 1;
              pending.set(block.id, "read");
            } else if (kind === "search") {
              stats.searches.bashSearchCalls += 1;
              pending.set(block.id, "search");
            }
          } else if (typeof block.name === "string" && block.name.startsWith(MCP_TOOL_PREFIX)) {
            const tool = block.name.slice(MCP_TOOL_PREFIX.length);
            stats.mcp.calls += 1;
            stats.mcp.byTool[tool] = (stats.mcp.byTool[tool] || 0) + 1;
            pending.set(block.id, "mcp");
          }
        }
        return;
      }

      if (row.type === "user") {
        for (const block of content) {
          if (!block || block.type !== "tool_result") {
            continue;
          }
          const kind = pending.get(block.tool_use_id);
          if (!kind) {
            continue;
          }
          pending.delete(block.tool_use_id);
          const text = resultText(block.content);
          const tokens = estimateTokens(text);
          if (kind === "read") {
            stats.reads.tokens += tokens;
            const lines = countLines(text);
            const ratio = lines > AUDIT_SNIPPET_LINE_CAP ? AUDIT_SNIPPET_LINE_CAP / lines : 1;
            stats.reads.cappedTokens += Math.round(tokens * ratio);
          } else if (kind === "search") {
            stats.searches.tokens += tokens;
          } else {
            stats.mcp.tokens += tokens;
          }
        }
      }
    });

    rl.on("close", () => {
      stats.files += 1;
      resolveFn(stats);
    });
    rl.on("error", reject);
  });
}

// Hook-path effectiveness: Cn/Ct only count MCP calls, so they cannot see the
// hook route (an injected pack never registers as a tool call). These metrics
// measure what the hook is supposed to change instead — whether Reads happen
// at all, and whether they re-fetch files whose excerpts the preceding pack
// already delivered. Reads before the first firing are not attributable to
// any pack and are excluded. Covers the Read tool only; bash viewing has no
// reliable single file path.
export function computeHookDelivery(sessionRows, readEvents, cwd) {
  const firings = (sessionRows || [])
    .filter((row) => row && row.type === "hook" && typeof row.timestamp === "string" && Array.isArray(row.files))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

  const result = { firings: firings.length, reads: 0, coveredReads: 0, readsPerFiring: 0, coveredReadRate: 0 };
  if (firings.length === 0) {
    return result;
  }

  // Reads record the absolute path Claude used; firings record repo-relative
  // paths. Strip both the given cwd and its resolved form (macOS /var vs
  // /private/var).
  const prefixes = new Set([`${cwd}/`]);
  try {
    prefixes.add(`${realpathSync(cwd)}/`);
  } catch {
    // cwd itself came from process.cwd(), so resolution failure just means
    // no second prefix to strip.
  }

  for (const read of readEvents || []) {
    if (!read || typeof read.timestamp !== "string" || typeof read.filePath !== "string") {
      continue;
    }
    let latest = null;
    for (const firing of firings) {
      if (firing.timestamp <= read.timestamp) {
        latest = firing;
      } else {
        break;
      }
    }
    if (!latest) {
      continue;
    }
    result.reads += 1;
    let relative = read.filePath;
    for (const prefix of prefixes) {
      if (relative.startsWith(prefix)) {
        relative = relative.slice(prefix.length);
        break;
      }
    }
    if (latest.files.includes(relative)) {
      result.coveredReads += 1;
    }
  }

  result.readsPerFiring = Math.round((result.reads / firings.length) * 100) / 100;
  result.coveredReadRate = result.reads > 0 ? Math.round((result.coveredReads / result.reads) * 100) : 0;
  return result;
}

export async function runAudit(cwd, home = homedir()) {
  const dir = resolveTranscriptDir(cwd, home);
  const stats = emptyStats();
  const sessionRows = readSessionRows(cwd);
  // Cursor/Codex have no transcripts; their compliance comes from observe-hook
  // rows in this project's .token-ops/session.jsonl (read through the symlink guard).
  const observe = aggregateObserveStats(sessionRows);
  if (!existsSync(dir)) {
    return { stats, dir, found: false, observe, hookDelivery: computeHookDelivery(sessionRows, [], cwd) };
  }
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  for (const name of files) {
    await auditTranscriptFile(join(dir, name), stats);
  }
  const hookDelivery = computeHookDelivery(sessionRows, stats.readEvents, cwd);
  return { stats, dir, found: true, observe, hookDelivery };
}

export function renderAuditReport({ stats, dir, found, observe = {}, hookDelivery }, lang = "en") {
  const claude = renderClaudeAuditSection({ stats, dir, found }, lang);
  const hookSection = renderHookDeliverySection(hookDelivery, lang);
  const observeSections = renderObserveSections(observe, lang);
  return [claude, ...hookSection, ...observeSections].join("\n\n");
}

// Rendered only when hook firings exist — a project without the Claude hook
// installed sees the same report as before. All figures are measured counts;
// the covered-read rate tells how often the agent re-fetched a file whose
// excerpt the preceding pack had already delivered.
function renderHookDeliverySection(hookDelivery, lang) {
  if (!hookDelivery || hookDelivery.firings === 0) {
    return [];
  }
  const d = hookDelivery;
  if (lang === "ja") {
    return [[
      "## フック配送の実効(実測)",
      `- 発火: ${formatNumber(d.firings)}回 / 発火後のRead: ${formatNumber(d.reads)}回(${d.readsPerFiring}回/発火)`,
      `- 収載ファイル再読率: ${d.coveredReadRate}%(直前パックに抜粋を収載済みのファイルへのRead ${formatNumber(d.coveredReads)}回)`,
      "- 注: Cn/CtはMCP呼び出しのみを数えるため、フック経路の実効はこの2指標で見る"
    ].join("\n")];
  }
  return [[
    "## Hook delivery effectiveness (measured)",
    `- Firings: ${formatNumber(d.firings)} / Reads after a firing: ${formatNumber(d.reads)} (${d.readsPerFiring} per firing)`,
    `- Covered-read rate: ${d.coveredReadRate}% (${formatNumber(d.coveredReads)} Reads of files whose excerpt the preceding pack already delivered)`,
    "- Note: Cn/Ct only count MCP calls; these two figures are the ones that reflect the hook route"
  ].join("\n")];
}

function renderClaudeAuditSection({ stats, dir, found }, lang = "en") {
  const ja = lang === "ja";
  if (!found) {
    return ja
      ? `Claude Codeのトランスクリプトが見つかりませんでした: ${dir}`
      : `No Claude Code transcripts found at: ${dir}`;
  }

  const readCalls = stats.reads.builtinCalls + stats.reads.bashViewCalls;
  const totalFetchCalls = readCalls + stats.searches.grepCalls + stats.searches.globCalls + stats.searches.bashSearchCalls;
  const totalFetchTokens = stats.reads.tokens + stats.searches.tokens;
  const cn = totalFetchCalls + stats.mcp.calls > 0
    ? Math.round((stats.mcp.calls / (totalFetchCalls + stats.mcp.calls)) * 100)
    : 0;
  const ct = totalFetchTokens + stats.mcp.tokens > 0
    ? Math.round((stats.mcp.tokens / (totalFetchTokens + stats.mcp.tokens)) * 100)
    : 0;
  const excess = stats.reads.tokens - stats.reads.cappedTokens;

  const mcpBreakdown = Object.entries(stats.mcp.byTool)
    .sort(([, a], [, b]) => b - a)
    .map(([tool, calls]) => `  - ${tool}: ${formatNumber(calls)}`);

  if (ja) {
    return [
      "# Token Ops Audit(Claude Codeトランスクリプト)",
      "",
      `- 対象: このプロジェクトのみ(${formatNumber(stats.files)}ファイル、${formatNumber(stats.lines)}行、パース不能${formatNumber(stats.unparseableLines)}行は除外)`,
      "- プロンプト本文・ファイル内容は読み取らず、件数とサイズのみ集計",
      "",
      "## 組み込みツールでの取得(実測)",
      `- Read: ${formatNumber(stats.reads.builtinCalls)}回 / bash閲覧(cat等): ${formatNumber(stats.reads.bashViewCalls)}回 — 計 ~${formatNumber(stats.reads.tokens)} tokens`,
      `- 検索: Grep ${formatNumber(stats.searches.grepCalls)} / Glob ${formatNumber(stats.searches.globCalls)} / bash検索 ${formatNumber(stats.searches.bashSearchCalls)}回 — 計 ~${formatNumber(stats.searches.tokens)} tokens`,
      "",
      "## Token Ops MCPツールの使用",
      `- 呼び出し: ${formatNumber(stats.mcp.calls)}回 / ~${formatNumber(stats.mcp.tokens)} tokens`,
      ...mcpBreakdown,
      `- 遵守率: 回数 Cn ${cn}% / トークン加重 Ct ${ct}%`,
      "",
      "## 反実仮想(上限の目安)",
      `- 読み取りを${AUDIT_SNIPPET_LINE_CAP}行スニペットに丸めた場合: ~${formatNumber(stats.reads.tokens)} → ~${formatNumber(stats.reads.cappedTokens)} tokens(削減余地の上限 ~${formatNumber(excess)} tokens)`,
      "- 注: 実際に返った行数からの近似。スニペットで足りず追加読みが起きる分は含まない"
    ].join("\n");
  }

  return [
    "# Token Ops Audit (Claude Code transcripts)",
    "",
    `- Scope: this project only (${formatNumber(stats.files)} files, ${formatNumber(stats.lines)} lines; ${formatNumber(stats.unparseableLines)} unparseable lines excluded)`,
    "- Prompt text and file contents are never read; only counts and sizes are aggregated",
    "",
    "## Built-in context fetching (measured)",
    `- Read: ${formatNumber(stats.reads.builtinCalls)} calls / bash viewing (cat etc.): ${formatNumber(stats.reads.bashViewCalls)} calls — ~${formatNumber(stats.reads.tokens)} tokens total`,
    `- Search: Grep ${formatNumber(stats.searches.grepCalls)} / Glob ${formatNumber(stats.searches.globCalls)} / bash search ${formatNumber(stats.searches.bashSearchCalls)} calls — ~${formatNumber(stats.searches.tokens)} tokens total`,
    "",
    "## Token Ops MCP tool usage",
    `- Calls: ${formatNumber(stats.mcp.calls)} / ~${formatNumber(stats.mcp.tokens)} tokens`,
    ...mcpBreakdown,
    `- Compliance: count-based Cn ${cn}% / token-weighted Ct ${ct}%`,
    "",
    "## Counterfactual (upper bound)",
    `- If reads were capped at ${AUDIT_SNIPPET_LINE_CAP}-line snippets: ~${formatNumber(stats.reads.tokens)} → ~${formatNumber(stats.reads.cappedTokens)} tokens (up to ~${formatNumber(excess)} tokens avoidable)`,
    "- Note: approximated from lines actually returned; follow-up reads a snippet would trigger are not included"
  ].join("\n");
}

const OBSERVE_CLIENT_LABELS = { cursor: "Cursor", codex: "Codex" };

// One markdown section per client that has observe-hook data, plus the honest
// coverage caveats. Empty array when no observe rows were recorded, so a
// Claude-only audit renders exactly as before.
function renderObserveSections(observe, lang) {
  const clients = ["cursor", "codex"].filter((client) => observe[client]);
  return clients.map((client) => renderObserveSection(client, observe[client], lang));
}

function renderObserveSection(client, s, lang) {
  const ja = lang === "ja";
  const label = OBSERVE_CLIENT_LABELS[client] || client;
  const fetchCalls = s.reads.calls + s.searches.calls;
  const fetchTokens = s.reads.tokens + s.searches.tokens;
  const cn = fetchCalls + s.mcp.calls > 0
    ? Math.round((s.mcp.calls / (fetchCalls + s.mcp.calls)) * 100)
    : 0;
  const ct = fetchTokens + s.mcp.tokens > 0
    ? Math.round((s.mcp.tokens / (fetchTokens + s.mcp.tokens)) * 100)
    : 0;
  const mcpBreakdown = Object.entries(s.mcp.byTool)
    .sort(([, a], [, b]) => b - a)
    .map(([tool, calls]) => `  - ${tool}: ${formatNumber(calls)}`);

  // unified_exec shell calls are invisible to Codex's PostToolUse hook, and
  // Cursor "before" hooks fire without a result so only shell/mcp call counts
  // (not their token sizes) are known — say so rather than imply full coverage.
  const caveat = client === "codex"
    ? (ja
        ? "- 注: 観測フックによる実測。unified_exec 経由のシェル呼び出しは取りこぼしうる"
        : "- Note: measured via observe hook; shell calls made through unified_exec may be missed")
    : (ja
        ? "- 注: 観測フックによる実測。シェル/MCP は呼び出し前フックのため件数のみ(結果トークンは未計上)、取りこぼしうる"
        : "- Note: measured via observe hook; shell/MCP fire as pre-execution hooks so only call counts (not result tokens) are known, and some calls may be missed");

  if (ja) {
    return [
      `# Token Ops Audit(${label} 観測フック)`,
      "",
      "- パス・サイズ・時刻のみ記録。ファイル内容・コマンド本文は保存しない",
      "",
      "## コンテキスト取得(実測)",
      `- 読み取り: ${formatNumber(s.reads.calls)}回 — 計 ~${formatNumber(s.reads.tokens)} tokens`,
      `- 検索: ${formatNumber(s.searches.calls)}回 — 計 ~${formatNumber(s.searches.tokens)} tokens`,
      "",
      "## Token Ops MCPツールの使用",
      `- 呼び出し: ${formatNumber(s.mcp.calls)}回 / ~${formatNumber(s.mcp.tokens)} tokens`,
      ...mcpBreakdown,
      `- 遵守率: 回数 Cn ${cn}% / トークン加重 Ct ${ct}%`,
      caveat
    ].join("\n");
  }

  return [
    `# Token Ops Audit (${label} observe hook)`,
    "",
    "- Only path, size, and time are recorded; file contents and command text are never stored",
    "",
    "## Context fetching (measured)",
    `- Reads: ${formatNumber(s.reads.calls)} calls — ~${formatNumber(s.reads.tokens)} tokens total`,
    `- Search: ${formatNumber(s.searches.calls)} calls — ~${formatNumber(s.searches.tokens)} tokens total`,
    "",
    "## Token Ops MCP tool usage",
    `- Calls: ${formatNumber(s.mcp.calls)} / ~${formatNumber(s.mcp.tokens)} tokens`,
    ...mcpBreakdown,
    `- Compliance: count-based Cn ${cn}% / token-weighted Ct ${ct}%`,
    caveat
  ].join("\n");
}

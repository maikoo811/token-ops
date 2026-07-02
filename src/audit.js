import { createReadStream, existsSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { estimateTokens, formatNumber } from "./core.js";

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

function emptyStats() {
  return {
    files: 0,
    lines: 0,
    unparseableLines: 0,
    reads: { builtinCalls: 0, bashViewCalls: 0, tokens: 0, cappedTokens: 0 },
    searches: { grepCalls: 0, globCalls: 0, bashSearchCalls: 0, tokens: 0 },
    mcp: { calls: 0, tokens: 0, byTool: {} }
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

export async function runAudit(cwd, home = homedir()) {
  const dir = resolveTranscriptDir(cwd, home);
  const stats = emptyStats();
  if (!existsSync(dir)) {
    return { stats, dir, found: false };
  }
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  for (const name of files) {
    await auditTranscriptFile(join(dir, name), stats);
  }
  return { stats, dir, found: true };
}

export function renderAuditReport({ stats, dir, found }, lang = "en") {
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

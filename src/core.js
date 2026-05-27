import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

export const DEFAULT_MAX_FILES = 8;
export const DEFAULT_MAX_LINES = 120;
export const DEFAULT_CONTEXT = 8;
export const MAX_FILE_BYTES = 220_000;
export const DEFAULT_LANG = "auto";

// Hard ceiling on the number of tracked files we will enumerate per call.
// On 500k-file monorepos or slow network filesystems we'd otherwise spend
// seconds-to-minutes inside git ls-files and the subsequent per-file reads.
export const MAX_TRACKED_FILES = 50_000;
// Timeout for every git invocation. Real local repos respond in <100ms;
// 10 seconds is far beyond legitimate use and protects against hangs on
// network-mounted or unresponsive filesystems.
export const GIT_TIMEOUT_MS = 10_000;

// Cap session.jsonl to avoid unbounded growth in aggressive hook mode.
// Trimmed only when the size threshold is exceeded so normal usage pays
// zero overhead per record.
export const SESSION_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const SESSION_LOG_KEEP_LINES = 10_000;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "fix",
  "add",
  "make",
  "change",
  "update",
  "implement",
  "please",
  "したい",
  "する",
  "して",
  "追加",
  "修正",
  "変更",
  "実装",
  "の",
  "を",
  "に",
  "へ",
  "で"
]);

const JA_TO_EN = new Map([
  ["キーワード", ["keyword"]],
  ["抽出", ["extract", "extractor"]],
  ["バグ", ["bug"]],
  ["関数", ["function", "func"]],
  ["テスト", ["test", "spec"]],
  ["クラス", ["class"]],
  ["型", ["type"]],
  ["設定", ["config", "setting", "option"]],
  ["認証", ["auth"]],
  ["接続", ["connection", "connect"]],
  ["削除", ["delete", "remove"]],
  ["追加", ["add", "insert"]],
  ["取得", ["get", "fetch"]],
  ["保存", ["save", "persist"]],
  ["読込", ["load", "read"]],
  ["書込", ["write"]],
  ["一覧", ["list"]],
  ["詳細", ["detail"]],
  ["概要", ["summary", "overview"]],
  ["エラー", ["error", "err"]],
  ["例外", ["exception", "exc"]],
  ["検索", ["search", "find", "query"]],
  ["並び替え", ["sort"]],
  ["集計", ["aggregate", "count"]],
  ["通知", ["notify", "notification"]],
  ["ログ", ["log", "logger"]],
  ["起動", ["start", "boot", "init"]],
  ["終了", ["stop", "exit", "shutdown"]],
  ["再起動", ["restart", "reboot"]],
  ["監視", ["watch", "monitor", "observe"]],
  ["同期", ["sync"]],
  ["非同期", ["async"]],
  ["並列", ["parallel", "concurrent"]],
  // Project / repo structure
  ["フォルダ", ["folder", "dir", "directory"]],
  ["ディレクトリ", ["directory", "dir", "folder"]],
  ["構造", ["structure", "layout", "architecture"]],
  ["構成", ["structure", "layout", "config", "composition"]],
  ["アーキテクチャ", ["architecture", "arch"]],
  ["見直", ["review", "audit", "refactor"]],
  ["整理", ["cleanup", "refactor", "reorganize"]],
  ["リファクタ", ["refactor", "refactoring"]],
  ["依存", ["dependency", "dependencies", "deps"]],
  // Build / runtime
  ["ビルド", ["build"]],
  ["デプロイ", ["deploy", "deployment"]],
  ["環境", ["environment", "env"]],
  ["変数", ["variable", "var"]],
  ["機能", ["feature", "function"]],
  // UI / web
  ["画面", ["page", "screen", "view"]],
  ["ページ", ["page", "view", "route"]],
  ["ルーティング", ["routing", "router", "route"]],
  ["スタイル", ["style", "css", "theme"]],
  ["状態", ["state", "store"]],
  ["コンポーネント", ["component"]],
  // Data
  ["データベース", ["database", "db"]],
  ["スキーマ", ["schema"]],
  ["移行", ["migration", "migrate"]],
  // Documentation / agents
  ["ドキュメント", ["docs", "documentation", "readme"]],
  ["エージェント", ["agent", "agents"]],
  ["プロンプト", ["prompt"]]
]);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "vendor"
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".yaml",
  ".yml"
]);

export function generatePack({ task, cwd, maxFiles = DEFAULT_MAX_FILES, maxLines = DEFAULT_MAX_LINES, lang = "en" }) {
  const files = listTrackedFiles(cwd);
  const git = readGitState(cwd);
  const keywords = extractKeywords(task);
  const rankedFiles = rankFiles(files, keywords, git.changedFiles, cwd);
  const consideredFiles = rankedFiles.slice(0, maxFiles);
  const candidates = consideredFiles.map((file) => buildSnippet(file, keywords, cwd, maxLines));
  const budget = buildTokenBudget({ candidates, files, consideredFiles, cwd });
  const provisional = renderPack({ task, cwd, git, keywords, candidates, budget, lang });
  const finalBudget = finalizeTokenBudget(budget, estimateTokens(provisional));
  const markdown = renderPack({ task, cwd, git, keywords, candidates, budget: finalBudget, lang });

  return {
    markdown,
    budget: finalBudget,
    files: candidates.map((item) => item.file),
    keywords,
    git
  };
}

export function estimateContextCost({ cwd, task = "", maxFiles = DEFAULT_MAX_FILES }) {
  const files = listTrackedFiles(cwd);
  const git = readGitState(cwd);
  const keywords = extractKeywords(task);
  const rankedFiles = rankFiles(files, keywords, git.changedFiles, cwd).slice(0, maxFiles);
  const selectedFullTokens = rankedFiles.reduce((sum, file) => sum + estimateTokens(readSmallFile(join(cwd, file))), 0);
  const repoTokens = files.reduce((sum, file) => sum + estimateTokens(readSmallFile(join(cwd, file))), 0);

  return {
    task,
    selectedFiles: rankedFiles,
    selectedFullTokens,
    repoTokens,
    repoFileCount: files.length
  };
}

export function listHighCostFiles({ cwd, limit = 12 }) {
  return listTrackedFiles(cwd)
    .map((file) => ({
      file,
      estimatedTokens: estimateTokens(readSmallFile(join(cwd, file)))
    }))
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.file.localeCompare(b.file))
    .slice(0, limit);
}

export function recordSessionEvent(cwd, event) {
  // Opt-out for privacy-sensitive contexts (enterprise repos, prompts that
  // may contain secrets / customer data). When set to "1", the session log
  // is skipped entirely — token-ops report will show zero recorded events.
  if (process.env.TOKEN_OPS_DISABLE_LOG === "1") {
    return null;
  }

  const dir = join(cwd, ".token-ops");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "session.jsonl");

  // Symlink guard: if session.jsonl already exists and points outside cwd
  // (e.g. attacker pre-planted a symlink to /etc/passwd or ~/.ssh/...),
  // refuse to append. The first ever call creates a regular file, so this
  // check skips the cold-start case where realpathSync would ENOENT.
  if (existsSync(path) && safeAbsPath(cwd, join(".token-ops", "session.jsonl")) === null) {
    return null;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    ...event
  };
  writeFileSync(path, `${JSON.stringify(payload)}\n`, { flag: "a" });
  trimSessionLog(cwd, path);
  return path;
}

// Trimming is best-effort. Two processes (MCP server + CLI pack) can both
// trigger this around the same instant and race on the read-then-write
// cycle. Worst case: process A reads N lines, process B appends one more,
// then process A overwrites with N kept lines — losing process B's single
// most recently appended record. The data is telemetry-grade ("how many
// tokens did we save"), not source of truth, and the next append self-heals
// the log. Adding a file lock would be a heavier dependency than the value
// justifies.
// The catch deliberately swallows every sync throw — statSync, readFileSync,
// and writeFileSync are the only operations and any failure (permission,
// concurrent rename, disk full) should leave the calling pack/hook intact.
function trimSessionLog(cwd, path) {
  // Symlink guard: if session.jsonl has been replaced with a symlink that
  // escapes the repo root, refuse to read or rewrite it. safeAbsPath returns
  // null both on escape and on resolution failure, so the rare case where the
  // file was unlinked between append and trim also bails out cleanly.
  if (safeAbsPath(cwd, join(".token-ops", "session.jsonl")) === null) {
    return;
  }
  try {
    const size = statSync(path).size;
    if (size <= SESSION_LOG_MAX_BYTES) {
      return;
    }
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    if (lines.length <= SESSION_LOG_KEEP_LINES) {
      return;
    }
    const kept = lines.slice(-SESSION_LOG_KEEP_LINES);
    writeFileSync(path, `${kept.join("\n")}\n`);
  } catch {
    // intentionally silent (see comment above)
  }
}

export function readSavingsReport(cwd) {
  const path = join(cwd, ".token-ops", "session.jsonl");
  const zeroReport = {
    events: 0,
    savedTokens: 0,
    packTokens: 0,
    selectedFullTokens: 0,
    repoSavedTokens: 0,
    path
  };
  if (!existsSync(path)) {
    return zeroReport;
  }
  // Symlink guard: refuse to read session.jsonl if it resolves outside cwd.
  // This catches a tracked / pre-planted symlink that would otherwise let
  // `token-ops report` exfiltrate arbitrary host files.
  if (safeAbsPath(cwd, join(".token-ops", "session.jsonl")) === null) {
    return zeroReport;
  }

  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return rows.reduce((report, row) => {
    const budget = row.budget || {};
    return {
      ...report,
      events: report.events + 1,
      savedTokens: report.savedTokens + Number(budget.savedTokens || 0),
      packTokens: report.packTokens + Number(budget.packTokens || 0),
      selectedFullTokens: report.selectedFullTokens + Number(budget.selectedFullTokens || 0),
      repoSavedTokens: report.repoSavedTokens + Number(budget.repoSavedTokens || 0)
    };
  }, {
    events: 0,
    savedTokens: 0,
    packTokens: 0,
    selectedFullTokens: 0,
    repoSavedTokens: 0,
    path
  });
}

// Strip the parts of a pack that have no user-visible value when a human is
// reading the CLI output in their terminal. Keeps only:
//   - `## Task` (echoes what they typed — useful confirmation)
//   - `## Token Budget` (the value proposition — saved tokens, %)
//   - `## Relevant Files` (the "did Token Ops pick the right files" proof)
//
// Removed because the user already has the info, can see it in their shell
// prompt, or it's purely LLM-oriented templating:
//   - `## Suggested Prompt` / `## 推奨プロンプト` (LLM brief)
//   - `## Repository` / `## リポジトリ` (cwd + branch — already in their shell)
//   - `## Git Status` / `## Git状態` (they just made the changes themselves)
//   - `## Keywords` / `## キーワード` (debug-only diagnostic)
//   - `## Snippets` / `## 抜粋` (their own source code, on their own disk)
//
// Every removed section is essential for downstream LLM consumption (hook,
// MCP, piped output, file output), so this function is only applied at the
// CLI TTY layer — never to the pack that gets sent to a model or written
// to disk.
const TERMINAL_DROP_SECTIONS = [
  "Suggested Prompt", "推奨プロンプト",
  "Repository",       "リポジトリ",
  "Git Status",       "Git状態",
  "Keywords",         "キーワード"
];

export function simplifyForTerminal(markdown) {
  // Remove each "drop" section in-place. The non-greedy `[\s\S]*?(?=\n## )`
  // body match stops at the next top-level "## " heading. Every section in
  // the pack starts with "## " so the lookahead is reliable; snippet file
  // sub-headings use "### " and won't be confused for a section boundary.
  const headingPattern = TERMINAL_DROP_SECTIONS
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const dropRegex = new RegExp(`\\n## (?:${headingPattern})\\n[\\s\\S]*?(?=\\n## )`, "g");
  let out = markdown.replace(dropRegex, "");

  // Truncate at the snippets heading and append a footer telling the user
  // how to see them when they actually need to.
  const parts = out.split(/\n## (?:Snippets|抜粋)\n/);
  if (parts.length === 1) {
    return out;
  }
  return `${parts[0]}\n\n_(snippets hidden in terminal view — run with \`--full\` or pipe to a file to see them)_\n`;
}

// ANSI color helpers — applied ONLY when explicitly enabled (typically when
// stdout is a TTY). Hook injection, MCP responses, --output file writes, and
// piped CLI output all stay as plain markdown so downstream LLMs / scripts
// see clean text. We hand-roll the escape codes instead of pulling in a
// chalk-style dep — keeps Token Ops zero-runtime-deps and small.
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m"
};

export function colorizeForTty(markdown, enabled = false) {
  if (!enabled) {
    return markdown;
  }

  return markdown
    .split("\n")
    .map((line) => {
      // Top-level heading: bold + cyan ("# Token Ops Context Pack").
      if (/^# /.test(line)) {
        return `${ANSI.bold}${ANSI.cyan}${line}${ANSI.reset}`;
      }
      // Section heading: cyan ("## Token Budget", "## Task", ...).
      if (/^## /.test(line)) {
        return `${ANSI.cyan}${line}${ANSI.reset}`;
      }
      // Snippet file heading: dim ("### src/core.js"). Keeps focus on the
      // budget block while still showing the structure.
      if (/^### /.test(line)) {
        return `${ANSI.dim}${line}${ANSI.reset}`;
      }
      // Highlight any "(NN%)" — bold green. This is the headline number
      // a reader wants to see on Estimated saved + Avoided vs whole repo.
      return line.replace(
        /\((\d+)%\)/g,
        (_, n) => `${ANSI.bold}${ANSI.green}(${n}%)${ANSI.reset}`
      );
    })
    .join("\n");
}

export function renderSavingsReport(report, lang = "en") {
  if (lang === "ja") {
    return [
      "# Token Ops 節約レポート",
      "",
      `- 実行回数: ${formatNumber(report.events)}`,
      `- 推定削減: ~${formatNumber(report.savedTokens)} tokens`,
      `- 生成パック合計: ~${formatNumber(report.packTokens)} tokens`,
      `- 関連ファイル全文との差分: ~${formatNumber(report.savedTokens)} tokens`,
      `- リポジトリ全体読みとの差分: ~${formatNumber(report.repoSavedTokens)} tokens`,
      `- 記録ファイル: ${report.path}`
    ].join("\n");
  }

  return [
    "# Token Ops Savings Report",
    "",
    `- Runs: ${formatNumber(report.events)}`,
    `- Estimated saved: ~${formatNumber(report.savedTokens)} tokens`,
    `- Generated packs: ~${formatNumber(report.packTokens)} tokens`,
    `- Avoided vs selected full files: ~${formatNumber(report.savedTokens)} tokens`,
    `- Avoided vs whole repo: ~${formatNumber(report.repoSavedTokens)} tokens`,
    `- Log: ${report.path}`
  ].join("\n");
}

export const TRIGGER_MODES = new Set(["smart", "aggressive"]);
export const DEFAULT_TRIGGER_MODE = "smart";

export function readTriggerMode(value) {
  if (!TRIGGER_MODES.has(value)) {
    throw new Error(`--trigger-mode must be one of: ${[...TRIGGER_MODES].join(", ")}`);
  }
  return value;
}

export function shouldInjectForPrompt(prompt, mode = DEFAULT_TRIGGER_MODE) {
  // These two filters apply in every mode — short prompts can't usefully be
  // packed, and self-referential prompts about Token Ops itself would loop.
  if (!prompt || prompt.length < 6) {
    return false;
  }
  if (prompt.includes("token-ops")) {
    return false;
  }

  // aggressive: fire on any qualifying prompt (most automatic, fewer surprises
  // for coding-only repos where almost every prompt is code-relevant).
  if (mode === "aggressive") {
    return true;
  }

  // smart (default): require a coding-related trigger word. English uses \b
  // boundaries so `fix` does not match `prefix`/`fixture`, etc. Japanese keeps
  // substring matching because \b is unreliable around CJK characters.
  const englishHit = /\b(?:fix|bug|add|implement|refactor|test|review|debug|change|update)\b/i.test(prompt);
  const japaneseHit = /コード|実装|修正|追加|テスト|レビュー|改善|エラー|バグ|直|不具合|動かな|壊/.test(prompt);
  return englishHit || japaneseHit;
}

export function resolveLanguage(lang, task) {
  if (lang !== "auto") {
    return lang;
  }
  return hasJapanese(task) ? "ja" : "en";
}

export function readLanguage(value) {
  if (!["auto", "en", "ja"].includes(value)) {
    throw new Error("--lang must be one of: auto, en, ja");
  }
  return value;
}

export function toPositiveInt(value, flag) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return number;
}

export function formatNumber(number) {
  return Math.round(number).toLocaleString("en-US");
}

function hasJapanese(text) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
}

function listTrackedFiles(cwd) {
  const output = runGit(["ls-files", "--cached", "--others", "--exclude-standard"], cwd);
  const allLines = output.split("\n").map((line) => line.trim()).filter(Boolean);

  if (allLines.length > MAX_TRACKED_FILES) {
    process.stderr.write(
      `[token-ops] repository has ${allLines.length} tracked files; truncating to ${MAX_TRACKED_FILES} to avoid hangs.\n`
    );
  }

  const lines = allLines.slice(0, MAX_TRACKED_FILES);
  return lines
    .filter((file) => !shouldSkip(file))
    .filter((file) => existsSync(join(cwd, file)))
    .filter((file) => isTextFile(file))
    .filter((file) => safeAbsPath(cwd, file) !== null); // reject symlinks escaping cwd
}

function readGitState(cwd) {
  const status = runGit(["status", "--short"], cwd)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  return {
    branch: runGit(["branch", "--show-current"], cwd).trim() || "(detached)",
    status,
    changedFiles: new Set(
      status
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
        .map((line) => line.replace(/^.* -> /, ""))
    )
  };
}

function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS
    });
  } catch {
    // Catches non-zero exit (e.g. not a git repo), timeout (ETIMEDOUT),
    // and signal kills (SIGTERM after timeout). Returning empty is correct
    // for all of them — callers gracefully degrade with no tracked files.
    return "";
  }
}

// Validate a cwd argument that came from an untrusted-ish source (MCP client
// tool call, Claude Code hook stdin). Throws with a specific message on
// failure so callers can pick their own policy:
// - MCP tools: re-throw (the caller gets a JSON-RPC error)
// - Claude Code hook: catch and fall back to process.cwd() to stay resilient
//   to upstream workspace-detection bugs.
export function validateCwd(raw) {
  let resolved;
  try {
    resolved = realpathSync(raw);
  } catch {
    throw new Error(`cwd does not exist: ${raw}`);
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`cwd is not a directory: ${raw}`);
  }

  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: resolved,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: GIT_TIMEOUT_MS
    });
  } catch {
    throw new Error(`cwd is not a git repository: ${raw}`);
  }

  return resolved;
}

// Resolve `file` against `cwd`, follow symlinks, and verify the resolved
// path stays inside the repository root. Returns the resolved absolute path,
// or null if the file escapes the repo (e.g. via a tracked symlink to
// /etc/passwd) or cannot be resolved.
function safeAbsPath(cwd, file) {
  try {
    const candidate = realpathSync(join(cwd, file));
    const root = realpathSync(cwd);
    if (candidate === root || candidate.startsWith(root + sep)) {
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function shouldSkip(file) {
  return file.split("/").some((part) => SKIP_DIRS.has(part));
}

function isTextFile(file) {
  const extension = extname(file).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || basename(file).startsWith(".");
}

export function extractKeywords(task) {
  const words = (task.toLowerCase().match(/[a-z0-9_/-]{2,}|[\p{Script=Han}]{2,}|[\p{Script=Katakana}ー]{2,}/gu) || [])
    .map((word) => word.trim())
    .filter((word) => !STOP_WORDS.has(word));

  return [...new Set(words)].slice(0, 20);
}

function rankFiles(files, keywords, changedFiles, cwd) {
  const bridgedKeywords = bridgeJapaneseKeywords(keywords);

  return files
    .map((file) => {
      const pathText = file.toLowerCase();
      let score = changedFiles.has(file) ? 12 : 0;

      for (const keyword of keywords) {
        if (pathText.includes(keyword)) {
          score += 25;
        }
      }

      for (const bridged of bridgedKeywords) {
        if (pathText.includes(bridged)) {
          score += 15;
        }
      }

      const content = readSmallFile(join(cwd, file)).toLowerCase();
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          score += 8;
        }
      }

      for (const bridged of bridgedKeywords) {
        if (content.includes(bridged)) {
          score += 5;
        }
      }

      if (/\b(test|spec)\b/i.test(file)) {
        score += 4;
      }

      return { file, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .map((item) => item.file);
}

function bridgeJapaneseKeywords(keywords) {
  const expanded = new Set();
  for (const keyword of keywords) {
    const englishForms = JA_TO_EN.get(keyword);
    if (englishForms) {
      for (const form of englishForms) {
        expanded.add(form);
      }
    }
  }
  return expanded;
}

function buildSnippet(file, keywords, cwd, maxLines) {
  const absolutePath = join(cwd, file);
  const content = readSmallFile(absolutePath);
  const lines = content.split("\n");
  const matches = findMatchingLines(lines, keywords);
  const selectedLineIndexes = new Set();

  if (matches.length === 0) {
    for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
      selectedLineIndexes.add(index);
    }
  } else {
    for (const lineIndex of matches) {
      const start = Math.max(0, lineIndex - DEFAULT_CONTEXT);
      const end = Math.min(lines.length - 1, lineIndex + DEFAULT_CONTEXT);
      for (let index = start; index <= end; index += 1) {
        selectedLineIndexes.add(index);
      }
      if (selectedLineIndexes.size >= maxLines) {
        break;
      }
    }
  }

  const selected = [...selectedLineIndexes]
    .sort((a, b) => a - b)
    .slice(0, maxLines)
    .map((lineIndex) => `${String(lineIndex + 1).padStart(4, " ")} | ${lines[lineIndex]}`)
    .join("\n");

  return {
    file,
    absolutePath: relative(cwd, absolutePath),
    lineCount: lines.length,
    estimatedTokens: estimateTokens(content),
    snippet: selected
  };
}

function readSmallFile(path) {
  const content = readFileSync(path);
  if (content.length > MAX_FILE_BYTES) {
    return content.subarray(0, MAX_FILE_BYTES).toString("utf8");
  }
  return content.toString("utf8");
}

function findMatchingLines(lines, keywords) {
  if (keywords.length === 0) {
    return [];
  }

  const matches = [];
  lines.forEach((line, index) => {
    const lowerLine = line.toLowerCase();
    if (keywords.some((keyword) => lowerLine.includes(keyword))) {
      matches.push(index);
    }
  });
  return matches;
}

function buildTokenBudget({ candidates, files, consideredFiles, cwd }) {
  const selectedFullTokens = candidates.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const snippetTokens = estimateTokens(candidates.map((item) => item.snippet).join("\n"));
  const repoTokens = files.reduce((sum, file) => sum + estimateTokens(readSmallFile(join(cwd, file))), 0);

  return {
    selectedFileCount: consideredFiles.length,
    repoFileCount: files.length,
    selectedFullTokens,
    packTokens: snippetTokens,
    snippetTokens,
    repoTokens,
    savedTokens: 0,
    savedPercent: 0,
    repoSavedTokens: 0,
    repoSavedPercent: 0
  };
}

export function finalizeTokenBudget(budget, packTokens) {
  const savedTokens = Math.max(0, budget.selectedFullTokens - packTokens);
  const savedPercent = budget.selectedFullTokens > 0 ? Math.round((savedTokens / budget.selectedFullTokens) * 100) : 0;
  const repoSavedTokens = Math.max(0, budget.repoTokens - packTokens);
  const repoSavedPercent = budget.repoTokens > 0 ? Math.round((repoSavedTokens / budget.repoTokens) * 100) : 0;

  return {
    ...budget,
    packTokens,
    savedTokens,
    savedPercent,
    repoSavedTokens,
    repoSavedPercent
  };
}

function renderPack({ task, cwd, git, keywords, candidates, budget, lang }) {
  const text = labelsFor(lang);
  const totalSnippetTokens = estimateTokens(candidates.map((item) => item.snippet).join("\n"));
  const status = git.status.length > 0 ? git.status.map((line) => `- ${line}`).join("\n") : `- ${text.clean}`;
  const files = candidates.length > 0
    ? candidates.map((item) => `- ${item.file} (~${formatNumber(item.estimatedTokens)} ${text.tokensFullFile})`).join("\n")
    : `- ${text.noRelevantFiles}`;

  const snippets = candidates.map((item) => {
    const language = languageFor(item.file);
    return `### ${item.file}\n\n\`\`\`${language}\n${item.snippet}\n\`\`\``;
  }).join("\n\n");

  return `# ${text.title}

## ${text.task}
${task}

## ${text.tokenBudget}
- ${text.generatedPack}: ~${formatNumber(budget.packTokens)} ${text.tokens}
- ${text.selectedFullFiles}: ~${formatNumber(budget.selectedFullTokens)} ${text.tokens} (${budget.selectedFileCount} ${text.files})
- ${text.estimatedSaved}: ~${formatNumber(budget.savedTokens)} ${text.tokens} (${budget.savedPercent}%)
- ${text.wholeRepoBaseline}: ~${formatNumber(budget.repoTokens)} ${text.tokens} (${budget.repoFileCount} ${text.files})
- ${text.repoAvoided}: ~${formatNumber(budget.repoSavedTokens)} ${text.tokens} (${budget.repoSavedPercent}%)

## ${text.suggestedPrompt}
${text.promptInstruction}

${text.task}: ${task}

## ${text.repository}
- ${text.root}: ${cwd}
- ${text.branch}: ${git.branch}
- ${text.estimatedSnippetTokens}: ~${formatNumber(totalSnippetTokens)}

## ${text.gitStatus}
${status}

## ${text.keywords}
${keywords.length > 0 ? keywords.map((keyword) => `\`${keyword}\``).join(", ") : "(none)"}

## ${text.relevantFiles}
${files}

## ${text.snippets}
${snippets || text.noSnippets}
`;
}

function labelsFor(lang) {
  if (lang === "ja") {
    return {
      title: "Token Ops コンテキストパック",
      task: "タスク",
      tokenBudget: "トークン予算",
      generatedPack: "生成されたパック",
      selectedFullFiles: "関連ファイルを全文で読む場合",
      estimatedSaved: "推定削減",
      wholeRepoBaseline: "リポジトリ全体を読む場合の概算",
      repoAvoided: "全体読みとの差分",
      tokens: "tokens",
      tokensFullFile: "tokens / full file",
      files: "files",
      suggestedPrompt: "推奨プロンプト",
      promptInstruction: "以下の文脈を使ってタスクを進めてください。まず関連ファイルと抜粋を優先し、不足する場合だけ最小限の追加ファイルを読んでください。",
      repository: "リポジトリ",
      root: "Root",
      branch: "Branch",
      estimatedSnippetTokens: "抜粋の推定トークン",
      gitStatus: "Git状態",
      keywords: "キーワード",
      relevantFiles: "関連ファイル",
      snippets: "抜粋",
      clean: "Clean",
      noRelevantFiles: "タスクのキーワードから関連するtracked fileが見つかりませんでした。",
      noSnippets: "(抜粋は生成されませんでした。)"
    };
  }

  return {
    title: "Token Ops Context Pack",
    task: "Task",
    tokenBudget: "Token Budget",
    generatedPack: "Generated pack",
    selectedFullFiles: "Selected full files baseline",
    estimatedSaved: "Estimated saved",
    wholeRepoBaseline: "Whole repository baseline",
    repoAvoided: "Avoided vs whole repository",
    tokens: "tokens",
    tokensFullFile: "tokens full file",
    files: "files",
    suggestedPrompt: "Suggested Prompt",
    promptInstruction: "Use the context below to work on this task. Prefer the referenced files and snippets before reading broader repository context. If the snippets are insufficient, ask for or inspect only the smallest additional files needed.",
    repository: "Repository",
    root: "Root",
    branch: "Branch",
    estimatedSnippetTokens: "Estimated snippet tokens",
    gitStatus: "Git Status",
    keywords: "Keywords",
    relevantFiles: "Relevant Files",
    snippets: "Snippets",
    clean: "Clean",
    noRelevantFiles: "No relevant tracked files found from task keywords.",
    noSnippets: "(No snippets generated.)"
  };
}

function languageFor(file) {
  const extension = extname(file).toLowerCase().replace(".", "");
  if (extension === "md") return "md";
  if (extension === "yml") return "yaml";
  if (extension === "mjs" || extension === "cjs") return "js";
  return extension || "txt";
}

export function estimateTokens(text) {
  if (!text) {
    return 0;
  }

  // BPE tokenizers split CJK far more aggressively than they split ASCII
  // (roughly 1 token per 1–2 CJK chars vs 1 token per ~4 ASCII chars).
  // Counting Japanese chars separately keeps mixed-language estimates
  // closer to reality than a single `length / 4` heuristic.
  const japaneseMatches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const japanese = japaneseMatches ? japaneseMatches.length : 0;
  const other = text.length - japanese;
  return Math.ceil(japanese / 1.5 + other / 4);
}

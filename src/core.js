import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

export const DEFAULT_MAX_FILES = 8;
export const DEFAULT_MAX_LINES = 120;
export const DEFAULT_CONTEXT = 8;
export const MAX_FILE_BYTES = 220_000;
export const DEFAULT_LANG = "auto";

export const MAX_TRACKED_FILES = 50_000;
export const GIT_TIMEOUT_MS = 10_000;

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
  ["フォルダ", ["folder", "dir", "directory"]],
  ["ディレクトリ", ["directory", "dir", "folder"]],
  ["構造", ["structure", "layout", "architecture"]],
  ["構成", ["structure", "layout", "config", "composition"]],
  ["アーキテクチャ", ["architecture", "arch"]],
  ["見直", ["review", "audit", "refactor"]],
  ["整理", ["cleanup", "refactor", "reorganize"]],
  ["リファクタ", ["refactor", "refactoring"]],
  ["依存", ["dependency", "dependencies", "deps"]],
  ["ビルド", ["build"]],
  ["デプロイ", ["deploy", "deployment"]],
  ["環境", ["environment", "env"]],
  ["変数", ["variable", "var"]],
  ["機能", ["feature", "function"]],
  ["画面", ["page", "screen", "view"]],
  ["ページ", ["page", "view", "route"]],
  ["ルーティング", ["routing", "router", "route"]],
  ["スタイル", ["style", "css", "theme"]],
  ["状態", ["state", "store"]],
  ["コンポーネント", ["component"]],
  ["データベース", ["database", "db"]],
  ["スキーマ", ["schema"]],
  ["移行", ["migration", "migrate"]],
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
    // see block comment above
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

const TERMINAL_DROP_SECTIONS = [
  "Suggested Prompt", "推奨プロンプト",
  "Repository",       "リポジトリ",
  "Git Status",       "Git状態",
  "Keywords",         "キーワード"
];

export function simplifyForTerminal(markdown) {
  const headingPattern = TERMINAL_DROP_SECTIONS
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const dropRegex = new RegExp(`\\n## (?:${headingPattern})\\n[\\s\\S]*?(?=\\n## )`, "g");
  let out = markdown.replace(dropRegex, "");

  const parts = out.split(/\n## (?:Snippets|抜粋)\n/);
  if (parts.length === 1) {
    return out;
  }
  return `${parts[0]}\n\n_(snippets hidden in terminal view — run with \`--full\` or pipe to a file to see them)_\n`;
}

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
      if (/^# /.test(line)) {
        return `${ANSI.bold}${ANSI.cyan}${line}${ANSI.reset}`;
      }
      if (/^## /.test(line)) {
        return `${ANSI.cyan}${line}${ANSI.reset}`;
      }
      if (/^### /.test(line)) {
        return `${ANSI.dim}${line}${ANSI.reset}`;
      }
      return line.replace(
        /\((\d+)%\)/g,
        (_, n) => `${ANSI.bold}${ANSI.green}(${n}%)${ANSI.reset}`
      );
    })
    .join("\n");
}

export function renderSavingsReport(report, lang = "en") {
  // Recompute from totals so the lines reconcile; per-entry savedTokens is clamped at 0 (#80).
  const saved = Math.max(0, report.selectedFullTokens - report.packTokens);
  const pct = report.selectedFullTokens > 0
    ? Math.round((saved / report.selectedFullTokens) * 100)
    : 0;

  if (lang === "ja") {
    return [
      "# Token Ops 節約レポート",
      "",
      `- 実行回数: ${formatNumber(report.events)}`,
      `- Token Ops未使用時(推定): ~${formatNumber(report.selectedFullTokens)} tokens`,
      `- Token Ops使用時: ~${formatNumber(report.packTokens)} tokens`,
      `- 節約見込み(最大): ~${formatNumber(saved)} tokens (${pct}%)`,
      `- 記録ファイル: ${report.path}`
    ].join("\n");
  }

  return [
    "# Token Ops Savings Report",
    "",
    `- Runs: ${formatNumber(report.events)}`,
    `- Without Token Ops (est.): ~${formatNumber(report.selectedFullTokens)} tokens`,
    `- With Token Ops: ~${formatNumber(report.packTokens)} tokens`,
    `- Saved (max): ~${formatNumber(saved)} tokens (${pct}%)`,
    `- Log: ${report.path}`
  ].join("\n");
}

// A prompt the user pastes into the current AI session to get a handoff summary
// for the next one. Kept out of README on purpose: README is ranked into packs,
// so documenting the template there would leak it into every session (#79).
export function renderHandoffPrompt(lang = "en") {
  if (lang === "ja") {
    return [
      "このセッションを次のチャットに引き継ぐためのハンドオフを作って:",
      "",
      "1. やったこと(主な変更・PR・コミット)",
      "2. 決めたこと(技術判断・トレードオフの理由)",
      "3. 現状(ブランチ・テスト・PR の状態)",
      "4. 次のステップ(残タスク・ブロッカー)",
      "5. 重要な文脈(忘れたら困るユーザー指示・暗黙のルール)",
      "",
      "箇条書きで、新セッションに貼ればそのまま使えるように。"
    ].join("\n");
  }

  return [
    "Write a handoff to carry this session into the next chat:",
    "",
    "1. What was done (key changes, PRs, commits)",
    "2. What was decided (technical calls and the reasons/trade-offs)",
    "3. Current state (branch, tests, PR status)",
    "4. Next steps (remaining tasks, blockers)",
    "5. Important context (user instructions and implicit rules worth keeping)",
    "",
    "Use bullet points, ready to paste as the first message of a new session."
  ].join("\n");
}

export const TRIGGER_MODES = new Set(["all", "smart"]);
export const DEFAULT_TRIGGER_MODE = "all";

export function readTriggerMode(value) {
  if (!TRIGGER_MODES.has(value)) {
    throw new Error(`--trigger-mode must be one of: ${[...TRIGGER_MODES].join(", ")}`);
  }
  return value;
}

export function shouldInjectForPrompt(prompt, mode = DEFAULT_TRIGGER_MODE) {
  if (!prompt || prompt.length < 6) {
    return false;
  }
  if (prompt.includes("token-ops")) {
    return false;
  }
  if (mode === "all") {
    return true;
  }
  // \b for English (so `fix` doesn't match `prefix`); CJK doesn't use \b reliably.
  const englishHit = /\b(?:fix|bug|add|implement|refactor|test|review|debug|change|update|issues?|PRs?|docs?|specs?|features?|documents?|configures?|installs?|setups?|explains?|designs?|writes?|checks?|lists?|builds?|deploys?)\b/i.test(prompt);
  const japaneseHit = /コード|実装|修正|追加|テスト|レビュー|改善|エラー|バグ|直|不具合|動かな|壊|タスク|Issue|PR|プルリク|リスト|解説|仕様|機能|設計|確認|調べ|ドキュメント|インストール|セットアップ|書い|教え|作っ|作る|デプロイ/.test(prompt);
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
    return "";
  }
}

// cwd from an untrusted source (MCP arg, hook stdin). Throws on failure so
// callers pick their own policy: MCP re-throws, hook falls back to process.cwd().
export function validateCwd(raw) {
  let resolved;
  try {
    resolved = realpathSync(raw);
  } catch {
    throw new Error(
      `cwd does not exist: ${raw}. Pass cwd as an absolute path to the project root (the directory containing .git).`
    );
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(
      `cwd is not a directory: ${raw}. Pass cwd as an absolute path to the project root (the directory containing .git).`
    );
  }

  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: resolved,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: GIT_TIMEOUT_MS
    });
  } catch {
    throw new Error(
      `cwd is not a git repository: ${raw}. Pass cwd as the workspace root (the directory containing .git).`
    );
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

      const rawContent = readSmallFile(join(cwd, file));
      const content = rawContent.toLowerCase();
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

      // Symbol-defining file outranks one that only mentions the keyword.
      const symbols = extractSymbolNames(file, rawContent);
      for (const keyword of keywords) {
        if (symbols.has(keyword)) {
          score += 30;
        }
      }
      for (const bridged of bridgedKeywords) {
        if (symbols.has(bridged)) {
          score += 20;
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

const SYMBOL_PATTERNS = [
  /(?:^|[^\w$])(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/g,
  /(?:^|[^\w$])(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?\s*=\s*(?:async\s+)?(?:\(|function\b)/g,
  /(?:^|[^\w$])(?:export\s+(?:default\s+)?)?class\s+(\w+)/g,
  /(?:^|[^\w$])(?:export\s+)?(?:interface|type|enum)\s+(\w+)/g
];

function extractSymbolNames(file, rawContent) {
  if (!getJsLikeLanguage(file)) {
    return new Set();
  }
  const sanitized = stripStringsAndComments(rawContent);
  const symbols = new Set();
  for (const pattern of SYMBOL_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(sanitized)) !== null) {
      symbols.add(match[1].toLowerCase());
    }
  }
  return symbols;
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

  let selectedLineIndexes;
  if (matches.length === 0) {
    selectedLineIndexes = new Set();
    for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
      selectedLineIndexes.add(index);
    }
  } else {
    selectedLineIndexes = astBoundedSelection(file, content, lines, matches, maxLines)
      ?? windowSelection(lines, matches, maxLines);
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

function windowSelection(lines, matches, maxLines) {
  const set = new Set();
  for (const lineIndex of matches) {
    const start = Math.max(0, lineIndex - DEFAULT_CONTEXT);
    const end = Math.min(lines.length - 1, lineIndex + DEFAULT_CONTEXT);
    for (let index = start; index <= end; index += 1) {
      set.add(index);
    }
    if (set.size >= maxLines) {
      break;
    }
  }
  return set;
}

function astBoundedSelection(file, content, lines, matches, maxLines) {
  const language = getJsLikeLanguage(file);
  if (!language) {
    return null;
  }
  const sanitizedLines = stripStringsAndComments(content).split("\n");
  const set = new Set();
  for (const lineIndex of matches) {
    const block = findEnclosingBlock(lines, sanitizedLines, lineIndex);
    if (block === null) {
      return null;
    }
    for (let i = block[0]; i <= block[1]; i += 1) {
      set.add(i);
      if (set.size > maxLines) {
        return null;
      }
    }
  }
  return set.size > 0 ? set : null;
}

function getJsLikeLanguage(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".jsx") return "js";
  if (ext === ".ts" || ext === ".tsx") return "ts";
  return null;
}

const BLOCK_START_PATTERNS = [
  /^[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*\w+\s*\(/,
  /^[ \t]*(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+\w+\s*(?::[^=]+)?\s*=\s*(?:async\s+)?\(/,
  /^[ \t]*(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+\w+\s*(?::[^=]+)?\s*=\s*(?:async\s+)?function/,
  /^[ \t]*(?:export\s+(?:default\s+)?)?class\s+\w+/,
  /^[ \t]*(?:async\s+)?\w+\s*\([^)]*\)\s*{\s*$/  // method shorthand
];

function looksLikeBlockStart(line) {
  return BLOCK_START_PATTERNS.some((re) => re.test(line));
}

// Returns [startIdx, endIdx], or null if no enclosing block found / hit falls outside it.
function findEnclosingBlock(originalLines, sanitizedLines, hitLineIdx) {
  let startIdx = -1;
  for (let i = hitLineIdx; i >= 0; i -= 1) {
    if (looksLikeBlockStart(originalLines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  let depth = 0;
  let started = false;
  let endIdx = -1;
  for (let i = startIdx; i < sanitizedLines.length; i += 1) {
    const line = sanitizedLines[i];
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
        if (started && depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) break;
  }
  if (endIdx === -1) return null;
  if (hitLineIdx < startIdx || hitLineIdx > endIdx) return null;
  return [startIdx, endIdx];
}

// Newlines preserved so line indexes stay aligned with the original content.
function stripStringsAndComments(content) {
  let out = "";
  const n = content.length;
  let i = 0;
  while (i < n) {
    const ch = content[i];
    const next = i + 1 < n ? content[i + 1] : "";

    if (ch === "/" && next === "/") {
      while (i < n && content[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n - 1 && !(content[i] === "*" && content[i + 1] === "/")) {
        out += content[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < n - 1) { out += "  "; i += 2; }
      continue;
    }
    if (ch === '"' || ch === "'") {
      out += " ";
      i += 1;
      while (i < n && content[i] !== ch && content[i] !== "\n") {
        if (content[i] === "\\" && i + 1 < n) { out += "  "; i += 2; }
        else { out += " "; i += 1; }
      }
      if (i < n) { out += " "; i += 1; }
      continue;
    }
    if (ch === "`") {
      out += " ";
      i += 1;
      while (i < n && content[i] !== "`") {
        if (content[i] === "\\" && i + 1 < n) { out += "  "; i += 2; }
        else if (content[i] === "$" && i + 1 < n && content[i + 1] === "{") {
          // Keep ${...} contents and braces — they participate in real brace balance
          out += "${";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (content[i] === "{") depth += 1;
            else if (content[i] === "}") depth -= 1;
            out += content[i] === "\n" ? "\n" : content[i];
            i += 1;
          }
        } else {
          out += content[i] === "\n" ? "\n" : " ";
          i += 1;
        }
      }
      if (i < n) { out += " "; i += 1; }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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

  // BPE splits CJK far more aggressively (~1 token per 1-2 chars) than ASCII
  // (~1 per 4). Counting separately keeps estimates closer to reality.
  const japaneseMatches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const japanese = japaneseMatches ? japaneseMatches.length : 0;
  const other = text.length - japanese;
  return Math.ceil(japanese / 1.5 + other / 4);
}

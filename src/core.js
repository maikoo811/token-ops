import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

export const DEFAULT_MAX_FILES = 8;
export const DEFAULT_MAX_LINES = 120;
export const DEFAULT_CONTEXT = 8;
export const MAX_FILE_BYTES = 220_000;
export const DEFAULT_LANG = "auto";

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
  const dir = join(cwd, ".token-ops");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "session.jsonl");
  const payload = {
    timestamp: new Date().toISOString(),
    ...event
  };
  writeFileSync(path, `${JSON.stringify(payload)}\n`, { flag: "a" });
  return path;
}

export function readSavingsReport(cwd) {
  const path = join(cwd, ".token-ops", "session.jsonl");
  if (!existsSync(path)) {
    return {
      events: 0,
      savedTokens: 0,
      packTokens: 0,
      selectedFullTokens: 0,
      repoSavedTokens: 0,
      path
    };
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
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !shouldSkip(file))
    .filter((file) => existsSync(join(cwd, file)))
    .filter((file) => isTextFile(file));
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
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return "";
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

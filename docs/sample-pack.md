# Token Ops Context Pack

## Task
Fix the Japanese keyword tokenizer in extractKeywords

## Token Budget
- Generated pack: ~3,959 tokens
- Selected full files baseline: ~9,078 tokens (6 files)
- Estimated saved: ~5,119 tokens (56%)
- Whole repository baseline: ~12,587 tokens (17 files)
- Avoided vs whole repository: ~8,628 tokens (69%)

## Suggested Prompt
Use the context below to work on this task. Prefer the referenced files and snippets before reading broader repository context. If the snippets are insufficient, ask for or inspect only the smallest additional files needed.

Task: Fix the Japanese keyword tokenizer in extractKeywords

## Repository
- Root: /Users/maiko/Documents/dev/token-ops
- Branch: docs/savings-example
- Estimated snippet tokens: ~3,626

## Git Status
- Clean

## Keywords
`japanese`, `keyword`, `tokenizer`, `in`, `extractkeywords`

## Relevant Files
- plugin.json (~294 tokens full file)
- test/cli.test.js (~1,407 tokens full file)
- bin/token-ops.js (~1,700 tokens full file)
- src/integrations.js (~1,215 tokens full file)
- src/core.js (~4,342 tokens full file)
- package.json (~120 tokens full file)

## Snippets
### plugin.json

```json
   1 | {
   2 |   "name": "token-ops",
   3 |   "displayName": "Token Ops: AI Token Saver",
   4 |   "version": "0.2.0",
   5 |   "description": "Stop Cursor from wasting tokens on broad repo reads. Runs locally with no API key, account, or cloud backend.",
   6 |   "publisher": "token-ops",
   7 |   "license": "MIT",
   8 |   "categories": ["Productivity", "Agent Orchestration"],
   9 |   "keywords": ["tokens", "context", "cursor", "mcp", "vibe-coding"],
  10 |   "homepage": "https://github.com/maikoo811/token-ops",
  11 |   "bugs": {
  12 |     "url": "https://github.com/maikoo811/token-ops/issues"
  13 |   },
  14 |   "repository": {
  15 |     "type": "git",
  16 |     "url": "https://github.com/maikoo811/token-ops"
  17 |   },
  18 |   "privacy": {
  19 |     "localOnly": true,
  20 |     "requiresApiKey": false,
  21 |     "requiresAccount": false,
  22 |     "telemetry": "off-by-default",
  23 |     "summary": "Token Ops runs as a local MCP server. No source code leaves your machine by default."
  24 |   },
  25 |   "components": {
  26 |     "rules": ["./rules/token-ops.mdc"],
  27 |     "skills": ["./skills/token-ops"],
  28 |     "commands": ["./commands/compact-context.md", "./commands/token-report.md"],
  29 |     "mcpServers": {
  30 |       "token-ops": {
  31 |         "command": "node",
  32 |         "args": ["${PLUGIN_ROOT}/mcp/server.js"]
  33 |       }
  34 |     }
  35 |   }
  36 | }
  37 | 
```

### test/cli.test.js

```js
   1 | import { execFileSync } from "node:child_process";
   2 | import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
   3 | import { tmpdir } from "node:os";
   4 | import { join, resolve } from "node:path";
   5 | import test from "node:test";
   6 | import assert from "node:assert/strict";
   7 | import { shouldInjectForPrompt } from "../src/core.js";
   8 | 
   9 | const cli = resolve("bin/token-ops.js");
  10 | 
  11 | test("prints help", () => {
  12 |   const output = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  13 |   assert.match(output, /token-ops/);
  14 |   assert.match(output, /pack/);
  15 | });
  16 | 
  17 | test("builds a compact context pack from a git repository", () => {
  18 |   const cwd = mkdtempSync(join(tmpdir(), "token-ops-"));
  19 |   execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  20 |   execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  21 |   execFileSync("git", ["config", "user.name", "Token Ops Test"], { cwd });
  22 | 
  23 |   writeFileSync(join(cwd, "importer.js"), "export function importCsv(row) {\n  return row.csv_id;\n}\n");
  24 |   writeFileSync(join(cwd, "README.md"), "# Demo\n");
  25 |   execFileSync("git", ["add", "."], { cwd });
  26 |   execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });
  27 | 
  28 |   const output = execFileSync(process.execPath, [cli, "pack", "fix csv importer"], {
  29 |     cwd,
  30 |     encoding: "utf8"
  31 |   });
  32 | 
  33 |   assert.match(output, /# Token Ops Context Pack/);
  34 |   assert.match(output, /importer\.js/);
  35 |   assert.match(output, /csv_id/);
  36 | 
  37 |   const report = execFileSync(process.execPath, [cli, "report"], {
  38 |     cwd,
  39 |     encoding: "utf8"
  40 |   });
  41 |   assert.match(report, /Token Ops Savings Report/);
  42 |   assert.match(report, /Runs: 1/);
  43 | });
  44 | 
  45 | test("installs Cursor and Claude Code project helpers", () => {
  46 |   const cwd = mkdtempSync(join(tmpdir(), "token-ops-install-"));
  47 |   const output = execFileSync(process.execPath, [cli, "install"], {
  48 |     cwd,
  49 |     encoding: "utf8"
  50 |   });
  51 | 
  52 |   assert.match(output, /Installed token-ops integration/);
  53 |   assert.equal(existsSync(join(cwd, ".claude", "skills", "token-ops", "SKILL.md")), true);
  54 |   assert.equal(existsSync(join(cwd, ".claude", "settings.local.json")), true);
  55 |   assert.equal(existsSync(join(cwd, ".cursor", "rules", "token-ops.mdc")), true);
  56 |   assert.equal(existsSync(join(cwd, "AGENTS.md")), true);
  57 | });
  58 | 
  59 | test("claude prompt hook emits additional compact context", () => {
  60 |   const cwd = mkdtempSync(join(tmpdir(), "token-ops-hook-"));
  61 |   execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  62 |   writeFileSync(join(cwd, "README.md"), "# Demo\n\nCursor setup notes.\n");
  63 | 
  64 |   const output = execFileSync(process.execPath, [cli, "hook", "claude-user-prompt-submit"], {
  65 |     cwd,
  66 |     encoding: "utf8",
  67 |     input: JSON.stringify({
  68 |       cwd,
  69 |       prompt: "READMEのCursor説明を改善して"
  70 |     })
  71 |   });
  72 | 
  73 |   const parsed = JSON.parse(output);
  74 |   assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  75 |   assert.match(parsed.hookSpecificOutput.additionalContext, /Token Ops コンテキストパック/);
  76 |   assert.match(parsed.hookSpecificOutput.additionalContext, /トークン予算/);
  77 |   assert.match(parsed.hookSpecificOutput.additionalContext, /README\.md/);
  78 | });
  79 | 
  80 | test("splits Japanese prompts into per-word keywords, not one long blob", () => {
```

### bin/token-ops.js

```js
   1 | #!/usr/bin/env node
   2 | 
   3 | import { readFileSync, writeFileSync } from "node:fs";
   4 | import { join } from "node:path";
   5 | import {
   6 |   DEFAULT_LANG,
   7 |   DEFAULT_MAX_FILES,
   8 |   DEFAULT_MAX_LINES,
   9 |   estimateContextCost,
  10 |   generatePack,
  11 |   listHighCostFiles,
  12 |   readLanguage,
  13 |   readSavingsReport,
  14 |   recordSessionEvent,
  15 |   renderSavingsReport,
  16 |   resolveLanguage,
  17 |   shouldInjectForPrompt,
  18 |   toPositiveInt
  19 | } from "../src/core.js";
  20 | import { installIntegration } from "../src/integrations.js";
  21 | 
  22 | const args = process.argv.slice(2);
  23 | const command = args.shift();
  24 | 
  25 | try {
  26 |   if (!command || command === "-h" || command === "--help") {
  27 |     printHelp();
  28 |     process.exit(0);
  29 |   }
  30 | 
  31 |   if (command === "hook") {
  32 |     runHook(args);
  33 |     process.exit(0);
  34 |   }
  35 | 
  36 |   if (command === "install") {
  37 |     runInstall(args);
  38 |     process.exit(0);
  39 |   }
  40 | 
  41 |   if (command === "report") {
  42 |     runReport(args);
  43 |     process.exit(0);
  44 |   }
  45 | 
  71 |     fail("Please provide a task, for example: token-ops pack \"Fix the CSV import bug\"");
  72 |   }
  73 | 
  74 |   const lang = resolveLanguage(options.lang, task);
  75 |   const result = generatePack({
  76 |     task,
  77 |     cwd,
  78 |     maxFiles: options.maxFiles,
  79 |     maxLines: options.maxLines,
  80 |     lang
  81 |   });
  82 | 
  83 |   recordSessionEvent(cwd, {
  84 |     type: "pack",
  85 |     task,
  86 |     budget: result.budget,
  87 |     files: result.files
  88 |   });
  89 | 
  90 |   if (options.output) {
  91 |     writeFileSync(join(cwd, options.output), result.markdown);
  92 |     console.log(`Wrote ${options.output}`);
  93 |   } else {
  94 |     process.stdout.write(result.markdown);
  95 |   }
  96 | }
  97 | 
  98 | function runInstall(values) {
  99 |   const target = values[0] || "all";
 100 |   if (target === "-h" || target === "--help") {
 101 |     printHelp();
 102 |     return;
 103 |   }
 104 | 
 105 |   const installed = installIntegration({
```

### src/integrations.js

```js
   1 | import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
   2 | import { join } from "node:path";
   3 | 
   4 | export function installIntegration({ cwd, target, cliPath }) {
   5 |   const validTargets = new Set(["all", "claude", "claude-hook", "cursor", "codex"]);
   6 | 
   7 |   if (!validTargets.has(target)) {
   8 |     throw new Error("install target must be one of: all, claude, claude-hook, cursor, codex");
   9 |   }
  10 | 
  11 |   const installed = [];
  12 | 
  13 |   if (target === "all" || target === "claude" || target === "claude-hook") {
  14 |     const skillDir = join(cwd, ".claude", "skills", "token-ops");
  15 |     mkdirSync(skillDir, { recursive: true });
  16 |     writeFileSync(join(skillDir, "SKILL.md"), renderClaudeSkill(cliPath));
  17 |     installed.push(".claude/skills/token-ops/SKILL.md");
  18 |   }
  19 | 
  20 |   if (target === "all" || target === "claude-hook") {
  21 |     const settingsPath = join(cwd, ".claude", "settings.local.json");
  22 |     mkdirSync(join(cwd, ".claude"), { recursive: true });
  23 |     writeFileSync(settingsPath, renderClaudeHookSettings(settingsPath, cliPath));
  24 |     installed.push(".claude/settings.local.json");
  25 |   }
  26 | 
  27 |   if (target === "all" || target === "cursor") {
  28 |     const ruleDir = join(cwd, ".cursor", "rules");
  29 |     mkdirSync(ruleDir, { recursive: true });
  30 |     writeFileSync(join(ruleDir, "token-ops.mdc"), renderCursorRule());
  31 |     installed.push(".cursor/rules/token-ops.mdc");
  32 |   }
  33 | 
  34 |   if (target === "all" || target === "codex") {
  35 |     writeFileSync(join(cwd, "AGENTS.md"), mergeCodexInstructions(join(cwd, "AGENTS.md")));
  36 |     installed.push("AGENTS.md");
  37 |   }
  38 | 
  39 |   return installed;
  40 | }
  41 | 
  42 | export function renderClaudeSkill(cliPath) {
  43 |   return `---
  44 | name: token-ops
  45 | description: Build a compact context pack before starting broad code exploration. Use when the user asks to save tokens, reduce context, prepare an AI coding prompt, or gather only relevant files for a task.
  46 | disable-model-invocation: true
  47 | ---
  48 | 
  49 | ## Context pack
  50 | 
  51 | \`\`\`!
  52 | node ${shellQuote(cliPath)} pack "$ARGUMENTS"
  53 | \`\`\`
  54 | 
  55 | ## Instructions
  56 | 
  57 | Use the generated context pack as the starting point. Prefer the listed files and snippets before reading broader repository context. If the pack is insufficient, inspect only the smallest additional files needed for the user's task.
  58 | `;
  59 | }
  60 | 
  61 | export function renderCursorRule() {
  62 |   return `---
  63 | description: Reduce wasted context with Token Ops before broad exploration.
  64 | alwaysApply: true
  65 | ---
  66 | 
  67 | Before broad repository exploration, large file reads, or noisy test-log analysis, use Token Ops if its MCP tools are available.
  68 | 
  69 | Prefer this order:
  70 | 
  71 | 1. Call \`build_compact_context\` for the current task.
  72 | 2. Use the returned snippets and token budget before reading more files.
  73 | 3. Call \`list_high_cost_files\` before opening large files, generated files, lockfiles, or logs.
  74 | 4. Call \`report_saved_tokens\` when the user asks about cost, tokens, usage, or savings.
  75 | 
  76 | Avoid reading broad repository context until Token Ops output is insufficient for the task.
  77 | `;
  78 | }
  79 | 
  80 | export function renderCodexInstructions() {
```

### src/core.js

```js
   1 | import { execFileSync } from "node:child_process";
   2 | import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
   3 | import { basename, extname, join, relative } from "node:path";
   4 | 
   5 | export const DEFAULT_MAX_FILES = 8;
   6 | export const DEFAULT_MAX_LINES = 120;
   7 | export const DEFAULT_CONTEXT = 8;
   8 | export const MAX_FILE_BYTES = 220_000;
   9 | export const DEFAULT_LANG = "auto";
  10 | 
  11 | const STOP_WORDS = new Set([
  12 |   "the",
  13 |   "and",
  14 |   "for",
  33 |   "の",
  34 |   "を",
  35 |   "に",
  36 |   "へ",
  37 |   "で"
  38 | ]);
  39 | 
  40 | const JA_TO_EN = new Map([
  41 |   ["キーワード", ["keyword"]],
  42 |   ["抽出", ["extract", "extractor"]],
  43 |   ["バグ", ["bug"]],
  44 |   ["関数", ["function", "func"]],
  45 |   ["テスト", ["test", "spec"]],
  46 |   ["クラス", ["class"]],
  47 |   ["型", ["type"]],
  48 |   ["設定", ["config", "setting", "option"]],
  49 |   ["認証", ["auth"]],
  50 |   ["接続", ["connection", "connect"]],
  51 |   ["削除", ["delete", "remove"]],
  52 |   ["追加", ["add", "insert"]],
  53 |   ["取得", ["get", "fetch"]],
  54 |   ["保存", ["save", "persist"]],
  55 |   ["読込", ["load", "read"]],
  56 |   ["書込", ["write"]],
  57 |   ["一覧", ["list"]],
  58 |   ["詳細", ["detail"]],
  59 |   ["概要", ["summary", "overview"]],
  60 |   ["エラー", ["error", "err"]],
  61 |   ["例外", ["exception", "exc"]],
  62 |   ["検索", ["search", "find", "query"]],
  63 |   ["並び替え", ["sort"]],
  64 |   ["集計", ["aggregate", "count"]],
  65 |   ["通知", ["notify", "notification"]],
  66 |   ["ログ", ["log", "logger"]],
  67 |   ["起動", ["start", "boot", "init"]],
  68 |   ["終了", ["stop", "exit", "shutdown"]],
  69 |   ["再起動", ["restart", "reboot"]],
  70 |   ["監視", ["watch", "monitor", "observe"]],
  71 |   ["同期", ["sync"]],
  72 |   ["非同期", ["async"]],
  73 |   ["並列", ["parallel", "concurrent"]]
  74 | ]);
  75 | 
 111 |   ".ts",
 112 |   ".tsx",
 113 |   ".txt",
 114 |   ".vue",
 115 |   ".yaml",
 116 |   ".yml"
 117 | ]);
 118 | 
 119 | export function generatePack({ task, cwd, maxFiles = DEFAULT_MAX_FILES, maxLines = DEFAULT_MAX_LINES, lang = "en" }) {
 120 |   const files = listTrackedFiles(cwd);
 121 |   const git = readGitState(cwd);
 122 |   const keywords = extractKeywords(task);
 123 |   const rankedFiles = rankFiles(files, keywords, git.changedFiles, cwd);
 124 |   const consideredFiles = rankedFiles.slice(0, maxFiles);
 125 |   const candidates = consideredFiles.map((file) => buildSnippet(file, keywords, cwd, maxLines));
 126 |   const budget = buildTokenBudget({ candidates, files, consideredFiles, cwd });
 127 |   const provisional = renderPack({ task, cwd, git, keywords, candidates, budget, lang });
 128 |   const finalBudget = finalizeTokenBudget(budget, estimateTokens(provisional));
 129 |   const markdown = renderPack({ task, cwd, git, keywords, candidates, budget: finalBudget, lang });
 130 | 
 131 |   return {
 132 |     markdown,
 133 |     budget: finalBudget,
```

### package.json

```json
   1 | {
   2 |   "name": "token-ops",
   3 |   "version": "0.2.0",
   4 |   "description": "A local Cursor plugin and CLI that reduces wasted AI coding context.",
   5 |   "type": "module",
   6 |   "bin": {
   7 |     "token-ops": "./bin/token-ops.js",
   8 |     "token-ops-mcp": "./mcp/server.js"
   9 |   },
  10 |   "scripts": {
  11 |     "test": "node --test"
  12 |   },
  13 |   "keywords": [
  14 |     "ai",
  15 |     "tokens",
  16 |     "context",
  17 |     "cursor",
  18 |     "claude-code",
  19 |     "mcp",
  20 |     "vibe-coding"
  21 |   ],
  22 |   "license": "MIT",
  23 |   "engines": {
  24 |     "node": ">=18"
  25 |   }
  26 | }
  27 | 
```

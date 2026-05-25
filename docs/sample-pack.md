# Token Ops Context Pack

## Task
Fix the Japanese keyword tokenizer in extractKeywords

## Token Budget
- Generated pack: ~5,015 tokens
- Selected full files baseline: ~14,174 tokens (6 files)
- Estimated saved: ~9,159 tokens (65%)
- Whole repository baseline: ~20,823 tokens (19 files)
- Avoided vs whole repository: ~15,808 tokens (76%)

## Suggested Prompt
Use the context below to work on this task. Prefer the referenced files and snippets before reading broader repository context. If the snippets are insufficient, ask for or inspect only the smallest additional files needed.

Task: Fix the Japanese keyword tokenizer in extractKeywords

## Repository
- Root: /Users/maiko/Documents/dev/token-ops
- Branch: feat/token-estimate-precision
- Estimated snippet tokens: ~4,669

## Git Status
-  M README.md
-  M src/core.js
-  M test/core.test.js

## Keywords
`japanese`, `keyword`, `tokenizer`, `in`, `extractkeywords`

## Relevant Files
- README.md (~1,420 tokens full file)
- src/core.js (~4,712 tokens full file)
- test/core.test.js (~1,551 tokens full file)
- plugin.json (~294 tokens full file)
- docs/sample-pack.md (~4,003 tokens full file)
- test/cli.test.js (~2,194 tokens full file)

## Snippets
### README.md

```md
   1 | # Token Ops
   2 | 
   3 | Token Ops reduces wasted context during AI coding sessions. It gives Cursor, Claude Code, Codex, and other MCP-compatible agents a compact task-focused context pack before they read broadly, then records an estimated saved-token report.
   4 | 
   5 | The product goal is simple: install once, vibe code normally, and see how much context the agent avoided.
   6 | 
   7 | ## Measured Savings
   8 | 
   9 | Real numbers from running `token-ops pack` against this repository (19 tracked files, ~20,780 tokens of full-repo context, script-aware estimator):
  10 | 
  11 | ```mermaid
  12 | ---
  13 | config:
  14 |   xyChart:
  15 |     width: 760
  16 |     height: 320
  17 |   themeVariables:
  18 |     xyChart:
  19 |       plotColorPalette: "#16a34a"
  20 | ---
  21 | xychart-beta
  22 |   title "Tokens saved per pack (vs whole-repo baseline, higher is better)"
  23 |   x-axis ["Fix JA tokenizer", "Add uninstall", "Build pack"]
  24 |   y-axis "Tokens saved" 0 --> 20000
  25 |   bar [15811, 17607, 16127]
  26 | ```
  27 | 
  28 | | Task | Pack size | Vs selected full files | Vs whole repo |
  29 | |---|---|---|---|
  30 | | `Fix the Japanese keyword tokenizer in extractKeywords` | ~4,969 tokens | 65% smaller | 76% smaller |
  31 | | `Add an uninstall command to the CLI` | ~3,173 tokens | 63% smaller | 85% smaller |
  32 | | `Build a compact context pack for the current task` | ~4,653 tokens | 68% smaller | 78% smaller |
  33 | 
  34 | A raw verbatim pack output is checked in at [docs/sample-pack.md](docs/sample-pack.md) so you can see exactly what Token Ops produces.
  35 | 
  36 | ### What "saved" actually measures
  37 | 
  38 | - **Pack size** is a rough token estimate: `length / 4` for ASCII and `length / 1.5` for CJK characters, summed. BPE tokenizers split CJK more aggressively than ASCII, so a single ratio underestimates Japanese-heavy content.
  39 | - **Vs selected full files** compares the pack against reading the same ranked files in full.
  40 | - **Vs whole repo** compares against reading every tracked text file. This is an upper bound — a real agent wouldn't read everything, so treat this number as a ceiling, not a typical baseline.
  41 | 
  42 | What this does NOT measure: whether the pack contained the right context, or how many follow-up reads the agent makes. Token Ops earns its keep when its snippets are sufficient for the task; it does not stop the agent from reading more when needed.
  43 | 
  44 | ### Verify these numbers yourself
  45 | 
  46 | Inside this repository:
  47 | 
  48 | ```sh
  49 | npm install
  50 | npm test
  51 | node bin/token-ops.js pack "Fix the Japanese keyword tokenizer in extractKeywords"
  52 | ```
  53 | 
  54 | The `## Token Budget` section of the output is the source of the table above.
  55 | 
  56 | ## Beginner Defaults
  57 | 
  58 | Token Ops is designed to be useful without setup:
  59 | 
  60 | - No API key
  61 | - No account
  62 | - No cloud backend
  63 | - No telemetry by default
  64 | - Local MCP server
  65 | - Beginner defaults: 6 files, 80 snippet lines per file, auto language
  66 | 
  67 | ## Cursor Plugin
  68 | 
  69 | Token Ops is being shaped for Cursor Marketplace distribution as a free local plugin.
  70 | 
  71 | The plugin includes:
  72 | 
  73 | - A local MCP server: `mcp/server.js`
  74 | - Cursor rules: `rules/token-ops.mdc`
  75 | - A Token Ops skill: `skills/token-ops/SKILL.md`
  76 | - Commands for compact context and saved-token reports
  77 | 
  78 | The MCP server runs locally. It does not require a hosted backend or a Token Ops account.
  79 | 
  80 | After installation, users can ask Cursor:
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

### test/core.test.js

```js
   1 | import test from "node:test";
   2 | import assert from "node:assert/strict";
   3 | import {
   4 |   extractKeywords,
   5 |   estimateTokens,
   6 |   finalizeTokenBudget,
   7 |   shouldInjectForPrompt,
   8 |   resolveLanguage
   9 | } from "../src/core.js";
  10 | 
  11 | // ---- extractKeywords ----
  12 | 
  13 | test("extractKeywords: ASCII tokens are lowercased and stop words dropped", () => {
  14 |   const out = extractKeywords("Fix the CSV import bug");
  15 |   assert.deepEqual(out, ["csv", "import", "bug"]);
  16 | });
  17 | 
  18 | test("extractKeywords: Japanese is split into per-word Han/Katakana tokens", () => {
  19 |   const out = extractKeywords("キーワード抽出のバグを直して");
  20 |   assert.ok(out.includes("キーワード"));
  21 |   assert.ok(out.includes("抽出"));
  22 |   assert.ok(out.includes("バグ"));
  23 |   assert.ok(!out.includes("キーワード抽出のバグを直して"));
  24 | });
  25 | 
  26 | test("extractKeywords: hiragana-only tokens are dropped (grammar particles)", () => {
  27 |   const out = extractKeywords("ファイルをひらいて");
  28 |   assert.ok(out.includes("ファイル"));
  29 |   assert.ok(!out.includes("ひらいて"));
  30 | });
  31 | 
  32 | test("extractKeywords: drops Japanese stop words 修正/追加/実装/変更", () => {
  33 |   // Note: contiguous Han runs become a single token (no morphological split),
  34 |   // so "認証機能" is one keyword, not 認証 + 機能.
  35 |   const out = extractKeywords("バグを修正したい");
  36 |   assert.ok(out.includes("バグ"));
  37 |   assert.ok(!out.includes("修正"), "stop word 修正 should be dropped");
  38 | });
  39 | 
  40 | test("extractKeywords: returns at most 20 unique keywords", () => {
  41 |   const longTask = Array.from({ length: 40 }, (_, index) => `kw${index}`).join(" ");
  42 |   const out = extractKeywords(longTask);
  43 |   assert.equal(out.length, 20);
  44 |   assert.equal(new Set(out).size, out.length);
  45 | });
  46 | 
  47 | // ---- estimateTokens ----
  48 | 
  49 | test("estimateTokens: rounds up to the nearest token (ASCII)", () => {
  50 |   assert.equal(estimateTokens(""), 0);
  53 |   assert.equal(estimateTokens("abcde"), 2);
  54 | });
  55 | 
  56 | test("estimateTokens: ASCII scales at ~1 token per 4 chars", () => {
  57 |   const text = "x".repeat(400);
  58 |   assert.equal(estimateTokens(text), 100);
  59 | });
  60 | 
  61 | test("estimateTokens: Japanese is denser than ASCII (~1 token per 1.5 chars)", () => {
  62 |   // 6 Japanese chars under the old 1/4 heuristic = ceil(6/4) = 2.
  63 |   // New heuristic counts CJK at 1/1.5, so 6 chars = ceil(4) = 4.
  64 |   assert.equal(estimateTokens("バグを直して"), 4);
  65 |   // 60 Japanese chars under old = ceil(60/4) = 15; under new = ceil(60/1.5) = 40.
  66 |   assert.equal(estimateTokens("あ".repeat(60)), 40);
  67 | });
  68 | 
  69 | test("estimateTokens: mixed-script text sums per-script estimates", () => {
  70 |   // "Fix バグ" = 4 ASCII + 1 space + 2 JA. Old: ceil(7/4) = 2. New: ceil(5/4 + 2/1.5) = ceil(1.25 + 1.33) = 3.
  71 |   assert.equal(estimateTokens("Fix バグ"), 3);
  72 | });
  73 | 
  74 | // ---- finalizeTokenBudget ----
  75 | 
  76 | test("finalizeTokenBudget: computes saved tokens and percent vs selected files", () => {
  77 |   const out = finalizeTokenBudget(
  78 |     {
  79 |       selectedFileCount: 3,
  80 |       repoFileCount: 10,
  81 |       selectedFullTokens: 10000,
  82 |       packTokens: 0,
```

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

### docs/sample-pack.md

```md
   1 | # Token Ops Context Pack
   2 | 
   3 | ## Task
   4 | Fix the Japanese keyword tokenizer in extractKeywords
   5 | 
   6 | ## Token Budget
   7 | - Generated pack: ~3,959 tokens
   8 | - Selected full files baseline: ~9,078 tokens (6 files)
   9 | - Estimated saved: ~5,119 tokens (56%)
  10 | - Whole repository baseline: ~12,587 tokens (17 files)
  11 | - Avoided vs whole repository: ~8,628 tokens (69%)
  12 | 
  13 | ## Suggested Prompt
  14 | Use the context below to work on this task. Prefer the referenced files and snippets before reading broader repository context. If the snippets are insufficient, ask for or inspect only the smallest additional files needed.
  15 | 
  16 | Task: Fix the Japanese keyword tokenizer in extractKeywords
  17 | 
  18 | ## Repository
  19 | - Root: /Users/maiko/Documents/dev/token-ops
  20 | - Branch: docs/savings-example
  21 | - Estimated snippet tokens: ~3,626
  22 | 
  23 | ## Git Status
  24 | - Clean
  25 | 
  26 | ## Keywords
  27 | `japanese`, `keyword`, `tokenizer`, `in`, `extractkeywords`
  28 | 
  29 | ## Relevant Files
  30 | - plugin.json (~294 tokens full file)
  31 | - test/cli.test.js (~1,407 tokens full file)
  32 | - bin/token-ops.js (~1,700 tokens full file)
  33 | - src/integrations.js (~1,215 tokens full file)
  34 | - src/core.js (~4,342 tokens full file)
  35 | - package.json (~120 tokens full file)
  36 | 
  37 | ## Snippets
  38 | ### plugin.json
  39 | 
  40 | ```json
  41 |    1 | {
  42 |    2 |   "name": "token-ops",
  43 |    3 |   "displayName": "Token Ops: AI Token Saver",
  44 |    4 |   "version": "0.2.0",
  45 |    5 |   "description": "Stop Cursor from wasting tokens on broad repo reads. Runs locally with no API key, account, or cloud backend.",
  46 |    6 |   "publisher": "token-ops",
  47 |    7 |   "license": "MIT",
  48 |    8 |   "categories": ["Productivity", "Agent Orchestration"],
  49 |    9 |   "keywords": ["tokens", "context", "cursor", "mcp", "vibe-coding"],
  50 |   10 |   "homepage": "https://github.com/maikoo811/token-ops",
  51 |   11 |   "bugs": {
  52 |   12 |     "url": "https://github.com/maikoo811/token-ops/issues"
  53 |   13 |   },
  54 |   14 |   "repository": {
  55 |   15 |     "type": "git",
  56 |   16 |     "url": "https://github.com/maikoo811/token-ops"
  57 |   17 |   },
  58 |   18 |   "privacy": {
  59 |   19 |     "localOnly": true,
  60 |   20 |     "requiresApiKey": false,
  61 |   21 |     "requiresAccount": false,
  62 |   22 |     "telemetry": "off-by-default",
  63 |   23 |     "summary": "Token Ops runs as a local MCP server. No source code leaves your machine by default."
  64 |   24 |   },
  65 |   25 |   "components": {
  66 |   26 |     "rules": ["./rules/token-ops.mdc"],
  67 |   27 |     "skills": ["./skills/token-ops"],
  68 |   28 |     "commands": ["./commands/compact-context.md", "./commands/token-report.md"],
  69 |   29 |     "mcpServers": {
  70 |   30 |       "token-ops": {
  71 |   31 |         "command": "node",
  72 |   32 |         "args": ["${PLUGIN_ROOT}/mcp/server.js"]
  73 |   33 |       }
  74 |   34 |     }
  75 |   35 |   }
  76 |   36 | }
  77 |   37 | 
  78 | ```
  79 | 
  80 | ### test/cli.test.js
```

### test/cli.test.js

```js
   1 | import { execFileSync } from "node:child_process";
   2 | import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

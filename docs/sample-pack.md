# Token Ops Context Pack

## Task
Fix the Japanese keyword tokenizer in extractKeywords

## Token Budget
- Generated pack: ~5,360 tokens
- Selected full files baseline: ~14,622 tokens (6 files)
- Estimated saved: ~9,262 tokens (63%)
- Whole repository baseline: ~22,822 tokens (20 files)
- Avoided vs whole repository: ~17,462 tokens (77%)

## Suggested Prompt
Use the context below to work on this task. Prefer the referenced files and snippets before reading broader repository context. If the snippets are insufficient, ask for or inspect only the smallest additional files needed.

Task: Fix the Japanese keyword tokenizer in extractKeywords

## Repository
- Root: /Users/maiko/Documents/dev/token-ops
- Branch: chore/marketplace-manifest
- Estimated snippet tokens: ~5,000

## Git Status
-  M CHANGELOG.md
-  M mcp/server.js
-  M package.json
- D  plugin.json
- ?? .cursor-plugin/

## Keywords
`japanese`, `keyword`, `tokenizer`, `in`, `extractkeywords`

## Relevant Files
- CHANGELOG.md (~1,026 tokens full file)
- .cursor-plugin/plugin.json (~252 tokens full file)
- docs/sample-pack.md (~5,018 tokens full file)
- README.md (~1,420 tokens full file)
- src/core.js (~4,712 tokens full file)
- test/cli.test.js (~2,194 tokens full file)

## Snippets
### CHANGELOG.md

```md
   1 | # Changelog
   2 | 
   3 | All notable changes to Token Ops are documented in this file.
   4 | 
   5 | The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
   6 | and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
   7 | 
   8 | ## [0.3.1] — 2026-05-25
   9 | 
  10 | ### Changed
  11 | - Refactored the plugin manifest to match the official Cursor Marketplace schema (`https://cursor.com/schemas/cursor-plugin/plugin.json`):
  12 |   - Moved manifest from root `plugin.json` to `.cursor-plugin/plugin.json` (required location).
  13 |   - Replaced the `components: { ... }` wrapper with top-level `skills` / `rules` / `commands` / `mcpServers` keys.
  14 |   - Switched `categories: [array]` → `category: "developer-tools"` (singular).
  15 |   - Converted `repository` from an object to a URL string.
  16 |   - Added `author: { name, email }` and SPDX `license`.
  17 |   - Removed `bugs` and `privacy` keys (not in the schema; `additionalProperties: false` would reject the manifest at validation).
  18 | - The CLI, MCP server, and Claude Code integrations are unaffected — this is purely a marketplace packaging change.
  19 | 
  20 | ## [0.3.0] — 2026-05-25
  21 | 
  22 | ### Added
  23 | - `token-ops uninstall [target]` command — mirrors `install`, removes only what install created and preserves unrelated `.claude/settings.local.json` hooks/permissions and `AGENTS.md` content.
  24 | - LICENSE file (MIT) so GitHub auto-detects the license and Cursor Marketplace requirements are met.
  25 | - GitHub Actions CI workflow running `npm test` on Node 18 / 20 / 22 for every push and PR to `main`.
  26 | - Unit-test suite for the pure helpers (`extractKeywords`, `estimateTokens`, `finalizeTokenBudget`, `shouldInjectForPrompt`, `resolveLanguage`) — 15 tests in `test/core.test.js`.
  27 | - `docs/sample-pack.md` checked in as a verbatim sample of pack output.
  28 | - "Measured Savings" section in README with a Mermaid bar chart, a real-task table, a "what 'saved' actually measures" explainer, and verification steps.
  29 | 
  30 | ### Changed
  31 | - **`estimateTokens` is now script-aware**: ASCII counted at `length / 4`, CJK (Han / Hiragana / Katakana) counted at `length / 1.5`. Token estimates for Japanese-heavy content now better reflect BPE tokenizer behavior. Numerical savings reports will shift accordingly.
  32 | - **`extractKeywords` splits Japanese into per-word tokens** (Han runs and Katakana runs of 2+ chars), instead of treating contiguous CJK as a single keyword. Fixes the case where a whole Japanese sentence was used as one keyword.
  33 | - **`shouldInjectForPrompt` adds JA bug-report triggers** (`バグ`, `直`, `不具合`, `動かな`, `壊`) and lowers the minimum prompt length from 12 to 6 chars so short Japanese requests like `バグを直して` fire the Claude Code hook.
  34 | - **`shouldInjectForPrompt` uses `\b` word boundaries for English triggers** so `fix` no longer matches `prefix` / `fixture` and `add` no longer matches `address`. Japanese substring matching is preserved (`\b` is unreliable around CJK).
  35 | - **`rankFiles` bridges ~30 Japanese tech terms to their English equivalents** during file ranking, so Japanese prompts can match English-named files (e.g. `キーワード` → `keyword`, `バグ` → `bug`).
  36 | - Default GitHub branch changed from a feature branch to `main`.
  37 | - Repository description set on GitHub.
  38 | 
  39 | ### Fixed
  40 | - Cleaned up stale feature branch (`codex/cursor-plugin-mvp`) on origin.
  41 | - `.gitignore` now excludes `.claude/` since installed hook configs contain absolute paths that would break for other contributors.
  42 | 
  43 | ## [0.2.0] — 2026-05-24
  44 | 
  45 | ### Added
  46 | - Initial Cursor Marketplace plugin packaging (`plugin.json`, beginner defaults of 6 files / 80 snippet lines).
  47 | - One-command editor setup: `token-ops install [target]` writes Claude Code skill, Claude Code `UserPromptSubmit` hook, Cursor rule, and `AGENTS.md` block.
  48 | - MCP server (`mcp/server.js`) exposing `build_compact_context`, `estimate_context_cost`, `list_high_cost_files`, `report_saved_tokens`.
  49 | - CLI commands: `pack`, `report`, `cost`, `high-cost-files`, `install`, `hook`.
  50 | - `MARKETPLACE.md` and `SECURITY.md` documentation for distribution and privacy posture.
  51 | - Bilingual output (auto / en / ja) for packs and the savings report.
  52 | 
```

### .cursor-plugin/plugin.json

```json
   1 | {
   2 |   "$schema": "https://cursor.com/schemas/cursor-plugin/plugin.json",
   3 |   "name": "token-ops",
   4 |   "displayName": "Token Ops: AI Token Saver",
   5 |   "description": "Stop Cursor and Claude Code from wasting tokens on broad repo reads. Runs locally with no API key, account, or cloud backend.",
   6 |   "version": "0.3.1",
   7 |   "author": {
   8 |     "name": "Maiko Kojima",
   9 |     "email": "694169+maikoo811@users.noreply.github.com"
  10 |   },
  11 |   "publisher": "maikoo811",
  12 |   "homepage": "https://github.com/maikoo811/token-ops",
  13 |   "repository": "https://github.com/maikoo811/token-ops",
  14 |   "license": "MIT",
  15 |   "category": "developer-tools",
  16 |   "keywords": [
  17 |     "tokens",
  18 |     "context",
  19 |     "cursor",
  20 |     "claude-code",
  21 |     "mcp",
  22 |     "vibe-coding"
  23 |   ],
  24 |   "tags": [
  25 |     "tokens",
  26 |     "context",
  27 |     "mcp",
  28 |     "productivity",
  29 |     "agents"
  30 |   ],
  31 |   "rules": "./rules/",
  32 |   "skills": "./skills/",
  33 |   "commands": "./commands/",
  34 |   "mcpServers": {
  35 |     "token-ops": {
  36 |       "command": "node",
  37 |       "args": ["${PLUGIN_ROOT}/mcp/server.js"]
  38 |     }
  39 |   }
  40 | }
  41 | 
```

### docs/sample-pack.md

```md
   1 | # Token Ops Context Pack
   2 | 
   3 | ## Task
   4 | Fix the Japanese keyword tokenizer in extractKeywords
   5 | 
   6 | ## Token Budget
   7 | - Generated pack: ~5,015 tokens
   8 | - Selected full files baseline: ~14,174 tokens (6 files)
   9 | - Estimated saved: ~9,159 tokens (65%)
  10 | - Whole repository baseline: ~20,823 tokens (19 files)
  11 | - Avoided vs whole repository: ~15,808 tokens (76%)
  12 | 
  13 | ## Suggested Prompt
  14 | Use the context below to work on this task. Prefer the referenced files and snippets before reading broader repository context. If the snippets are insufficient, ask for or inspect only the smallest additional files needed.
  15 | 
  16 | Task: Fix the Japanese keyword tokenizer in extractKeywords
  17 | 
  18 | ## Repository
  19 | - Root: /Users/maiko/Documents/dev/token-ops
  20 | - Branch: feat/token-estimate-precision
  21 | - Estimated snippet tokens: ~4,669
  22 | 
  23 | ## Git Status
  24 | -  M README.md
  25 | -  M src/core.js
  26 | -  M test/core.test.js
  27 | 
  28 | ## Keywords
  29 | `japanese`, `keyword`, `tokenizer`, `in`, `extractkeywords`
  30 | 
  31 | ## Relevant Files
  32 | - README.md (~1,420 tokens full file)
  33 | - src/core.js (~4,712 tokens full file)
  34 | - test/core.test.js (~1,551 tokens full file)
  35 | - plugin.json (~294 tokens full file)
  36 | - docs/sample-pack.md (~4,003 tokens full file)
  37 | - test/cli.test.js (~2,194 tokens full file)
  38 | 
  39 | ## Snippets
  40 | ### README.md
  41 | 
  42 | ```md
  43 |    1 | # Token Ops
  44 |    2 | 
  45 |    3 | Token Ops reduces wasted context during AI coding sessions. It gives Cursor, Claude Code, Codex, and other MCP-compatible agents a compact task-focused context pack before they read broadly, then records an estimated saved-token report.
  46 |    4 | 
  47 |    5 | The product goal is simple: install once, vibe code normally, and see how much context the agent avoided.
  48 |    6 | 
  49 |    7 | ## Measured Savings
  50 |    8 | 
  51 |    9 | Real numbers from running `token-ops pack` against this repository (19 tracked files, ~20,780 tokens of full-repo context, script-aware estimator):
  52 |   10 | 
  53 |   11 | ```mermaid
  54 |   12 | ---
  55 |   13 | config:
  56 |   14 |   xyChart:
  57 |   15 |     width: 760
  58 |   16 |     height: 320
  59 |   17 |   themeVariables:
  60 |   18 |     xyChart:
  61 |   19 |       plotColorPalette: "#16a34a"
  62 |   20 | ---
  63 |   21 | xychart-beta
  64 |   22 |   title "Tokens saved per pack (vs whole-repo baseline, higher is better)"
  65 |   23 |   x-axis ["Fix JA tokenizer", "Add uninstall", "Build pack"]
  66 |   24 |   y-axis "Tokens saved" 0 --> 20000
  67 |   25 |   bar [15811, 17607, 16127]
  68 |   26 | ```
  69 |   27 | 
  70 |   28 | | Task | Pack size | Vs selected full files | Vs whole repo |
  71 |   29 | |---|---|---|---|
  72 |   30 | | `Fix the Japanese keyword tokenizer in extractKeywords` | ~4,969 tokens | 65% smaller | 76% smaller |
  73 |   31 | | `Add an uninstall command to the CLI` | ~3,173 tokens | 63% smaller | 85% smaller |
  74 |   32 | | `Build a compact context pack for the current task` | ~4,653 tokens | 68% smaller | 78% smaller |
  75 |   33 | 
  76 |   34 | A raw verbatim pack output is checked in at [docs/sample-pack.md](docs/sample-pack.md) so you can see exactly what Token Ops produces.
  77 |   35 | 
  78 |   36 | ### What "saved" actually measures
  79 |   37 | 
  80 |   38 | - **Pack size** is a rough token estimate: `length / 4` for ASCII and `length / 1.5` for CJK characters, summed. BPE tokenizers split CJK more aggressively than ASCII, so a single ratio underestimates Japanese-heavy content.
```

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

# Token Ops Context Pack

## Task
Fix the Japanese keyword tokenizer in extractKeywords

## Token Budget
- Generated pack: ~3,297 tokens
- Selected full files baseline: ~27,916 tokens (6 files)
- Estimated saved: ~24,619 tokens (88%)

## Suggested Prompt
Use the context below to work on this task. Prefer the referenced files and snippets before reading broader repository context. If the snippets are insufficient, ask for or inspect only the smallest additional files needed.

Task: Fix the Japanese keyword tokenizer in extractKeywords

## Repository
- Root: /Users/maiko/Documents/dev/token-ops
- Branch: chore/drop-whole-repo-framing
- Estimated snippet tokens: ~2,960

## Git Status
-  M README.ja.md
-  M README.md
-  M docs/sample-pack.md
-  M src/core.js

## Keywords
`japanese`, `keyword`, `tokenizer`, `in`, `extractkeywords`

## Relevant Files
- src/core.js (~7,692 tokens full file)
- .cursor-plugin/plugin.json (~260 tokens full file)
- bin/token-ops.js (~3,064 tokens full file)
- test/cli.test.js (~8,476 tokens full file)
- test/core.test.js (~4,515 tokens full file)
- src/integrations.js (~3,909 tokens full file)

## Snippets
### src/core.js

```js
   1 | import { execFileSync } from "node:child_process";
   2 | import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
   3 | import { basename, extname, join, relative, sep } from "node:path";
   4 | 
   5 | export const DEFAULT_MAX_FILES = 8;
   6 | export const DEFAULT_MAX_LINES = 120;
   7 | export const DEFAULT_CONTEXT = 8;
   8 | export const MAX_FILE_BYTES = 220_000;
   9 | export const DEFAULT_LANG = "auto";
  10 | 
  11 | export const MAX_TRACKED_FILES = 50_000;
  12 | export const GIT_TIMEOUT_MS = 10_000;
  13 | 
  14 | export const SESSION_LOG_MAX_BYTES = 2 * 1024 * 1024;
  15 | export const SESSION_LOG_KEEP_LINES = 10_000;
  16 | 
  17 | const STOP_WORDS = new Set([
  18 |   "the",
  19 |   "and",
  20 |   "for",
  21 |   "with",
  22 |   "from",
  23 |   "this",
  39 |   "の",
  40 |   "を",
  41 |   "に",
  42 |   "へ",
  43 |   "で"
  44 | ]);
  45 | 
  46 | const JA_TO_EN = new Map([
  47 |   ["キーワード", ["keyword"]],
  48 |   ["抽出", ["extract", "extractor"]],
  49 |   ["バグ", ["bug"]],
  50 |   ["関数", ["function", "func"]],
  51 |   ["テスト", ["test", "spec"]],
  52 |   ["クラス", ["class"]],
  53 |   ["型", ["type"]],
  54 |   ["設定", ["config", "setting", "option"]],
  55 |   ["認証", ["auth"]],
  56 |   ["接続", ["connection", "connect"]],
  57 |   ["削除", ["delete", "remove"]],
  58 |   ["追加", ["add", "insert"]],
  59 |   ["取得", ["get", "fetch"]],
  60 |   ["保存", ["save", "persist"]],
  61 |   ["読込", ["load", "read"]],
  62 |   ["書込", ["write"]],
  63 |   ["一覧", ["list"]],
  64 |   ["詳細", ["detail"]],
  65 |   ["概要", ["summary", "overview"]],
```

### .cursor-plugin/plugin.json

```json
   1 | {
   2 |   "$schema": "https://cursor.com/schemas/cursor-plugin/plugin.json",
   3 |   "name": "token-ops",
   4 |   "displayName": "Token Ops: AI Token Saver",
   5 |   "description": "Stop Cursor and Claude Code from wasting tokens on broad repo reads. Runs locally with no API key, account, or cloud backend.",
   6 |   "version": "0.6.2",
   7 |   "author": {
   8 |     "name": "Maiko Kojima",
   9 |     "email": "694169+maikoo811@users.noreply.github.com"
  10 |   },
  11 |   "publisher": "maikoo811",
  12 |   "homepage": "https://github.com/maikoo811/token-ops",
  13 |   "repository": "https://github.com/maikoo811/token-ops",
  14 |   "license": "MIT",
  15 |   "logo": "assets/avatar.png",
  16 |   "category": "developer-tools",
  17 |   "keywords": [
  18 |     "tokens",
  19 |     "context",
  20 |     "cursor",
  21 |     "claude-code",
  22 |     "mcp",
  23 |     "vibe-coding"
  24 |   ],
  25 |   "tags": [
  26 |     "tokens",
  27 |     "context",
  28 |     "mcp",
  29 |     "productivity",
  30 |     "agents"
  31 |   ],
  32 |   "rules": "./rules/",
  33 |   "skills": "./skills/",
  34 |   "commands": "./commands/",
  35 |   "mcpServers": {
  36 |     "token-ops": {
  37 |       "command": "node",
  38 |       "args": ["${PLUGIN_ROOT}/mcp/server.js"]
  39 |     }
  40 |   }
  41 | }
  42 | 
```

### bin/token-ops.js

```js
   1 | #!/usr/bin/env node
   2 | 
   3 | // Manual version guard: the ESM imports below are hoisted, so a `package.json`
   4 | // `engines` failure would surface as an opaque syntax error on Node 16/17
   5 | // before this file's logic runs. Emit a readable message instead.
   6 | const NODE_MAJOR = Number.parseInt(process.versions.node.split(".")[0], 10);
   7 | if (NODE_MAJOR < 18) {
   8 |   process.stderr.write(
   9 |     `token-ops requires Node.js 18 or later. You are running ${process.version}.\n` +
  10 |       "Please upgrade: https://nodejs.org\n"
  11 |   );
  12 |   process.exit(1);
  13 | }
  14 | 
  15 | import { readFileSync, writeFileSync } from "node:fs";
  16 | import { join } from "node:path";
  17 | import {
  18 |   DEFAULT_LANG,
  19 |   DEFAULT_MAX_FILES,
  20 |   DEFAULT_MAX_LINES,
  21 |   DEFAULT_TRIGGER_MODE,
  22 |   colorizeForTty,
  23 |   estimateContextCost,
  24 |   generatePack,
  25 |   listHighCostFiles,
  26 |   simplifyForTerminal,
  27 |   readLanguage,
  28 |   readSavingsReport,
  29 |   readTriggerMode,
  30 |   recordSessionEvent,
  31 |   renderSavingsReport,
  32 |   resolveLanguage,
  33 |   shouldInjectForPrompt,
  34 |   toPositiveInt,
  35 |   validateCwd
  36 | } from "../src/core.js";
  37 | import {
  38 |   findTrackedManagedFiles,
  39 |   installIntegration,
  40 |   isNvmManagedNode,
  41 |   renderCursorRule,
  42 |   uninstallIntegration
  43 | } from "../src/integrations.js";
  44 | 
  45 | const args = process.argv.slice(2);
  46 | const command = args.shift();
  47 | 
  48 | try {
  49 |   if (!command || command === "-h" || command === "--help") {
  50 |     printHelp();
```

### test/cli.test.js

```js
   1 | import { execFileSync } from "node:child_process";
   2 | import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
   3 | import { tmpdir } from "node:os";
   4 | import { join, resolve } from "node:path";
   5 | import test from "node:test";
   6 | import assert from "node:assert/strict";
   7 | import { shouldInjectForPrompt } from "../src/core.js";
   8 | import { isNvmManagedNode } from "../src/integrations.js";
   9 | 
  10 | const cli = resolve("bin/token-ops.js");
  11 | 
  12 | test("prints help", () => {
  13 |   const output = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  14 |   assert.match(output, /token-ops/);
  15 |   assert.match(output, /pack/);
  16 | });
  17 | 
  18 | test("builds a compact context pack from a git repository", () => {
  19 |   const cwd = mkdtempSync(join(tmpdir(), "token-ops-"));
  20 |   execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  21 |   execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  22 |   execFileSync("git", ["config", "user.name", "Token Ops Test"], { cwd });
  23 | 
  24 |   writeFileSync(join(cwd, "importer.js"), "export function importCsv(row) {\n  return row.csv_id;\n}\n");
  25 |   writeFileSync(join(cwd, "README.md"), "# Demo\n");
  26 |   execFileSync("git", ["add", "."], { cwd });
  27 |   execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });
  28 | 
  29 |   const output = execFileSync(process.execPath, [cli, "pack", "fix csv importer"], {
  30 |     cwd,
  31 |     encoding: "utf8"
  32 |   });
  33 | 
  34 |   assert.match(output, /# Token Ops Context Pack/);
  35 |   assert.match(output, /importer\.js/);
  36 |   assert.match(output, /csv_id/);
  37 | 
  38 |   const report = execFileSync(process.execPath, [cli, "report"], {
  39 |     cwd,
  40 |     encoding: "utf8"
  41 |   });
  42 |   assert.match(report, /Token Ops Savings Report/);
  43 |   assert.match(report, /Runs: 1/);
  44 | });
  45 | 
  46 | test("installs Cursor and Claude Code project helpers", () => {
  47 |   const cwd = mkdtempSync(join(tmpdir(), "token-ops-install-"));
  48 |   const output = execFileSync(process.execPath, [cli, "install"], {
  49 |     cwd,
  50 |     encoding: "utf8"
```

### test/core.test.js

```js
   1 | import { execFileSync } from "node:child_process";
   2 | import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
   3 | import { tmpdir, platform } from "node:os";
   4 | import { join } from "node:path";
   5 | import test from "node:test";
   6 | import assert from "node:assert/strict";
   7 | import {
   8 |   colorizeForTty,
   9 |   extractKeywords,
  10 |   estimateTokens,
  11 |   finalizeTokenBudget,
  12 |   simplifyForTerminal,
  13 |   readSavingsReport,
  14 |   recordSessionEvent,
  15 |   SESSION_LOG_KEEP_LINES,
  16 |   SESSION_LOG_MAX_BYTES,
  17 |   shouldInjectForPrompt,
  18 |   resolveLanguage
  19 | } from "../src/core.js";
  20 | 
  21 | // ---- extractKeywords ----
  22 | 
  23 | test("extractKeywords: ASCII tokens are lowercased and stop words dropped", () => {
  24 |   const out = extractKeywords("Fix the CSV import bug");
  25 |   assert.deepEqual(out, ["csv", "import", "bug"]);
  26 | });
  27 | 
  28 | test("extractKeywords: Japanese is split into per-word Han/Katakana tokens", () => {
  29 |   const out = extractKeywords("キーワード抽出のバグを直して");
  30 |   assert.ok(out.includes("キーワード"));
  31 |   assert.ok(out.includes("抽出"));
  32 |   assert.ok(out.includes("バグ"));
  33 |   assert.ok(!out.includes("キーワード抽出のバグを直して"));
  34 | });
  35 | 
  36 | test("extractKeywords: hiragana-only tokens are dropped (grammar particles)", () => {
  37 |   const out = extractKeywords("ファイルをひらいて");
  38 |   assert.ok(out.includes("ファイル"));
  39 |   assert.ok(!out.includes("ひらいて"));
  40 | });
  41 | 
  42 | test("extractKeywords: drops Japanese stop words 修正/追加/実装/変更", () => {
  43 |   // Note: contiguous Han runs become a single token (no morphological split),
  44 |   // so "認証機能" is one keyword, not 認証 + 機能.
  45 |   const out = extractKeywords("バグを修正したい");
  46 |   assert.ok(out.includes("バグ"));
  47 |   assert.ok(!out.includes("修正"), "stop word 修正 should be dropped");
  48 | });
  49 | 
  50 | test("extractKeywords: returns at most 20 unique keywords", () => {
```

### src/integrations.js

```js
   1 | import { execFileSync } from "node:child_process";
   2 | import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
   3 | import { homedir } from "node:os";
   4 | import { dirname, join } from "node:path";
   5 | 
   6 | // Each entry embeds an absolute path or user-specific data; committing any
   7 | // of them leaks the maintainer's environment and breaks teammates' configs.
   8 | const GITIGNORE_HEADER = "# Token Ops local files";
   9 | const GITIGNORE_ENTRIES = [
  10 |   ".token-ops/",
  11 |   ".claude/settings.local.json",
  12 |   ".claude/skills/token-ops/SKILL.md"
  13 | ];
  14 | // Legacy header used by v0.4.x installs; recognized on uninstall.
  15 | const GITIGNORE_LEGACY_HEADER = "# Token Ops session log";
  16 | 
  17 | export function installIntegration({ cwd, target, cliPath, nodePath, triggerMode = "smart", global = false }) {
  18 |   const validTargets = new Set(["all", "claude", "claude-hook", "cursor", "codex"]);
  19 | 
  20 |   if (!validTargets.has(target)) {
  21 |     throw new Error("install target must be one of: all, claude, claude-hook, cursor, codex");
  22 |   }
  23 | 
  24 |   if (global && target === "codex") {
  25 |     throw new Error("--global is not supported for codex (AGENTS.md is project-scoped)");
  26 |   }
  27 | 
  28 |   const installed = [];
  29 |   const root = global ? homedir() : cwd;
  30 |   // settings.local.json is host-specific (gitignored); settings.json is user-wide.
  31 |   const claudeSettingsFile = global ? "settings.json" : "settings.local.json";
  32 |   const displayPrefix = global ? "~" : "";
  33 | 
  34 |   if (target === "all" || target === "claude" || target === "claude-hook") {
  35 |     const skillDir = join(root, ".claude", "skills", "token-ops");
  36 |     mkdirSync(skillDir, { recursive: true });
  37 |     writeFileSync(join(skillDir, "SKILL.md"), renderClaudeSkill(cliPath));
  38 |     installed.push(`${displayPrefix}/.claude/skills/token-ops/SKILL.md`.replace(/^\//, ""));
  39 |   }
  40 | 
  41 |   if (target === "all" || target === "claude-hook") {
  42 |     const settingsPath = join(root, ".claude", claudeSettingsFile);
  43 |     mkdirSync(join(root, ".claude"), { recursive: true });
  44 |     writeFileSync(settingsPath, renderClaudeHookSettings(settingsPath, cliPath, triggerMode, nodePath));
  45 |     installed.push(`${displayPrefix}/.claude/${claudeSettingsFile}`.replace(/^\//, ""));
  46 |   }
  47 | 
  48 |   if (target === "all" || target === "cursor") {
  49 |     if (global) {
  50 |       // User Rules are GUI-only; only the MCP entry can be installed from disk.
```

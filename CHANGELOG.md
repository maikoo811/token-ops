# Changelog

All notable changes to Token Ops are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] — 2026-05-25

Tier-1 hardening based on a follow-up Clearline review. Five small, focused fixes — no behavior change for the typical user.

### Added
- **Symlink traversal guard**: new `safeAbsPath(cwd, file)` helper resolves real paths and rejects any tracked file whose resolved path escapes the repository root. Applied in `listTrackedFiles` so a malicious repo with a tracked symlink (e.g. `ln -s /etc/passwd secret.txt`) can never leak host-machine content into a context pack.
- **`MAX_TRACKED_FILES = 50_000` ceiling**: `listTrackedFiles` truncates with a stderr warning on absurdly large repos so the tool stays responsive on 500k-file monorepos.
- **`GIT_TIMEOUT_MS = 10_000`**: every `git` invocation now has a 10s timeout, preventing indefinite hangs on slow / network-mounted filesystems.
- **MCP server in-flight cap** (`MAX_IN_FLIGHT = 3`): a misbehaving MCP client that loops `tools/call` can no longer saturate disk I/O — the 4th concurrent call is rejected with a clear error.
- **Structured stderr logger** in `mcp/server.js`: all stderr output now follows `[token-ops-mcp] LEVEL ISO-TIMESTAMP message` so users filing bug reports can grep / awk for triage.

### Documented
- `trimSessionLog` now carries an explicit comment explaining the deliberate best-effort design (concurrent trims can drop a handful of recent lines; an explicit file lock would be heavier than the value justifies).

### Tests
- `symlink to a file outside the repo is never included in the pack` — full integration test that creates a real symlink to a temp file outside the repo, commits it, and asserts the secret content does not appear in pack output.
- `MCP server stderr lines use the structured [token-ops-mcp] LEVEL ISO-TIMESTAMP format` — verifies the new logger contract.
- Updated the existing error-handling test to match the new structured format.

Total: 49/49 passing.

### Deferred (Tier 2/3)
- Absolute-path output: kept `Root: /Users/<user>/...` in pack output by default since it's actually useful debugging context. To revisit if enterprise users request opt-out.
- File-token estimate cache: the reviewer downgraded this from MED to LOW; defer until a real user reports `pack` being slow on a large repo.

## [0.4.0] — 2026-05-25

Marketplace-readiness hardening pass — based on an external code review (Clearline). Addresses one HIGH (security) and several MEDIUM/LOW items before Cursor Marketplace submission.

### Added
- **`recordSessionEvent` log rotation**: `.token-ops/session.jsonl` is now capped at 2 MB. When the file exceeds the cap, it is rewritten keeping the last 10,000 entries. Trimming runs only after the append that crosses the threshold, so steady-state usage pays zero overhead.
- **MCP server stderr diagnostics**: global `uncaughtException` / `unhandledRejection` handlers and a stderr write in the `handleMessage` catch block. Cursor / Claude Code now see a real error instead of a silent "server in error state."
- **`.gitignore` auto-management**: `token-ops install` appends a `.token-ops/` entry to the project `.gitignore` (creating the file if missing); `token-ops uninstall` (all-target) removes the same block. Prevents accidental session-log commits.
- **CLI Node.js version guard**: `bin/token-ops.js` exits with a readable upgrade message on Node < 18. `.npmrc` sets `engine-strict=true` so installs on unsupported Node also fail loudly.

### Fixed
- **MCP `cwd` validation (security)**: `readCwd` now resolves the incoming path with `realpathSync`, confirms it is a directory, and runs `git rev-parse --git-dir` to confirm it is a git repository. Prevents a malicious or misconfigured MCP client from pointing the server at `/etc`, `/`, or any other arbitrary location and using it as a filesystem-read primitive. The function still defaults to `process.cwd()` when the caller omits the field.
- **MCP server hardcoded version**: the `initialize` response now reads the version from `package.json` at startup instead of a hardcoded string literal, so future releases no longer require touching `mcp/server.js`.

### Tests
- 9 new tests across `core.test.js`, `mcp.test.js`, and `cli.test.js` covering: log rotation behaviour (over-cap trim + under-cap append), MCP version dynamic read, cwd rejection (non-git / missing path), cwd acceptance (valid git repo), `.gitignore` create / preserve / uninstall round-trip. Total: 47/47 passing.

## [0.3.4] — 2026-05-25

### Added
- `--trigger-mode <smart|aggressive>` flag on the Claude Code hook. `smart` (default) keeps the existing coding-keyword trigger; `aggressive` fires on any prompt that is ≥ 6 chars and not self-referential. `install claude-hook --trigger-mode aggressive` bakes the flag into `.claude/settings.local.json`. Also honors the `TOKEN_OPS_TRIGGER_MODE` env var.

### Why
Trigger-word filtering was missing many coding-relevant prompts that happened not to contain `fix` / `bug` / 修正 / etc. Coding-only repos benefit from firing the hook on every qualifying prompt; mixed-use repos can stay on `smart` to avoid hook injection on chit-chat.

## [0.3.3] — 2026-05-25

### Fixed
- **MCP stdio framing**: the server previously used LSP-style `Content-Length` headers, which the modern MCP stdio spec replaced with newline-delimited JSON. Cursor 3.x couldn't talk to it — initialize would hang and the listing would show the server in an error state. The server now defaults to newline-delimited JSON-RPC and keeps Content-Length as a fallback for legacy clients.
- Recommended user-level config in `~/.cursor/mcp.json` now uses the absolute path to the `node` binary instead of the bare `node` command, because Cursor GUI subprocesses do not inherit nvm's PATH modifications.

### Added
- `test/mcp.test.js`: 4 integration tests covering the MCP server's stdio framing (newline-delimited init, multi-message stream, Content-Length fallback, error response shape).

## [0.3.2] — 2026-05-25

### Added
- Expanded JA→EN keyword bridge with ~25 high-frequency project / structure terms: フォルダ, ディレクトリ, 構造, 構成, アーキテクチャ, 見直, 整理, リファクタ, 依存, ビルド, デプロイ, 環境, 変数, 機能, 画面, ページ, ルーティング, スタイル, 状態, コンポーネント, データベース, スキーマ, 移行, ドキュメント, エージェント, プロンプト. Closes the gap exposed when running `pack "フォルダ構造を見直して"` and getting zero matches.
- Regression test for the expanded bridge — a folder-structure prompt now matches a `folder-layout.md` file.

### Fixed
- Survey-style Japanese prompts ("フォルダ構造を見直して" etc.) previously returned 0 relevant files because the bridge missed `フォルダ` / `構造` / `見直し`. Now resolves to multiple structure/architecture/review files via the English equivalents.

## [0.3.1] — 2026-05-25

### Changed
- Refactored the plugin manifest to match the official Cursor Marketplace schema (`https://cursor.com/schemas/cursor-plugin/plugin.json`):
  - Moved manifest from root `plugin.json` to `.cursor-plugin/plugin.json` (required location).
  - Replaced the `components: { ... }` wrapper with top-level `skills` / `rules` / `commands` / `mcpServers` keys.
  - Switched `categories: [array]` → `category: "developer-tools"` (singular).
  - Converted `repository` from an object to a URL string.
  - Added `author: { name, email }` and SPDX `license`.
  - Removed `bugs` and `privacy` keys (not in the schema; `additionalProperties: false` would reject the manifest at validation).
- The CLI, MCP server, and Claude Code integrations are unaffected — this is purely a marketplace packaging change.

## [0.3.0] — 2026-05-25

### Added
- `token-ops uninstall [target]` command — mirrors `install`, removes only what install created and preserves unrelated `.claude/settings.local.json` hooks/permissions and `AGENTS.md` content.
- LICENSE file (MIT) so GitHub auto-detects the license and Cursor Marketplace requirements are met.
- GitHub Actions CI workflow running `npm test` on Node 18 / 20 / 22 for every push and PR to `main`.
- Unit-test suite for the pure helpers (`extractKeywords`, `estimateTokens`, `finalizeTokenBudget`, `shouldInjectForPrompt`, `resolveLanguage`) — 15 tests in `test/core.test.js`.
- `docs/sample-pack.md` checked in as a verbatim sample of pack output.
- "Measured Savings" section in README with a Mermaid bar chart, a real-task table, a "what 'saved' actually measures" explainer, and verification steps.

### Changed
- **`estimateTokens` is now script-aware**: ASCII counted at `length / 4`, CJK (Han / Hiragana / Katakana) counted at `length / 1.5`. Token estimates for Japanese-heavy content now better reflect BPE tokenizer behavior. Numerical savings reports will shift accordingly.
- **`extractKeywords` splits Japanese into per-word tokens** (Han runs and Katakana runs of 2+ chars), instead of treating contiguous CJK as a single keyword. Fixes the case where a whole Japanese sentence was used as one keyword.
- **`shouldInjectForPrompt` adds JA bug-report triggers** (`バグ`, `直`, `不具合`, `動かな`, `壊`) and lowers the minimum prompt length from 12 to 6 chars so short Japanese requests like `バグを直して` fire the Claude Code hook.
- **`shouldInjectForPrompt` uses `\b` word boundaries for English triggers** so `fix` no longer matches `prefix` / `fixture` and `add` no longer matches `address`. Japanese substring matching is preserved (`\b` is unreliable around CJK).
- **`rankFiles` bridges ~30 Japanese tech terms to their English equivalents** during file ranking, so Japanese prompts can match English-named files (e.g. `キーワード` → `keyword`, `バグ` → `bug`).
- Default GitHub branch changed from a feature branch to `main`.
- Repository description set on GitHub.

### Fixed
- Cleaned up stale feature branch (`codex/cursor-plugin-mvp`) on origin.
- `.gitignore` now excludes `.claude/` since installed hook configs contain absolute paths that would break for other contributors.

## [0.2.0] — 2026-05-24

### Added
- Initial Cursor Marketplace plugin packaging (`plugin.json`, beginner defaults of 6 files / 80 snippet lines).
- One-command editor setup: `token-ops install [target]` writes Claude Code skill, Claude Code `UserPromptSubmit` hook, Cursor rule, and `AGENTS.md` block.
- MCP server (`mcp/server.js`) exposing `build_compact_context`, `estimate_context_cost`, `list_high_cost_files`, `report_saved_tokens`.
- CLI commands: `pack`, `report`, `cost`, `high-cost-files`, `install`, `hook`.
- `MARKETPLACE.md` and `SECURITY.md` documentation for distribution and privacy posture.
- Bilingual output (auto / en / ja) for packs and the savings report.

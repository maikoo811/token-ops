# Changelog

All notable changes to Token Ops are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

# Changelog

All notable changes to Token Ops are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.5] — 2026-06-21

### Fixed
- `token-ops report` headline numbers now reconcile: the saved figure is derived from the aggregated without/with totals (`未使用 − 使用 = 節約`) instead of summing per-entry `savedTokens`, which is clamped at 0 and overstated the total whenever a run's pack exceeded reading its selected files in full. (#80)

## [0.6.4] — 2026-06-20

### Added
- `token-ops --version` / `token-ops -v` prints the installed version. Previously users had to fall back to `npm list -g token-ops` to confirm which build was on disk. (#75)

## [0.6.3] — 2026-06-20

### Fixed
- `token-ops install cursor --global` now realpath-resolves the CLI symlink before computing the MCP server path. Previously, global npm installs wrote a non-existent path (`<prefix>/mcp/server.js` instead of `<prefix>/lib/node_modules/token-ops/mcp/server.js`) into `~/.cursor/mcp.json`, so Cursor silently failed to start the MCP server and `build_compact_context` never fired. (#72)

### Changed
- README Quick Start now states upfront that Token Ops requires git (`git init` if not already a repo, no remote needed)

## [0.6.2] — 2026-06-08

### Added
- `install` now warns when managed files (`.claude/settings.local.json`, `.claude/skills/token-ops/SKILL.md`, `.token-ops/`) are already tracked by git — prints the exact `git rm --cached` command to fix
- `install` now prints a one-time notice when run from an nvm-managed node, reminding users to re-run install after `nvm install` (otherwise the hook's absolute node path silently breaks)

## [0.6.1] — 2026-06-07

### Fixed
- `.claude/skills/token-ops/SKILL.md` is now auto-added to `.gitignore` on install (it embeds an absolute `cliPath` from `process.argv[1]`, so committing it leaks the maintainer's path and breaks teammates' configs)

## [0.6.0] — 2026-06-06

### Added
- `token-ops install --global` / `uninstall --global` — install user-wide to `~/.claude/` and `~/.cursor/mcp.json` so Token Ops fires in every project (codex remains project-only)
- AST-bounded snippet extraction for JS/TS — snippet contains the whole enclosing function or class instead of an arbitrary N-line window; falls back to window mode when the block exceeds `--max-lines`
- Symbol-aware file ranking — files that define a keyword as a function / class / type / interface / enum outrank files that only mention it

### Changed
- README Quick Start tightened: removed inline comments, removed duplicate `token-ops report` block, added screenshot of colorized report output
- Reorganized README so install / setup come before MCP / Levels of Automation reference

## [0.5.1] — 2026-05-31

### Fixed
- `package.json` now declares `repository`, `homepage`, `bugs`, and `author` — npm can now resolve the Measured Savings screenshot path (was broken on the npm package page) and shows GitHub / Issues links in the sidebar

## [0.5.0] — 2026-05-30

First release on the npm registry.

### Added
- TTY-only colorization for `token-ops pack` / `report`
- `pack` hides LLM-only sections in TTY mode; `--full` overrides
- `.github/workflows/publish.yml` — tag-triggered npm publish with provenance
- `.claude/settings.local.json` auto-added to `.gitignore` on install
- Measured Savings opens with a real CLI screenshot

### Changed
- Hook `command` pinned to absolute node path (GUI editors with nvm/asdf)
- Symlink guard extended to `.token-ops/session.jsonl` read/write paths
- README copy tightened across 6 sections
- Source comment density reduced ~72% (keep WHY, drop WHAT)

## [0.4.4] — 2026-05-25

### Added
- `package.json` `files` and `exports` fields (npm publish hygiene)
- `TOKEN_OPS_DISABLE_LOG=1` env var to skip session logging (see SECURITY.md)
- Hard caps on MCP tool args (maxFiles ≤ 50, maxLines ≤ 300, limit ≤ 200)
- `SECURITY.md`: data flow disclosure + GitHub Security Advisories link

## [0.4.3] — 2026-05-25

### Changed
- README "Measured Savings" uses real session data via `docs/session-stats.mjs` (replaces synthetic 3-task table with prompt-type breakdown)
- Headline metric switched from whole-repo (ceiling) to vs same ranked files in full (honest comparison)
- Prompt contents no longer disclosed in README — only prompt-type categories

### Added
- `docs/session-stats.mjs` — zero-dep Node 18+ script to reproduce the breakdown from any project's `.token-ops/session.jsonl`

## [0.4.2] — 2026-05-25

### Changed
- Extracted shared `validateCwd` helper to `src/core.js`; both MCP `readCwd` and Claude Code hook now share it
- Hook wraps `validateCwd` with fallback to `process.cwd()` so a bogus `input.cwd` never crashes it

## [0.4.1] — 2026-05-25

### Added
- Symlink traversal guard (`safeAbsPath`): rejects tracked files whose resolved path escapes the repo root
- `MAX_TRACKED_FILES = 50_000` ceiling with stderr warning
- `GIT_TIMEOUT_MS = 10_000` on every git invocation
- MCP in-flight cap (`MAX_IN_FLIGHT = 3`)
- Structured stderr logger: `[token-ops-mcp] LEVEL ISO-TIMESTAMP message`

### Documented
- `trimSessionLog`: comment explains best-effort concurrent-trim design

## [0.4.0] — 2026-05-25

### Added
- `recordSessionEvent` log rotation (2 MB cap, keep last 10k entries)
- MCP server stderr diagnostics (`uncaughtException` / `unhandledRejection`)
- `.gitignore` auto-management during install/uninstall
- CLI Node.js version guard + `.npmrc` `engine-strict=true`

### Fixed
- MCP `cwd` validation: realpathSync + isDirectory + `git rev-parse --git-dir`
- MCP server version read from `package.json` (no more hardcoded literal)

## [0.3.4] — 2026-05-25

### Added
- `--trigger-mode <smart|aggressive>` flag on the Claude Code hook
  - `smart` (default): requires coding keyword
  - `aggressive`: fires on any prompt ≥ 6 chars, non self-referential
- Honored via `TOKEN_OPS_TRIGGER_MODE` env var or `install claude-hook --trigger-mode`

## [0.3.3] — 2026-05-25

### Fixed
- MCP stdio framing: server now defaults to newline-delimited JSON-RPC (modern MCP spec). Cursor 3.x couldn't talk to the previous Content-Length framing. Legacy framing kept as fallback.
- Recommended `~/.cursor/mcp.json` uses absolute node path (Cursor GUI doesn't inherit nvm PATH)

## [0.3.2] — 2026-05-25

### Added
- Expanded JA→EN keyword bridge (~25 project / structure terms: フォルダ, 構造, 見直, リファクタ, ビルド, デプロイ, ページ, etc.)

### Fixed
- Survey-style Japanese prompts ("フォルダ構造を見直して") now match English-named files

## [0.3.1] — 2026-05-25

### Changed
- Plugin manifest moved from `plugin.json` to `.cursor-plugin/plugin.json` (Cursor Marketplace required location)
- Schema-compliant fields: `category` (singular), `repository` as URL string, `author` object, removed `bugs` / `privacy` (schema rejects them)

## [0.3.0] — 2026-05-25

### Added
- `token-ops uninstall [target]` command (non-destructive, mirrors install)
- LICENSE (MIT), GitHub Actions CI (Node 18 / 20 / 22)
- Unit tests for pure helpers (15 tests in `test/core.test.js`)
- `docs/sample-pack.md` sample output
- README "Measured Savings" section (Mermaid + table + verification steps)

### Changed
- `estimateTokens` is script-aware: ASCII `length / 4`, CJK `length / 1.5`
- `extractKeywords` splits Japanese into per-word tokens (Han / Katakana runs ≥ 2 chars)
- `shouldInjectForPrompt` adds JA bug-report triggers (`バグ`, `直`, `不具合`, etc.); lowered min prompt length to 6
- English triggers use `\b` boundaries (so `fix` doesn't match `prefix`)
- `rankFiles` bridges ~30 Japanese tech terms to English equivalents

## [0.2.0] — 2026-05-24

### Added
- Initial Cursor Marketplace plugin packaging (`plugin.json`, beginner defaults of 6 files / 80 snippet lines)
- `token-ops install [target]` command (writes Claude Code skill, hook, Cursor rule, AGENTS.md)
- MCP server (`mcp/server.js`) with `build_compact_context`, `estimate_context_cost`, `list_high_cost_files`, `report_saved_tokens`
- CLI commands: `pack`, `report`, `cost`, `high-cost-files`, `install`, `hook`
- `MARKETPLACE.md`, `SECURITY.md`
- Bilingual output (auto / en / ja)

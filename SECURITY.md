# Security and Privacy

Token Ops is designed for local-first use.

## Defaults

- No API key required
- No account required
- No hosted backend required
- No telemetry by default
- Local MCP server over stdio
- Session reports are written to `.token-ops/session.jsonl` inside the repository

## What Token Ops sends to the LLM

When the context pack is injected as additional context, the LLM receives:

- Repository absolute path (e.g. `/Users/<you>/dev/<project>` on macOS, `/home/<you>/...` on Linux, or the Windows equivalent)
- Current git branch name
- Git status (changed / untracked file names)
- File paths from `git ls-files` (filtered to text files only)
- Snippets (~80 lines by default) of files matching task keywords
- Task description (your prompt text)

Token Ops does NOT send:

- File contents from outside the git repo (symlinks escaping the repo are rejected)
- Files in `.gitignored` paths
- The contents of `.token-ops/session.jsonl` itself

If your repository contains accidentally-committed secrets (`.env` files, keys, etc.), those files would be visible to the AI via normal Read/Grep operations anyway. Token Ops does not introduce a new exposure vector.

## What Token Ops writes to disk

- `.token-ops/session.jsonl` in each project where Token Ops is invoked (auto-added to `.gitignore` by `token-ops install`; if you wired the hook manually, add it yourself)
- `.claude/skills/token-ops/SKILL.md` and `.claude/settings.local.json` during `token-ops install claude-hook`
- `.cursor/rules/token-ops.mdc` during `token-ops install cursor`
- `AGENTS.md` block during `token-ops install codex`

`token-ops uninstall` removes all of the above, preserving any unrelated content in the same files.

## Session log contents and opt-out

`.token-ops/session.jsonl` records every pack generation event with the following fields:

- `timestamp` (ISO 8601)
- `type` (`pack` / `hook` / `mcp.*`)
- `task` — **the full text of your prompt**
- `budget` — token counts (pack size, file count, saved estimates)
- `files` — paths of files included in the pack

The `task` field is the main privacy consideration: if your prompts contain secrets, customer names, internal repo names, or otherwise sensitive content, they are written to disk in plain text.

**To opt out of session logging entirely:**

```sh
export TOKEN_OPS_DISABLE_LOG=1
```

When this environment variable is set to `1`, `recordSessionEvent` is a no-op. `token-ops report` will show zero runs, and `.token-ops/session.jsonl` is not created. Set this in the same shell / hook environment where Token Ops runs.

For enterprise users handling sensitive prompts, set `TOKEN_OPS_DISABLE_LOG=1` in your shell rc file or in the Claude Code hook's env block.

## Reporting Issues

Please report security vulnerabilities privately via [GitHub Security Advisories](https://github.com/maikoo811/token-ops/security/advisories/new). This creates a private, encrypted channel with the maintainer — do not file a public issue for security reports.

Public disclosure can follow once a fix is available, typically within 30 days of the initial report.

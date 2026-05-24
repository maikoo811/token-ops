# Security and Privacy

Token Ops is designed for local-first use.

## Defaults

- No API key required
- No account required
- No hosted backend required
- No telemetry by default
- Local MCP server over stdio
- Session reports are written to `.token-ops/session.jsonl` inside the repository

## Source Code

Token Ops reads local repository files to build compact context packs. By default, it does not upload source code or session reports anywhere.

## Generated Local Files

Token Ops may create:

- `.token-ops/session.jsonl`
- `context-pack.md` if the user asks the CLI to write one
- editor helper files when using `token-ops install`

`.token-ops/` is ignored by this repository's `.gitignore`.

## Reporting Issues

Please report security issues privately before public disclosure when possible.

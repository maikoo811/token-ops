---
name: token-ops
description: Use Token Ops to reduce wasted context during AI coding sessions. Trigger when the user asks about saving tokens, reducing Cursor costs, compact context, avoiding broad file reads, or checking token savings.
---

# Token Ops

Token Ops helps vibe-coding users spend fewer tokens by giving the agent a compact task-focused context pack before it reads broadly.

It is beginner friendly: no API key, no account, no cloud backend, and no setup conversation should be required.

## Use It When

- The task may require exploring several files, including a quick one-line check.
- The user mentions tokens, costs, context, Cursor usage, or expensive AI coding.
- You are about to read a large file, lockfile, generated file, build output, or long test log.
- The user asks for a savings report.

## Workflow

1. Call `build_compact_context` before broad exploration — it returns a compact, task-relevant pack so you can skip reading files that turn out irrelevant.
2. Use the returned snippets and token budget as the starting point.
3. If more detail is needed, inspect the smallest additional file or range.
4. Call `report_saved_tokens` when summarizing savings.

## User Tone

Explain the result in plain language. Avoid graph or compiler terminology unless the user asks for it. Prefer phrases like "I used a smaller context first" and "estimated tokens saved."

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function installIntegration({ cwd, target, cliPath }) {
  const validTargets = new Set(["all", "claude", "claude-hook", "cursor", "codex"]);

  if (!validTargets.has(target)) {
    throw new Error("install target must be one of: all, claude, claude-hook, cursor, codex");
  }

  const installed = [];

  if (target === "all" || target === "claude" || target === "claude-hook") {
    const skillDir = join(cwd, ".claude", "skills", "token-ops");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), renderClaudeSkill(cliPath));
    installed.push(".claude/skills/token-ops/SKILL.md");
  }

  if (target === "all" || target === "claude-hook") {
    const settingsPath = join(cwd, ".claude", "settings.local.json");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(settingsPath, renderClaudeHookSettings(settingsPath, cliPath));
    installed.push(".claude/settings.local.json");
  }

  if (target === "all" || target === "cursor") {
    const ruleDir = join(cwd, ".cursor", "rules");
    mkdirSync(ruleDir, { recursive: true });
    writeFileSync(join(ruleDir, "token-ops.mdc"), renderCursorRule());
    installed.push(".cursor/rules/token-ops.mdc");
  }

  if (target === "all" || target === "codex") {
    writeFileSync(join(cwd, "AGENTS.md"), mergeCodexInstructions(join(cwd, "AGENTS.md")));
    installed.push("AGENTS.md");
  }

  return installed;
}

export function renderClaudeSkill(cliPath) {
  return `---
name: token-ops
description: Build a compact context pack before starting broad code exploration. Use when the user asks to save tokens, reduce context, prepare an AI coding prompt, or gather only relevant files for a task.
disable-model-invocation: true
---

## Context pack

\`\`\`!
node ${shellQuote(cliPath)} pack "$ARGUMENTS"
\`\`\`

## Instructions

Use the generated context pack as the starting point. Prefer the listed files and snippets before reading broader repository context. If the pack is insufficient, inspect only the smallest additional files needed for the user's task.
`;
}

export function renderCursorRule() {
  return `---
description: Reduce wasted context with Token Ops before broad exploration.
alwaysApply: true
---

Before broad repository exploration, large file reads, or noisy test-log analysis, use Token Ops if its MCP tools are available.

Prefer this order:

1. Call \`build_compact_context\` for the current task.
2. Use the returned snippets and token budget before reading more files.
3. Call \`list_high_cost_files\` before opening large files, generated files, lockfiles, or logs.
4. Call \`report_saved_tokens\` when the user asks about cost, tokens, usage, or savings.

Avoid reading broad repository context until Token Ops output is insufficient for the task.
`;
}

export function renderCodexInstructions() {
  return `<!-- token-ops:start -->
## Token Ops

Before broad repository exploration for implementation, debugging, review, or testing tasks, run:

\`\`\`sh
token-ops pack "<user task>" --max-files 5 --max-lines 50
\`\`\`

Use that compact context first. Read additional files only when the pack is insufficient.
<!-- token-ops:end -->
`;
}

function renderClaudeHookSettings(settingsPath, cliPath) {
  const existing = readExistingSettings(settingsPath);
  const hook = {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: "node",
        args: [cliPath, "hook", "claude-user-prompt-submit"],
        timeout: 10
      }
    ]
  };

  existing.hooks = existing.hooks || {};
  const current = Array.isArray(existing.hooks.UserPromptSubmit) ? existing.hooks.UserPromptSubmit : [];
  const withoutTokenOps = current.filter((entry) => {
    const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
    return !hooks.some((item) => Array.isArray(item.args) && item.args.includes("claude-user-prompt-submit"));
  });
  existing.hooks.UserPromptSubmit = [...withoutTokenOps, hook];

  return `${JSON.stringify(existing, null, 2)}\n`;
}

function readExistingSettings(settingsPath) {
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    throw new Error(`${settingsPath} is not valid JSON`);
  }
}

function mergeCodexInstructions(path) {
  const block = renderCodexInstructions();
  if (!existsSync(path)) {
    return `# Repository Instructions\n\n${block}`;
  }

  const current = readFileSync(path, "utf8");
  if (current.includes("<!-- token-ops:start -->")) {
    return current.replace(/<!-- token-ops:start -->[\s\S]*?<!-- token-ops:end -->\n?/m, block);
  }

  return `${current.trimEnd()}\n\n${block}`;
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

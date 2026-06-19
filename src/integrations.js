import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Each entry embeds an absolute path or user-specific data; committing any
// of them leaks the maintainer's environment and breaks teammates' configs.
const GITIGNORE_HEADER = "# Token Ops local files";
const GITIGNORE_ENTRIES = [
  ".token-ops/",
  ".claude/settings.local.json",
  ".claude/skills/token-ops/SKILL.md"
];
// Legacy header used by v0.4.x installs; recognized on uninstall.
const GITIGNORE_LEGACY_HEADER = "# Token Ops session log";

export function installIntegration({ cwd, target, cliPath, nodePath, triggerMode = "smart", global = false }) {
  const validTargets = new Set(["all", "claude", "claude-hook", "cursor", "codex"]);

  if (!validTargets.has(target)) {
    throw new Error("install target must be one of: all, claude, claude-hook, cursor, codex");
  }

  if (global && target === "codex") {
    throw new Error("--global is not supported for codex (AGENTS.md is project-scoped)");
  }

  const installed = [];
  const root = global ? homedir() : cwd;
  // settings.local.json is host-specific (gitignored); settings.json is user-wide.
  const claudeSettingsFile = global ? "settings.json" : "settings.local.json";
  const displayPrefix = global ? "~" : "";

  if (target === "all" || target === "claude" || target === "claude-hook") {
    const skillDir = join(root, ".claude", "skills", "token-ops");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), renderClaudeSkill(cliPath));
    installed.push(`${displayPrefix}/.claude/skills/token-ops/SKILL.md`.replace(/^\//, ""));
  }

  if (target === "all" || target === "claude-hook") {
    const settingsPath = join(root, ".claude", claudeSettingsFile);
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsPath, renderClaudeHookSettings(settingsPath, cliPath, triggerMode, nodePath));
    installed.push(`${displayPrefix}/.claude/${claudeSettingsFile}`.replace(/^\//, ""));
  }

  if (target === "all" || target === "cursor") {
    if (global) {
      // User Rules are GUI-only; only the MCP entry can be installed from disk.
      const mcpPath = join(root, ".cursor", "mcp.json");
      mkdirSync(join(root, ".cursor"), { recursive: true });
      writeFileSync(mcpPath, renderCursorGlobalMcp(mcpPath, cliPath, nodePath));
      installed.push("~/.cursor/mcp.json");
    } else {
      const ruleDir = join(cwd, ".cursor", "rules");
      mkdirSync(ruleDir, { recursive: true });
      writeFileSync(join(ruleDir, "token-ops.mdc"), renderCursorRule());
      installed.push(".cursor/rules/token-ops.mdc");
    }
  }

  if (!global && (target === "all" || target === "codex")) {
    writeFileSync(join(cwd, "AGENTS.md"), mergeCodexInstructions(join(cwd, "AGENTS.md")));
    installed.push("AGENTS.md");
  }

  if (!global) {
    const gitignoreResult = ensureGitignoreEntry(join(cwd, ".gitignore"));
    if (gitignoreResult) {
      installed.push(gitignoreResult);
    }
  }

  return installed;
}

function ensureGitignoreEntry(gitignorePath) {
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";

  const missing = GITIGNORE_ENTRIES.filter((entry) => !existing.includes(entry));
  if (missing.length === 0) {
    return null;
  }

  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const blockPrefix = existing.length > 0 ? "\n" : "";
  const block = `${GITIGNORE_HEADER}\n${missing.join("\n")}\n`;
  writeFileSync(gitignorePath, existing + separator + blockPrefix + block);

  if (existing.length === 0) {
    return ".gitignore (created)";
  }
  return `.gitignore (${missing.join(", ")} added)`;
}

function removeGitignoreEntry(gitignorePath) {
  if (!existsSync(gitignorePath)) {
    return null;
  }

  const current = readFileSync(gitignorePath, "utf8");
  const hasManagedEntry = GITIGNORE_ENTRIES.some((entry) => current.includes(entry));
  if (!hasManagedEntry) {
    return null;
  }

  let cleaned = current
    // v0.6.1+ full block (3 entries)
    .replace(
      /\n*# Token Ops local files\n\.token-ops\/\n\.claude\/settings\.local\.json\n\.claude\/skills\/token-ops\/SKILL\.md\n/g,
      "\n"
    )
    // v0.5+ block (2 entries)
    .replace(
      /\n*# Token Ops local files\n\.token-ops\/\n\.claude\/settings\.local\.json\n/g,
      "\n"
    )
    // partial-install combinations
    .replace(/\n*# Token Ops local files\n\.token-ops\/\n/g, "\n")
    .replace(/\n*# Token Ops local files\n\.claude\/settings\.local\.json\n/g, "\n")
    .replace(/\n*# Token Ops local files\n\.claude\/skills\/token-ops\/SKILL\.md\n/g, "\n")
    // v0.4.x legacy header
    .replace(/\n*# Token Ops session log\n\.token-ops\/\n/g, "\n");

  if (GITIGNORE_ENTRIES.some((entry) => cleaned.includes(entry))) {
    const stripLines = new Set([
      ...GITIGNORE_ENTRIES,
      GITIGNORE_HEADER,
      GITIGNORE_LEGACY_HEADER
    ]);
    cleaned = cleaned
      .split("\n")
      .filter((line) => !stripLines.has(line.trim()))
      .join("\n");
  }

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  if (!cleaned.endsWith("\n") && cleaned.length > 0) {
    cleaned += "\n";
  }

  if (cleaned.trim().length === 0) {
    rmSync(gitignorePath);
    return ".gitignore (deleted)";
  }

  writeFileSync(gitignorePath, cleaned);
  return ".gitignore (Token Ops entries removed)";
}

export function uninstallIntegration({ cwd, target, global = false }) {
  const validTargets = new Set(["all", "claude", "claude-hook", "cursor", "codex"]);

  if (!validTargets.has(target)) {
    throw new Error("uninstall target must be one of: all, claude, claude-hook, cursor, codex");
  }

  if (global && target === "codex") {
    throw new Error("--global is not supported for codex (AGENTS.md is project-scoped)");
  }

  const removed = [];
  const root = global ? homedir() : cwd;
  const claudeSettingsFile = global ? "settings.json" : "settings.local.json";
  const displayPrefix = global ? "~" : "";

  if (target === "all" || target === "claude" || target === "claude-hook") {
    const skillPath = join(root, ".claude", "skills", "token-ops", "SKILL.md");
    if (existsSync(skillPath)) {
      rmSync(skillPath);
      tryRemoveEmptyDir(join(root, ".claude", "skills", "token-ops"));
      tryRemoveEmptyDir(join(root, ".claude", "skills"));
      removed.push(`${displayPrefix}/.claude/skills/token-ops/SKILL.md`.replace(/^\//, ""));
    }
  }

  if (target === "all" || target === "claude-hook") {
    const settingsPath = join(root, ".claude", claudeSettingsFile);
    const settingsResult = stripTokenOpsHook(settingsPath, displayPrefix);
    if (settingsResult) {
      removed.push(settingsResult);
    }
  }

  if (target === "all" || target === "claude" || target === "claude-hook") {
    tryRemoveEmptyDir(join(root, ".claude"));
  }

  if (target === "all" || target === "cursor") {
    if (global) {
      const mcpPath = join(root, ".cursor", "mcp.json");
      const mcpResult = stripTokenOpsFromCursorMcp(mcpPath);
      if (mcpResult) {
        removed.push(mcpResult);
      }
    } else {
      const rulePath = join(cwd, ".cursor", "rules", "token-ops.mdc");
      if (existsSync(rulePath)) {
        rmSync(rulePath);
        tryRemoveEmptyDir(join(cwd, ".cursor", "rules"));
        tryRemoveEmptyDir(join(cwd, ".cursor"));
        removed.push(".cursor/rules/token-ops.mdc");
      }
    }
  }

  if (!global && (target === "all" || target === "codex")) {
    const agentsResult = stripTokenOpsAgentsBlock(join(cwd, "AGENTS.md"));
    if (agentsResult) {
      removed.push(agentsResult);
    }
  }

  if (!global && target === "all") {
    const gitignoreResult = removeGitignoreEntry(join(cwd, ".gitignore"));
    if (gitignoreResult) {
      removed.push(gitignoreResult);
    }
  }

  return removed;
}

function stripTokenOpsHook(settingsPath, displayPrefix = "") {
  if (!existsSync(settingsPath)) {
    return null;
  }

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    throw new Error(`${settingsPath} is not valid JSON`);
  }

  const hooks = settings.hooks;
  if (!hooks || !Array.isArray(hooks.UserPromptSubmit)) {
    return null;
  }

  const filtered = hooks.UserPromptSubmit.filter((entry) => {
    const list = Array.isArray(entry.hooks) ? entry.hooks : [];
    return !list.some((item) => Array.isArray(item.args) && item.args.includes("claude-user-prompt-submit"));
  });

  if (filtered.length === hooks.UserPromptSubmit.length) {
    return null;
  }

  if (filtered.length === 0) {
    delete hooks.UserPromptSubmit;
  } else {
    hooks.UserPromptSubmit = filtered;
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  const fileName = settingsPath.endsWith("settings.local.json") ? "settings.local.json" : "settings.json";
  const label = `${displayPrefix}/.claude/${fileName}`.replace(/^\//, "");

  if (Object.keys(settings).length === 0) {
    rmSync(settingsPath);
    return `${label} (deleted)`;
  }

  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return `${label} (token-ops hook removed)`;
}

// MCP server path is derived from the CLI path (sibling `mcp/server.js`).
function renderCursorGlobalMcp(mcpJsonPath, cliPath, nodePath) {
  const existing = existsSync(mcpJsonPath)
    ? safeReadJson(mcpJsonPath, "Cursor mcp.json")
    : {};
  existing.mcpServers = existing.mcpServers || {};
  const mcpServerPath = join(dirname(dirname(cliPath)), "mcp", "server.js");
  existing.mcpServers["token-ops"] = {
    command: typeof nodePath === "string" && nodePath.length > 0 ? nodePath : "node",
    args: [mcpServerPath]
  };
  return `${JSON.stringify(existing, null, 2)}\n`;
}

function stripTokenOpsFromCursorMcp(mcpJsonPath) {
  if (!existsSync(mcpJsonPath)) {
    return null;
  }
  const settings = safeReadJson(mcpJsonPath, "Cursor mcp.json");
  if (!settings.mcpServers || !settings.mcpServers["token-ops"]) {
    return null;
  }
  delete settings.mcpServers["token-ops"];
  if (Object.keys(settings.mcpServers).length === 0) {
    delete settings.mcpServers;
  }
  if (Object.keys(settings).length === 0) {
    rmSync(mcpJsonPath);
    return "~/.cursor/mcp.json (deleted)";
  }
  writeFileSync(mcpJsonPath, `${JSON.stringify(settings, null, 2)}\n`);
  return "~/.cursor/mcp.json (token-ops entry removed)";
}

function safeReadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON (${label})`);
  }
}

function stripTokenOpsAgentsBlock(path) {
  if (!existsSync(path)) {
    return null;
  }

  const current = readFileSync(path, "utf8");
  if (!current.includes("<!-- token-ops:start -->")) {
    return null;
  }

  const cleaned = current.replace(/\n*<!-- token-ops:start -->[\s\S]*?<!-- token-ops:end -->\n?/m, "");
  const trimmed = cleaned.trim();

  if (trimmed === "" || trimmed === "# Repository Instructions") {
    rmSync(path);
    return "AGENTS.md (deleted)";
  }

  writeFileSync(path, cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`);
  return "AGENTS.md (token-ops block removed)";
}

function tryRemoveEmptyDir(path) {
  try {
    if (existsSync(path) && readdirSync(path).length === 0) {
      rmdirSync(path);
    }
  } catch {
    // ignore — directory has other content or cannot be removed
  }
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

When calling any Token Ops MCP tool, always pass \`cwd\` as the absolute path to the project root (the directory containing \`.git\`). Infer it from recent file paths in the conversation or the workspace folder — for example, if files appear as \`src/foo.ts\`, the cwd is the parent directory that holds both \`src/\` and \`.git/\`. Without \`cwd\` the call fails in Cursor.

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

function renderClaudeHookSettings(settingsPath, cliPath, triggerMode = "smart", nodePath) {
  const existing = readExistingSettings(settingsPath);
  const args = [cliPath, "hook", "claude-user-prompt-submit"];
  if (triggerMode && triggerMode !== "smart") {
    args.push("--trigger-mode", triggerMode);
  }
  const command = typeof nodePath === "string" && nodePath.length > 0 ? nodePath : "node";
  const hook = {
    matcher: "",
    hooks: [
      {
        type: "command",
        command,
        args,
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

// Empty array when cwd isn't a git repo, git isn't installed, or none tracked.
export function findTrackedManagedFiles(cwd) {
  try {
    const out = execFileSync("git", ["ls-files", "--", ...GITIGNORE_ENTRIES], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function isNvmManagedNode(nodePath) {
  return typeof nodePath === "string" && nodePath.includes("/.nvm/versions/node/");
}

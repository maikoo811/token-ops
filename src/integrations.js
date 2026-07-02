import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
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

export function installIntegration({ cwd, target, cliPath, nodePath, triggerMode = "all", global = false }) {
  const validTargets = new Set(["all", "claude", "claude-hook", "cursor", "codex", "observe"]);

  if (!validTargets.has(target)) {
    throw new Error("install target must be one of: all, claude, claude-hook, cursor, codex, observe");
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

  // Observation-only hooks are opt-in: installed ONLY for the explicit `observe`
  // target, never under `all`. They record tool-call metadata and never
  // allow/deny (see runObserveHook in bin/token-ops.js).
  if (target === "observe") {
    const cursorHooks = join(root, ".cursor", "hooks.json");
    mkdirSync(dirname(cursorHooks), { recursive: true });
    writeFileSync(cursorHooks, renderCursorObserveHooks(cursorHooks, cliPath, nodePath));
    installed.push(`${displayPrefix}/.cursor/hooks.json`.replace(/^\//, ""));

    const codexHooks = join(root, ".codex", "hooks.json");
    mkdirSync(dirname(codexHooks), { recursive: true });
    writeFileSync(codexHooks, renderCodexObserveHooks(codexHooks, cliPath, nodePath));
    installed.push(`${displayPrefix}/.codex/hooks.json`.replace(/^\//, ""));
  }

  if (!global) {
    const gitignoreResult = ensureGitignoreEntry(join(cwd, ".gitignore"));
    if (gitignoreResult) {
      installed.push(gitignoreResult);
    }
    if (target === "observe") {
      // hooks.json embeds absolute node/cli paths (needed so the editor GUI can
      // launch the hook); gitignore them so they don't leak into commits.
      const observeGitignore = ensureObserveGitignore(join(cwd, ".gitignore"));
      if (observeGitignore) {
        installed.push(observeGitignore);
      }
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
  const validTargets = new Set(["all", "claude", "claude-hook", "cursor", "codex", "observe"]);

  if (!validTargets.has(target)) {
    throw new Error("uninstall target must be one of: all, claude, claude-hook, cursor, codex, observe");
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

  // Cleanup is more forgiving than install: `uninstall` (all) also removes the
  // opt-in observe hooks if present, so a plain uninstall leaves nothing behind.
  if (target === "all" || target === "observe") {
    const cursorResult = stripObserveHooks(join(root, ".cursor", "hooks.json"), "cursor-observe", `${displayPrefix}/.cursor/hooks.json`.replace(/^\//, ""));
    if (cursorResult) {
      removed.push(cursorResult);
      tryRemoveEmptyDir(join(root, ".cursor"));
    }
    const codexResult = stripObserveHooks(join(root, ".codex", "hooks.json"), "codex-observe", `${displayPrefix}/.codex/hooks.json`.replace(/^\//, ""));
    if (codexResult) {
      removed.push(codexResult);
      tryRemoveEmptyDir(join(root, ".codex"));
    }
  }

  if (!global && target === "all") {
    const gitignoreResult = removeGitignoreEntry(join(cwd, ".gitignore"));
    if (gitignoreResult) {
      removed.push(gitignoreResult);
    }
  }

  if (!global && (target === "all" || target === "observe")) {
    const observeGitignore = removeObserveGitignore(join(cwd, ".gitignore"));
    if (observeGitignore) {
      removed.push(observeGitignore);
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
  // argv[1] is the bin symlink under global npm installs; realpath gets us to the package root.
  const realCliPath = realpathSync(cliPath);
  const mcpServerPath = join(dirname(dirname(realCliPath)), "mcp", "server.js");
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

// ---- Observation-only hooks (Cursor / Codex) ----

const CURSOR_OBSERVE_EVENTS = ["beforeReadFile", "beforeShellExecution", "beforeMCPExecution"];

// The command string a Cursor/Codex hook runs. Absolute node + cli paths are
// baked in so the editor GUI (which does not inherit the shell PATH) can launch
// it — the same reason the Claude hook stores an absolute node path.
function observeCommand(cliPath, nodePath, hookName, client) {
  const node = typeof nodePath === "string" && nodePath.length > 0 ? nodePath : "node";
  return `${shellQuote(node)} ${shellQuote(cliPath)} hook ${hookName} --client ${client}`;
}

// True if a hook entry (Cursor's flat {command} or Codex's nested {hooks:[{command}]})
// is one token-ops installed, identified by the observe hook name in its command.
function entryReferencesObserve(entry, marker) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  if (typeof entry.command === "string" && entry.command.includes(marker)) {
    return true;
  }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((item) => item && typeof item.command === "string" && item.command.includes(marker));
  }
  return false;
}

export function renderCursorObserveHooks(hooksPath, cliPath, nodePath) {
  const existing = existsSync(hooksPath) ? safeReadJson(hooksPath, "Cursor hooks.json") : {};
  existing.version = existing.version || 1;
  existing.hooks = existing.hooks || {};
  const command = observeCommand(cliPath, nodePath, "cursor-observe", "cursor");

  for (const event of CURSOR_OBSERVE_EVENTS) {
    const current = Array.isArray(existing.hooks[event]) ? existing.hooks[event] : [];
    const withoutOurs = current.filter((entry) => !entryReferencesObserve(entry, "cursor-observe"));
    existing.hooks[event] = [...withoutOurs, { command, timeout: 5 }];
  }

  return `${JSON.stringify(existing, null, 2)}\n`;
}

export function renderCodexObserveHooks(hooksPath, cliPath, nodePath) {
  const existing = existsSync(hooksPath) ? safeReadJson(hooksPath, "Codex hooks.json") : {};
  existing.hooks = existing.hooks || {};
  const command = observeCommand(cliPath, nodePath, "codex-observe", "codex");

  const current = Array.isArray(existing.hooks.PostToolUse) ? existing.hooks.PostToolUse : [];
  const withoutOurs = current.filter((entry) => !entryReferencesObserve(entry, "codex-observe"));
  existing.hooks.PostToolUse = [
    ...withoutOurs,
    { matcher: "*", hooks: [{ type: "command", command, timeout: 5 }] }
  ];

  return `${JSON.stringify(existing, null, 2)}\n`;
}

// Remove only the token-ops observe entries from a Cursor/Codex hooks.json,
// preserving any hooks the user added. Cleans up emptied events, an emptied
// hooks object, and finally the file itself (when nothing but our version
// marker remains). Mirrors stripTokenOpsHook's shape.
function stripObserveHooks(hooksPath, marker, displayPath) {
  if (!existsSync(hooksPath)) {
    return null;
  }
  const settings = safeReadJson(hooksPath, displayPath);
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") {
    return null;
  }

  let changed = false;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) {
      continue;
    }
    const filtered = hooks[event].filter((entry) => !entryReferencesObserve(entry, marker));
    if (filtered.length !== hooks[event].length) {
      changed = true;
      if (filtered.length === 0) {
        delete hooks[event];
      } else {
        hooks[event] = filtered;
      }
    }
  }

  if (!changed) {
    return null;
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  // If only the `version` marker we added remains, the file was ours — delete it.
  const remaining = Object.keys(settings).filter((key) => key !== "version");
  if (remaining.length === 0) {
    rmSync(hooksPath);
    return `${displayPath} (deleted)`;
  }

  writeFileSync(hooksPath, `${JSON.stringify(settings, null, 2)}\n`);
  return `${displayPath} (token-ops observe hooks removed)`;
}

// hooks.json entries live in their own gitignore block (separate header) so the
// existing 3-entry managed block and its legacy-upgrade regex are untouched.
const OBSERVE_GITIGNORE_HEADER = "# Token Ops observe hooks";
const OBSERVE_GITIGNORE_ENTRIES = [".cursor/hooks.json", ".codex/hooks.json"];

function ensureObserveGitignore(gitignorePath) {
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const missing = OBSERVE_GITIGNORE_ENTRIES.filter((entry) => !existing.includes(entry));
  if (missing.length === 0) {
    return null;
  }
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const blockPrefix = existing.length > 0 ? "\n" : "";
  const block = `${OBSERVE_GITIGNORE_HEADER}\n${missing.join("\n")}\n`;
  writeFileSync(gitignorePath, existing + separator + blockPrefix + block);
  return existing.length === 0 ? ".gitignore (created)" : `.gitignore (${missing.join(", ")} added)`;
}

function removeObserveGitignore(gitignorePath) {
  if (!existsSync(gitignorePath)) {
    return null;
  }
  const current = readFileSync(gitignorePath, "utf8");
  if (!OBSERVE_GITIGNORE_ENTRIES.some((entry) => current.includes(entry))) {
    return null;
  }
  const stripLines = new Set([...OBSERVE_GITIGNORE_ENTRIES, OBSERVE_GITIGNORE_HEADER]);
  let cleaned = current
    .split("\n")
    .filter((line) => !stripLines.has(line.trim()))
    .join("\n");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  if (!cleaned.endsWith("\n") && cleaned.length > 0) {
    cleaned += "\n";
  }
  if (cleaned.trim().length === 0) {
    rmSync(gitignorePath);
    return ".gitignore (deleted)";
  }
  writeFileSync(gitignorePath, cleaned);
  return ".gitignore (Token Ops observe entries removed)";
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

Use Token Ops before broad repository exploration, large file reads, or noisy test-log analysis — it cuts wasted context. Prefer this order:

1. Call \`build_compact_context\` for the current task.
2. Use the returned snippets and token budget before reading more files.
3. Call \`list_high_cost_files\` before opening large files, generated files, lockfiles, or logs.
4. Call \`report_saved_tokens\` when the user asks about cost, tokens, usage, or savings.

Always pass \`cwd\` as the absolute path to the project root (the directory containing \`.git\`) — infer it from recent file paths or the workspace folder. Without \`cwd\` the call fails in Cursor.
`;
}

export function renderCodexInstructions() {
  return `<!-- token-ops:start -->
## Token Ops

Before broad repository exploration for implementation, debugging, review, or testing tasks, run this to cut wasted context:

\`\`\`sh
token-ops pack "<user task>" --max-files 5 --max-lines 50
\`\`\`

Use that compact context first. Read additional files only when the pack is insufficient.
<!-- token-ops:end -->
`;
}

function renderClaudeHookSettings(settingsPath, cliPath, triggerMode = "all", nodePath) {
  const existing = readExistingSettings(settingsPath);
  const args = [cliPath, "hook", "claude-user-prompt-submit"];
  if (triggerMode && triggerMode !== "all") {
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

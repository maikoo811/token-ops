#!/usr/bin/env node

// Manual version guard: the ESM imports below are hoisted, so a `package.json`
// `engines` failure would surface as an opaque syntax error on Node 16/17
// before this file's logic runs. Emit a readable message instead.
const NODE_MAJOR = Number.parseInt(process.versions.node.split(".")[0], 10);
if (NODE_MAJOR < 18) {
  process.stderr.write(
    `token-ops requires Node.js 18 or later. You are running ${process.version}.\n` +
      "Please upgrade: https://nodejs.org\n"
  );
  process.exit(1);
}

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LANG,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_LINES,
  DEFAULT_TRIGGER_MODE,
  colorizeForTty,
  estimateContextCost,
  generatePack,
  listHighCostFiles,
  simplifyForTerminal,
  readLanguage,
  readSavingsReport,
  readTriggerMode,
  recordSessionEvent,
  renderHandoffPrompt,
  renderSavingsReport,
  resolveLanguage,
  shouldInjectForPrompt,
  toPositiveInt,
  validateCwd
} from "../src/core.js";
import {
  findTrackedManagedFiles,
  installIntegration,
  isNvmManagedNode,
  renderCursorRule,
  uninstallIntegration
} from "../src/integrations.js";
import { runAudit, renderAuditReport } from "../src/audit.js";

const args = process.argv.slice(2);
const command = args.shift();

try {
  if (!command || command === "-h" || command === "--help") {
    printHelp();
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    console.log(pkg.version);
    process.exit(0);
  }

  if (command === "hook") {
    runHook(args);
    process.exit(0);
  }

  if (command === "install") {
    runInstall(args);
    process.exit(0);
  }

  if (command === "uninstall") {
    runUninstall(args);
    process.exit(0);
  }

  if (command === "report") {
    runReport(args);
    process.exit(0);
  }

  if (command === "handoff") {
    runHandoff(args);
    process.exit(0);
  }

  if (command === "audit") {
    await runAuditCommand(args);
    process.exit(0);
  }

  if (command === "cost") {
    runCost(args);
    process.exit(0);
  }

  if (command === "high-cost-files") {
    runHighCostFiles(args);
    process.exit(0);
  }

  if (command !== "pack") {
    fail(`Unknown command: ${command}`);
  }

  runPack(args);
} catch (error) {
  fail(error.message);
}

function runPack(values) {
  const options = parsePackArgs(values);
  const cwd = process.cwd();
  const task = options.task.trim();

  if (!task) {
    fail("Please provide a task, for example: token-ops pack \"Fix the CSV import bug\"");
  }

  const lang = resolveLanguage(options.lang, task);
  const result = generatePack({
    task,
    cwd,
    maxFiles: options.maxFiles,
    maxLines: options.maxLines,
    lang
  });

  recordSessionEvent(cwd, {
    type: "pack",
    task,
    budget: result.budget,
    files: result.files
  });

  if (options.output) {
    writeFileSync(join(cwd, options.output), result.markdown);
    console.log(`Wrote ${options.output}`);
  } else {
    const isTty = process.stdout.isTTY === true;
    let markdown = result.markdown;
    if (isTty && !options.full) {
      markdown = simplifyForTerminal(markdown);
    }
    process.stdout.write(colorizeForTty(markdown, isTty));
  }
}

function runInstall(values) {
  const target = values[0] || "all";
  if (target === "-h" || target === "--help") {
    printHelp();
    return;
  }

  const global = values.includes("--global");

  const triggerModeIndex = values.findIndex((value) => value === "--trigger-mode");
  const triggerMode = triggerModeIndex >= 0
    ? readTriggerMode(readOptionValue(values, triggerModeIndex + 1, "--trigger-mode"))
    : DEFAULT_TRIGGER_MODE;

  const installed = installIntegration({
    cwd: process.cwd(),
    target,
    cliPath: process.argv[1],
    nodePath: process.execPath,
    triggerMode,
    global
  });

  const scope = global ? "user-wide" : "project-scoped";
  console.log(`Installed token-ops integration (${scope}):\n${installed.map((file) => `- ${file}`).join("\n")}`);

  if (installed.includes(".claude/settings.local.json")) {
    console.log(
      "\nNote: .claude/settings.local.json was added to .gitignore — it contains an absolute\n" +
      "      path to this machine's node binary and should stay local."
    );
  }

  if (global && (target === "all" || target === "cursor")) {
    console.log(
      "\nNote: Cursor User Rules cannot be installed from disk. Paste this once into\n" +
      "      Cursor Settings → Rules → User Rules:\n\n" +
      "------------------------------------------------------------\n" +
      renderCursorRule() +
      "------------------------------------------------------------"
    );
  }

  if (!global) {
    const tracked = findTrackedManagedFiles(process.cwd());
    if (tracked.length > 0) {
      console.log(
        "\n⚠️  These files are tracked by git but Token Ops just added them to .gitignore.\n" +
        "    Git won't auto-untrack them — absolute paths inside will still be committed:\n\n" +
        tracked.map((f) => `      ${f}`).join("\n") +
        "\n\n    To stop tracking (one-time):\n\n" +
        `      git rm --cached ${tracked.join(" ")}\n` +
        "      git commit -m \"stop tracking token-ops generated files\""
      );
    }
  }

  if (isNvmManagedNode(process.execPath) && (target === "all" || target === "claude" || target === "claude-hook")) {
    console.log(
      "\nℹ️  Detected nvm-managed node at:\n" +
      `      ${process.execPath}\n\n` +
      "    This path is baked into the Claude Code hook config. If you upgrade node\n" +
      "    (e.g. `nvm install`), re-run `token-ops install claude-hook` to refresh\n" +
      "    the path — otherwise the hook will silently fail to start."
    );
  }
}

function runUninstall(values) {
  const target = values[0] || "all";
  if (target === "-h" || target === "--help") {
    printHelp();
    return;
  }

  const global = values.includes("--global");

  const removed = uninstallIntegration({
    cwd: process.cwd(),
    target,
    global
  });

  if (removed.length === 0) {
    console.log("Nothing to uninstall (no token-ops integration files found).");
    return;
  }

  console.log(`Uninstalled token-ops integration:\n${removed.map((file) => `- ${file}`).join("\n")}`);
}

function runHook(values) {
  const hookName = values[0];
  if (hookName === "-h" || hookName === "--help") {
    printHelp();
    return;
  }

  if (hookName !== "claude-user-prompt-submit") {
    fail("hook target must be: claude-user-prompt-submit");
  }

  const triggerModeIndex = values.findIndex((value) => value === "--trigger-mode");
  const triggerMode = triggerModeIndex >= 0
    ? readTriggerMode(readOptionValue(values, triggerModeIndex + 1, "--trigger-mode"))
    : readTriggerMode(process.env.TOKEN_OPS_TRIGGER_MODE || DEFAULT_TRIGGER_MODE);

  const input = readJsonFromStdin();
  const prompt = String(input.prompt || "").trim();
  let hookCwd;
  try {
    hookCwd = validateCwd(String(input.cwd || process.cwd()));
  } catch {
    try {
      hookCwd = validateCwd(process.cwd());
    } catch {
      process.stdout.write("{}");
      return;
    }
  }

  if (!shouldInjectForPrompt(prompt, triggerMode)) {
    process.stdout.write("{}");
    return;
  }

  const lang = resolveLanguage(DEFAULT_LANG, prompt);
  const result = generatePack({
    task: prompt,
    cwd: hookCwd,
    maxFiles: 5,
    maxLines: 50,
    lang
  });
  recordSessionEvent(hookCwd, {
    type: "hook",
    task: prompt,
    budget: result.budget,
    files: result.files
  });

  const intro = lang === "ja"
    ? [
        "Token Ops がコンパクトなリポジトリ文脈を自動追加しました。",
        "まずこの情報を起点にし、必要な場合だけ追加ファイルを読んでください。"
      ]
    : [
        "Token Ops added this compact repository context automatically.",
        "Use it as a starting point and avoid broad file reads unless necessary."
      ];

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        ...intro,
        "",
        result.markdown
      ].join("\n")
    }
  }));
}

function runReport(values) {
  const lang = resolveLanguage(parseLangOnly(values), "");
  const markdown = renderSavingsReport(readSavingsReport(process.cwd()), lang);
  process.stdout.write(`${colorizeForTty(markdown, process.stdout.isTTY === true)}\n`);
}

function runHandoff(values) {
  const lang = resolveLanguage(parseLangOnly(values), "");
  process.stdout.write(`${renderHandoffPrompt(lang)}\n`);
}

async function runAuditCommand(values) {
  const lang = resolveLanguage(parseLangOnly(values), "");
  const result = await runAudit(process.cwd());
  process.stdout.write(`${renderAuditReport(result, lang)}\n`);
}

function runCost(values) {
  const options = parsePackArgs(values);
  const result = estimateContextCost({
    cwd: process.cwd(),
    task: options.task,
    maxFiles: options.maxFiles
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function runHighCostFiles(values) {
  const limitIndex = values.findIndex((value) => value === "--limit");
  const limit = limitIndex >= 0 ? toPositiveInt(readOptionValue(values, limitIndex + 1, "--limit"), "--limit") : 12;
  process.stdout.write(`${JSON.stringify(listHighCostFiles({ cwd: process.cwd(), limit }), null, 2)}\n`);
}

function parsePackArgs(values) {
  const parsed = {
    taskParts: [],
    output: "",
    maxFiles: DEFAULT_MAX_FILES,
    maxLines: DEFAULT_MAX_LINES,
    lang: DEFAULT_LANG,
    full: false
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "-o" || value === "--output") {
      parsed.output = readOptionValue(values, ++index, value);
    } else if (value === "--max-files") {
      parsed.maxFiles = toPositiveInt(readOptionValue(values, ++index, value), value);
    } else if (value === "--max-lines") {
      parsed.maxLines = toPositiveInt(readOptionValue(values, ++index, value), value);
    } else if (value === "--lang") {
      parsed.lang = readLanguage(readOptionValue(values, ++index, value));
    } else if (value === "--full") {
      parsed.full = true;
    } else {
      parsed.taskParts.push(value);
    }
  }

  return {
    task: parsed.taskParts.join(" "),
    output: parsed.output,
    maxFiles: parsed.maxFiles,
    maxLines: parsed.maxLines,
    lang: parsed.lang,
    full: parsed.full
  };
}

function parseLangOnly(values) {
  const langIndex = values.findIndex((value) => value === "--lang");
  if (langIndex < 0) {
    return DEFAULT_LANG;
  }
  return readLanguage(readOptionValue(values, langIndex + 1, "--lang"));
}

function readJsonFromStdin() {
  const raw = readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readOptionValue(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`token-ops

Usage:
  token-ops pack "Fix the CSV import bug"
  token-ops report
  token-ops handoff
  token-ops audit
  token-ops cost "Fix the CSV import bug"
  token-ops high-cost-files --limit 12
  token-ops install
  token-ops install claude
  token-ops install claude-hook
  token-ops install cursor
  token-ops install codex
  token-ops uninstall
  token-ops uninstall claude
  token-ops uninstall claude-hook
  token-ops uninstall cursor
  token-ops uninstall codex
  token-ops hook claude-user-prompt-submit

Options:
  -o, --output <file>             Write Markdown pack to a file
  --max-files <number>            Number of relevant files to include (default: ${DEFAULT_MAX_FILES})
  --max-lines <number>            Max snippet lines per file (default: ${DEFAULT_MAX_LINES})
  --full                          (pack) Show the LLM-oriented sections (Suggested
                                  Prompt + Snippets) in terminal output. Default in
                                  TTY mode hides them; piped / file output always
                                  includes them.
  --lang <auto|en|ja>             Output language for packs and reports (default: ${DEFAULT_LANG})
  --trigger-mode <all|smart>      Hook firing policy. all (default) fires on any
                                  prompt that is at least 6 chars and not
                                  self-referential; smart only fires on prompts
                                  that contain a coding keyword.
  --global                        (install / uninstall) Write to your home directory
                                  (~/.claude/, ~/.cursor/) instead of the current
                                  project — applies the integration to all projects
                                  at once. Not supported for the codex target.
  -h, --help                      Show help
  -v, --version                   Print the installed token-ops version
`);
}

function fail(message) {
  console.error(`token-ops: ${message}`);
  process.exit(1);
}

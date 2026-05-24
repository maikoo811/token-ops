#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LANG,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_LINES,
  estimateContextCost,
  generatePack,
  listHighCostFiles,
  readLanguage,
  readSavingsReport,
  recordSessionEvent,
  renderSavingsReport,
  resolveLanguage,
  shouldInjectForPrompt,
  toPositiveInt
} from "../src/core.js";
import { installIntegration } from "../src/integrations.js";

const args = process.argv.slice(2);
const command = args.shift();

try {
  if (!command || command === "-h" || command === "--help") {
    printHelp();
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

  if (command === "report") {
    runReport(args);
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
    process.stdout.write(result.markdown);
  }
}

function runInstall(values) {
  const target = values[0] || "all";
  if (target === "-h" || target === "--help") {
    printHelp();
    return;
  }

  const installed = installIntegration({
    cwd: process.cwd(),
    target,
    cliPath: process.argv[1]
  });

  console.log(`Installed token-ops integration:\n${installed.map((file) => `- ${file}`).join("\n")}`);
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

  const input = readJsonFromStdin();
  const prompt = String(input.prompt || "").trim();
  const hookCwd = String(input.cwd || process.cwd());

  if (!shouldInjectForPrompt(prompt)) {
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
  process.stdout.write(`${renderSavingsReport(readSavingsReport(process.cwd()), lang)}\n`);
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
    lang: DEFAULT_LANG
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
    } else {
      parsed.taskParts.push(value);
    }
  }

  return {
    task: parsed.taskParts.join(" "),
    output: parsed.output,
    maxFiles: parsed.maxFiles,
    maxLines: parsed.maxLines,
    lang: parsed.lang
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
  token-ops cost "Fix the CSV import bug"
  token-ops high-cost-files --limit 12
  token-ops install
  token-ops install claude
  token-ops install claude-hook
  token-ops install cursor
  token-ops install codex
  token-ops hook claude-user-prompt-submit

Options:
  -o, --output <file>     Write Markdown pack to a file
  --max-files <number>   Number of relevant files to include (default: ${DEFAULT_MAX_FILES})
  --max-lines <number>   Max snippet lines per file (default: ${DEFAULT_MAX_LINES})
  --lang <auto|en|ja>     Output language for packs and reports (default: ${DEFAULT_LANG})
  -h, --help             Show help
`);
}

function fail(message) {
  console.error(`token-ops: ${message}`);
  process.exit(1);
}

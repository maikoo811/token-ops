#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimateContextCost,
  generatePack,
  listHighCostFiles,
  readSavingsReport,
  recordSessionEvent,
  renderSavingsReport,
  resolveLanguage
} from "../src/core.js";

// Structured stderr logger: keeps the [token-ops-mcp] prefix that operators
// (and existing tests) grep for, but adds a level and ISO timestamp so logs
// captured by Cursor / Claude Code are easy to triage.
function log(level, message) {
  process.stderr.write(`[token-ops-mcp] ${level} ${new Date().toISOString()} ${message}\n`);
}

// Surface crashes on stderr so Cursor / Claude Code can show a real error
// instead of a silent "server in error state."
process.on("uncaughtException", (err) => {
  log("FATAL", `uncaught exception: ${err.stack || err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log("ERROR", `unhandled rejection: ${reason}`);
});

const PACKAGE_VERSION = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, "..", "package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
})();

const BEGINNER_MAX_FILES = 6;
const BEGINNER_MAX_LINES = 80;

// Cap concurrent tool calls. Each pack reads every tracked file in the repo;
// a misbehaving MCP client looping requests could saturate disk I/O. Three
// in-flight is generous for any sane client and prevents the runaway case.
const MAX_IN_FLIGHT = 3;
let inFlight = 0;

// MCP stdio transport per the 2025 spec uses newline-delimited JSON:
// each line on stdin is one complete JSON-RPC message, each response is
// a JSON object followed by "\n". We also tolerate the legacy LSP-style
// Content-Length framing as a fallback so older clients still work.
let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  drainMessages();
});

function drainMessages() {
  while (buffer.length > 0) {
    if (buffer.startsWith("Content-Length:")) {
      if (!drainContentLengthFramed()) {
        return;
      }
      continue;
    }

    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex < 0) {
      return;
    }

    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line.length === 0) {
      continue;
    }

    handleMessage(line);
  }
}

function drainContentLengthFramed() {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd < 0) {
    return false;
  }

  const header = buffer.slice(0, headerEnd);
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) {
    buffer = buffer.slice(headerEnd + 4);
    return true;
  }

  const length = Number(match[1]);
  const messageStart = headerEnd + 4;
  if (buffer.length < messageStart + length) {
    return false;
  }

  const raw = buffer.slice(messageStart, messageStart + length);
  buffer = buffer.slice(messageStart + length);
  handleMessage(raw);
  return true;
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    return;
  }

  try {
    const result = route(message.method, message.params || {});
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    log("ERROR", `error handling ${message.method}: ${error.message}`);
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
}

function route(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion || "2025-06-18",
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "token-ops",
        version: PACKAGE_VERSION
      }
    };
  }

  if (method === "tools/list") {
    return { tools: tools() };
  }

  if (method === "tools/call") {
    return callTool(params.name, params.arguments || {});
  }

  throw new Error(`Unsupported method: ${method}`);
}

function callTool(name, args) {
  if (inFlight >= MAX_IN_FLIGHT) {
    throw new Error(`Server busy — too many concurrent requests (limit ${MAX_IN_FLIGHT}). Try again shortly.`);
  }
  inFlight += 1;
  try {
    return dispatchTool(name, args);
  } finally {
    inFlight -= 1;
  }
}

function dispatchTool(name, args) {
  if (name === "build_compact_context") {
    const cwd = readCwd(args);
    const task = String(args.task || "").trim();
    if (!task) {
      throw new Error("task is required");
    }
    const lang = resolveLanguage(args.lang || "auto", task);
    const result = generatePack({
      task,
      cwd,
      maxFiles: Number(args.maxFiles || BEGINNER_MAX_FILES),
      maxLines: Number(args.maxLines || BEGINNER_MAX_LINES),
      lang
    });
    recordSessionEvent(cwd, {
      type: "mcp.build_compact_context",
      task,
      budget: result.budget,
      files: result.files
    });

    return textResult(result.markdown);
  }

  if (name === "estimate_context_cost") {
    const result = estimateContextCost({
      cwd: readCwd(args),
      task: String(args.task || ""),
      maxFiles: Number(args.maxFiles || 8)
    });
    return textResult(JSON.stringify(result, null, 2));
  }

  if (name === "list_high_cost_files") {
    const result = listHighCostFiles({
      cwd: readCwd(args),
      limit: Number(args.limit || 12)
    });
    return textResult(JSON.stringify(result, null, 2));
  }

  if (name === "report_saved_tokens") {
    const cwd = readCwd(args);
    const lang = resolveLanguage(args.lang || "auto", "");
    return textResult(renderSavingsReport(readSavingsReport(cwd), lang));
  }

  throw new Error(`Unknown tool: ${name}`);
}

function readCwd(args) {
  const raw = String(args.cwd || process.cwd());

  let resolved;
  try {
    resolved = realpathSync(raw);
  } catch {
    throw new Error(`cwd does not exist: ${raw}`);
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(`cwd is not a directory: ${raw}`);
  }

  // Require a git repo. Token Ops only ever enumerates git-tracked files, so
  // pointing the server at /, /etc, or a non-repo can't yield meaningful work,
  // and rejecting these paths up front prevents a malicious MCP client from
  // using us as an arbitrary-filesystem-read primitive.
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: resolved,
      stdio: ["ignore", "ignore", "ignore"]
    });
  } catch {
    throw new Error(`cwd is not a git repository: ${raw}`);
  }

  return resolved;
}

function tools() {
  return [
    {
      name: "build_compact_context",
      description: "Create a small context pack before reading many files.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "The coding task or user request." },
          cwd: { type: "string", description: "Repository root. Defaults to server cwd." },
          maxFiles: { type: "number", description: `Maximum relevant files to include. Default: ${BEGINNER_MAX_FILES}.` },
          maxLines: { type: "number", description: `Maximum snippet lines per file. Default: ${BEGINNER_MAX_LINES}.` },
          lang: { type: "string", enum: ["auto", "en", "ja"] }
        },
        required: ["task"]
      }
    },
    {
      name: "estimate_context_cost",
      description: "Estimate how expensive repository context may be.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string" },
          cwd: { type: "string" },
          maxFiles: { type: "number" }
        }
      }
    },
    {
      name: "list_high_cost_files",
      description: "List files that are expensive for Cursor to read.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          limit: { type: "number" }
        }
      }
    },
    {
      name: "report_saved_tokens",
      description: "Show the local Token Ops savings report.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          lang: { type: "string", enum: ["auto", "en", "ja"] }
        }
      }
    }
  ];
}

function textResult(text) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}

function send(message) {
  // Per MCP stdio spec: each response is one JSON object on its own line.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

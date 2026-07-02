#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimateContextCost,
  generatePack,
  listHighCostFiles,
  readSavingsReport,
  recordSessionEvent,
  renderSavingsReport,
  resolveLanguage,
  validateCwd
} from "../src/core.js";

// Preserves the [token-ops-mcp] prefix tests grep for.
function log(level, message) {
  process.stderr.write(`[token-ops-mcp] ${level} ${new Date().toISOString()} ${message}\n`);
}

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

const MAX_IN_FLIGHT = 3;
let inFlight = 0;

const HARD_LIMIT_MAX_FILES = 50;
const HARD_LIMIT_MAX_LINES = 300;
const HARD_LIMIT_LIST_LIMIT = 200;

function clampMaxFiles(raw, fallback) {
  const n = Number(raw || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, HARD_LIMIT_MAX_FILES);
}

function clampMaxLines(raw, fallback) {
  const n = Number(raw || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, HARD_LIMIT_MAX_LINES);
}

function clampListLimit(raw, fallback) {
  const n = Number(raw || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, HARD_LIMIT_LIST_LIMIT);
}

// MCP 2025 spec: newline-delimited JSON-RPC. Legacy LSP-style
// Content-Length framing kept as a fallback for older clients.
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
      },
      // Codex reads this for server-wide guidance; other clients' support is unconfirmed (#92).
      instructions: "Prefer build_compact_context before broad repository exploration to reduce wasted context."
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
      maxFiles: clampMaxFiles(args.maxFiles, BEGINNER_MAX_FILES),
      maxLines: clampMaxLines(args.maxLines, BEGINNER_MAX_LINES),
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
      maxFiles: clampMaxFiles(args.maxFiles, 8)
    });
    return textResult(JSON.stringify(result, null, 2));
  }

  if (name === "list_high_cost_files") {
    const result = listHighCostFiles({
      cwd: readCwd(args),
      limit: clampListLimit(args.limit, 12)
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
  // MCP tools surface failures as JSON-RPC errors, so let validateCwd throw.
  return validateCwd(raw);
}

function tools() {
  return [
    {
      name: "build_compact_context",
      description: "Call this before broad repository exploration. Returns a compact, task-relevant context pack (ranked files + snippets) so you can skip reading files that turn out irrelevant.",
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
      description: "Call this to preview the token cost of a task's relevant files before deciding how much to read.",
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
      description: "Call this before opening large files, generated files, lockfiles, or logs, to see which ones cost the most tokens to read in full.",
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
      description: "Call this when the user asks about tokens saved, usage, or cost. Shows the local Token Ops savings report.",
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

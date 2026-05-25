#!/usr/bin/env node

import {
  estimateContextCost,
  generatePack,
  listHighCostFiles,
  readSavingsReport,
  recordSessionEvent,
  renderSavingsReport,
  resolveLanguage
} from "../src/core.js";

const BEGINNER_MAX_FILES = 6;
const BEGINNER_MAX_LINES = 80;

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainMessages();
});

function drainMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }

    const length = Number(match[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) {
      return;
    }

    const raw = buffer.subarray(messageStart, messageEnd).toString("utf8");
    buffer = buffer.subarray(messageEnd);
    handleMessage(raw);
  }
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
        version: "0.3.0"
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
  return String(args.cwd || process.cwd());
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
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

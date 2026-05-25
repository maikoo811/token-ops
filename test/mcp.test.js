import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const server = resolve("mcp/server.js");

function runServer(stdinPayload, { timeoutMs = 3000 } = {}) {
  return new Promise((resolveFn, reject) => {
    const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`MCP server timed out after ${timeoutMs}ms. stdout=${stdout} stderr=${stderr}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveFn({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

test("MCP server responds to initialize via newline-delimited JSON", async () => {
  const payload = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" }
  })}\n`;

  const { stdout } = await runServer(payload);
  const response = JSON.parse(stdout.trim());

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.serverInfo.name, "token-ops");
  assert.match(response.result.serverInfo.version, /^\d+\.\d+\.\d+$/);
});

test("MCP server lists tools via newline-delimited JSON", async () => {
  const initLine = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`;
  const listLine = `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`;

  const { stdout } = await runServer(initLine + listLine);
  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(lines.length, 2);
  const listing = lines.find((line) => line.id === 2);
  assert.ok(listing, "tools/list response missing");

  const names = listing.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "build_compact_context",
    "estimate_context_cost",
    "list_high_cost_files",
    "report_saved_tokens"
  ]);
});

test("MCP server also accepts legacy Content-Length framing", async () => {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 99, method: "initialize", params: {} });
  const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;

  const { stdout } = await runServer(payload);
  const response = JSON.parse(stdout.trim());

  assert.equal(response.id, 99);
  assert.equal(response.result.serverInfo.name, "token-ops");
});

test("MCP server returns an error for unsupported methods", async () => {
  const payload = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "nonexistent/method",
    params: {}
  })}\n`;

  const { stdout } = await runServer(payload);
  const response = JSON.parse(stdout.trim());

  assert.equal(response.id, 7);
  assert.equal(response.error.code, -32603);
  assert.match(response.error.message, /Unsupported method/);
});

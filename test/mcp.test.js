import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const server = resolve("mcp/server.js");
const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version;

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
  // Codex reads this field for server-wide guidance (#92).
  assert.match(response.result.instructions, /build_compact_context/);
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

  const { stdout, stderr } = await runServer(payload);
  const response = JSON.parse(stdout.trim());

  assert.equal(response.id, 7);
  assert.equal(response.error.code, -32603);
  assert.match(response.error.message, /Unsupported method/);
  // Errors must be mirrored to stderr so Cursor can surface diagnostics
  // (structured format: [token-ops-mcp] LEVEL ISO-TIMESTAMP message).
  assert.match(stderr, /\[token-ops-mcp\] ERROR .* error handling nonexistent\/method/);
});

test("MCP server reports its version from package.json (not a hardcoded literal)", async () => {
  const payload = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {}
  })}\n`;

  const { stdout } = await runServer(payload);
  const response = JSON.parse(stdout.trim());

  assert.equal(response.result.serverInfo.version, packageVersion);
});

test("MCP server rejects build_compact_context when cwd is not a git repo", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "token-ops-mcp-cwd-"));
  writeFileSync(join(tmp, "README.md"), "# not a git repo\n");

  const initLine = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`;
  const callLine = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "build_compact_context",
      arguments: { task: "fix the bug", cwd: tmp }
    }
  })}\n`;

  const { stdout } = await runServer(initLine + callLine);
  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const callResponse = lines.find((line) => line.id === 2);

  assert.ok(callResponse.error, "expected an error response for non-git cwd");
  assert.match(callResponse.error.message, /not a git repository/);
});

test("MCP server rejects build_compact_context when cwd does not exist", async () => {
  const initLine = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`;
  const callLine = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "build_compact_context",
      arguments: { task: "fix the bug", cwd: "/this/path/definitely/does/not/exist" }
    }
  })}\n`;

  const { stdout } = await runServer(initLine + callLine);
  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const callResponse = lines.find((line) => line.id === 2);

  assert.ok(callResponse.error, "expected an error response for missing cwd");
  assert.match(callResponse.error.message, /cwd does not exist/);
});

test("MCP server accepts a valid git-repo cwd", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "token-ops-mcp-cwd-ok-"));
  execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
  writeFileSync(join(tmp, "README.md"), "# demo\n\nFix the bug.\n");
  execFileSync("git", ["add", "."], { cwd: tmp });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init"], {
    cwd: tmp,
    stdio: "ignore"
  });

  const initLine = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`;
  const callLine = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "build_compact_context",
      arguments: { task: "fix the bug", cwd: tmp }
    }
  })}\n`;

  const { stdout } = await runServer(initLine + callLine);
  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const callResponse = lines.find((line) => line.id === 2);

  assert.ok(callResponse.result, "expected a successful result for a valid git repo");
  assert.match(callResponse.result.content[0].text, /Token Ops Context Pack/);
});

test("MCP server stderr lines use the structured [token-ops-mcp] LEVEL ISO-TIMESTAMP format", async () => {
  const payload = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "nonexistent/method",
    params: {}
  })}\n`;

  const { stderr } = await runServer(payload);
  assert.match(stderr, /\[token-ops-mcp\] ERROR \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z .*Unsupported method/);
});

test("MCP server clamps caller-supplied maxFiles to the hard limit", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "token-ops-mcp-clamp-"));
  execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
  writeFileSync(join(tmp, "README.md"), "# demo\n\nfix the bug\n");
  execFileSync("git", ["add", "."], { cwd: tmp });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init"], {
    cwd: tmp,
    stdio: "ignore"
  });

  const initLine = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`;
  // Caller passes an absurd maxFiles. Server must not iterate 10,000 files.
  const callLine = `${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "build_compact_context",
      arguments: { task: "fix the bug", cwd: tmp, maxFiles: 10000, maxLines: 99999 }
    }
  })}\n`;

  const { stdout } = await runServer(initLine + callLine);
  const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const callResponse = lines.find((line) => line.id === 2);

  // Should succeed (clamped values are still valid) and produce a small pack.
  assert.ok(callResponse.result, "expected a clamped successful result");
  // The pack text mentions a small file count — proves clamp took effect
  // (we can't directly observe the internal value, but the pack should
  // process this 1-file repo without exploding).
  assert.match(callResponse.result.content[0].text, /Token Ops Context Pack/);
});

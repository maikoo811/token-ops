import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { extractObserveEvent, aggregateObserveStats } from "../src/audit.js";
import { readSavingsReport, readSessionRows } from "../src/core.js";

const cli = resolve("bin/token-ops.js");

// Run the observe hook with a stdin payload; returns { stdout, status }.
// stdio "pipe" so a nonzero exit would surface as a thrown error (it must not).
function runObserveHook(client, payload, cwd) {
  const hookName = client === "codex" ? "codex-observe" : "cursor-observe";
  return execFileSync(process.execPath, [cli, "hook", hookName, "--client", client], {
    cwd,
    encoding: "utf8",
    input: typeof payload === "string" ? payload : JSON.stringify(payload)
  });
}

function initRepo(prefix) {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd });
  return cwd;
}

// ---- extractObserveEvent (pure, metadata-only) ----

test("extractObserveEvent: Cursor beforeReadFile records size but not content", () => {
  const event = extractObserveEvent("cursor", {
    hook_event_name: "beforeReadFile",
    file_path: "/x/a.js",
    content: "const secret = 'API_KEY_123';\nmore lines\n"
  });
  assert.equal(event.kind, "read");
  assert.equal(event.event, "beforeReadFile");
  assert.ok(event.bytes > 0 && event.tokens > 0);
  // The record must carry no content — only numeric metadata.
  assert.ok(!JSON.stringify(event).includes("API_KEY_123"));
});

test("extractObserveEvent: Cursor beforeShellExecution classifies without keeping the command", () => {
  const search = extractObserveEvent("cursor", { hook_event_name: "beforeShellExecution", command: "grep -rn foo ." });
  assert.equal(search.kind, "search");
  const view = extractObserveEvent("cursor", { hook_event_name: "beforeShellExecution", command: "cat secrets.env" });
  assert.equal(view.kind, "view");
  assert.ok(!JSON.stringify(view).includes("secrets.env"));
  // A "before" hook has no result, so no token size is inferred.
  assert.equal(view.tokens, 0);
});

test("extractObserveEvent: Cursor beforeMCPExecution marks token-ops calls compliant, others not", () => {
  const ours = extractObserveEvent("cursor", { hook_event_name: "beforeMCPExecution", tool_name: "token-ops__build_compact_context" });
  assert.equal(ours.kind, "mcp");
  const other = extractObserveEvent("cursor", { hook_event_name: "beforeMCPExecution", tool_name: "some-other-server__thing" });
  assert.equal(other.kind, "other");
});

test("extractObserveEvent: Codex PostToolUse sizes the response and classifies bash", () => {
  const event = extractObserveEvent("codex", {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "cat file.txt" },
    tool_response: "SENSITIVE_OUTPUT line one\nline two"
  });
  assert.equal(event.kind, "view");
  assert.ok(event.tokens > 0, "PostToolUse should size the result");
  assert.ok(!JSON.stringify(event).includes("SENSITIVE_OUTPUT"));
});

test("extractObserveEvent: Codex ignores an empty/malformed payload (no tool_name)", () => {
  assert.equal(extractObserveEvent("codex", {}), null);
  assert.equal(extractObserveEvent("cursor", {}), null);
  assert.equal(extractObserveEvent("cursor", { hook_event_name: "afterFileEdit" }), null);
});

// ---- aggregateObserveStats + Cn/Ct ----

test("aggregateObserveStats: buckets per client and excludes 'other' from fetch/mcp", () => {
  const rows = [
    { type: "observe", client: "cursor", kind: "read", tokens: 100 },
    { type: "observe", client: "cursor", kind: "search", tokens: 20 },
    { type: "observe", client: "cursor", kind: "mcp", tokens: 10, tool: "build_compact_context" },
    { type: "observe", client: "cursor", kind: "other", tokens: 0 },
    { type: "observe", client: "codex", kind: "read", tokens: 5 },
    { type: "pack", budget: {} } // non-observe rows ignored
  ];
  const stats = aggregateObserveStats(rows);
  assert.equal(stats.cursor.reads.calls, 1);
  assert.equal(stats.cursor.searches.calls, 1);
  assert.equal(stats.cursor.mcp.calls, 1);
  assert.equal(stats.cursor.mcp.byTool.build_compact_context, 1);
  assert.equal(stats.cursor.other.calls, 1);
  assert.equal(stats.codex.reads.calls, 1);
  // Cn = mcp / (reads + searches + mcp) = 1/3; Ct = 10 / (100+20+10)
  const cn = Math.round((stats.cursor.mcp.calls / (stats.cursor.reads.calls + stats.cursor.searches.calls + stats.cursor.mcp.calls)) * 100);
  assert.equal(cn, 33);
});

// ---- fail-open: the safety-critical property ----

test("observe hook is fail-open on garbage, empty, and invalid-cwd input (always exits 0 with safe output)", () => {
  const cwd = initRepo("token-ops-observe-failopen-");
  const cases = [
    ["cursor", "not json at all {{{", "{}"],
    ["cursor", "", "{}"],
    ["codex", "not json {{{", '{"continue":true}'],
    ["codex", "", '{"continue":true}'],
    // valid JSON but bogus cwd inside payload — must still not throw
    ["cursor", JSON.stringify({ hook_event_name: "beforeReadFile", content: "x", workspace_roots: ["/no/such/dir/xyz"] }), "{}"],
    ["codex", JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: "x", cwd: "/no/such/dir/xyz" }), '{"continue":true}']
  ];
  for (const [client, payload, expected] of cases) {
    // execFileSync throws if the process exits nonzero — this asserts exit 0.
    const out = runObserveHook(client, payload, cwd);
    assert.equal(out, expected, `${client} / ${JSON.stringify(payload).slice(0, 30)} should emit ${expected}`);
  }
});

test("observe hook never records file content or command text (metadata only)", () => {
  const cwd = initRepo("token-ops-observe-nocontent-");
  runObserveHook("cursor", {
    hook_event_name: "beforeReadFile",
    file_path: "/x/a.js",
    content: "SUPER_SECRET_SENTINEL_AAA",
    workspace_roots: [cwd]
  }, cwd);
  runObserveHook("codex", {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "echo SUPER_SECRET_SENTINEL_BBB" },
    tool_response: "SUPER_SECRET_SENTINEL_CCC",
    cwd
  }, cwd);

  const log = readFileSync(join(cwd, ".token-ops", "session.jsonl"), "utf8");
  assert.ok(!log.includes("SUPER_SECRET_SENTINEL"), "no secret content/command text may reach the log");
  // But metadata IS recorded.
  const rows = readSessionRows(cwd).filter((r) => r.type === "observe");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => typeof r.tokens === "number" && typeof r.bytes === "number"));
});

test("observe events do not inflate the savings report (Runs count)", () => {
  const cwd = initRepo("token-ops-observe-savings-");
  runObserveHook("cursor", { hook_event_name: "beforeReadFile", content: "x", workspace_roots: [cwd] }, cwd);
  const report = readSavingsReport(cwd);
  assert.equal(report.events, 0, "observe rows must not count as pack/hook runs");
});

// ---- opt-in install/uninstall ----

test("plain install does NOT create observe hooks (opt-in only)", () => {
  const cwd = initRepo("token-ops-observe-optin-");
  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });
  assert.equal(existsSync(join(cwd, ".cursor", "hooks.json")), false, "default install must not write cursor hooks.json");
  assert.equal(existsSync(join(cwd, ".codex", "hooks.json")), false, "default install must not write codex hooks.json");
});

test("install observe writes fail-open Cursor + Codex hooks and gitignores them", () => {
  const cwd = initRepo("token-ops-observe-install-");
  const out = execFileSync(process.execPath, [cli, "install", "observe"], { cwd, encoding: "utf8" });
  assert.match(out, /never allow\/deny/i);

  const cursor = JSON.parse(readFileSync(join(cwd, ".cursor", "hooks.json"), "utf8"));
  assert.equal(cursor.version, 1);
  for (const event of ["beforeReadFile", "beforeShellExecution", "beforeMCPExecution"]) {
    assert.match(cursor.hooks[event][0].command, /hook cursor-observe/);
  }
  const codex = JSON.parse(readFileSync(join(cwd, ".codex", "hooks.json"), "utf8"));
  assert.match(codex.hooks.PostToolUse[0].hooks[0].command, /hook codex-observe/);

  const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(gitignore, /\.cursor\/hooks\.json/);
  assert.match(gitignore, /\.codex\/hooks\.json/);
});

test("install observe is idempotent (no duplicate entries on re-run)", () => {
  const cwd = initRepo("token-ops-observe-idem-");
  execFileSync(process.execPath, [cli, "install", "observe"], { cwd, encoding: "utf8" });
  execFileSync(process.execPath, [cli, "install", "observe"], { cwd, encoding: "utf8" });
  const cursor = JSON.parse(readFileSync(join(cwd, ".cursor", "hooks.json"), "utf8"));
  assert.equal(cursor.hooks.beforeReadFile.length, 1, "re-install must not duplicate our entry");
});

test("install observe preserves a user's pre-existing hooks; uninstall removes only ours", () => {
  const cwd = initRepo("token-ops-observe-merge-");
  // Pre-existing user hooks the install/uninstall must never touch.
  execFileSync(process.execPath, [cli, "install", "observe"], { cwd, encoding: "utf8" });
  const cursorPath = join(cwd, ".cursor", "hooks.json");
  const j = JSON.parse(readFileSync(cursorPath, "utf8"));
  j.hooks.beforeReadFile.unshift({ command: "/user/own.sh", timeout: 9 });
  j.hooks.stop = [{ command: "/user/stop.sh" }];
  writeFileSync(cursorPath, JSON.stringify(j, null, 2));

  execFileSync(process.execPath, [cli, "uninstall", "observe"], { cwd, encoding: "utf8" });

  const after = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.equal(after.hooks.beforeReadFile.length, 1);
  assert.equal(after.hooks.beforeReadFile[0].command, "/user/own.sh");
  assert.deepEqual(after.hooks.stop, [{ command: "/user/stop.sh" }]);
  // Codex file was ours only → deleted.
  assert.equal(existsSync(join(cwd, ".codex", "hooks.json")), false);
});

test("uninstall observe removes only the observe gitignore block, keeping the main block", () => {
  const cwd = initRepo("token-ops-observe-gitignore-");
  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });      // main block
  execFileSync(process.execPath, [cli, "install", "observe"], { cwd, encoding: "utf8" }); // + observe block
  execFileSync(process.execPath, [cli, "uninstall", "observe"], { cwd, encoding: "utf8" });

  const gitignore = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.doesNotMatch(gitignore, /\.cursor\/hooks\.json/);
  assert.doesNotMatch(gitignore, /\.codex\/hooks\.json/);
  assert.match(gitignore, /\.token-ops\//, "main managed block must survive");
});

// ---- audit surfaces observe-based Cn/Ct ----

test("token-ops audit reports Cursor/Codex compliance from observe rows", () => {
  const cwd = initRepo("token-ops-observe-audit-");
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-observe-audit-home-"));
  const env = { ...process.env, HOME: fakeHome };

  runObserveHook("cursor", { hook_event_name: "beforeReadFile", content: "aaaa bbbb cccc", workspace_roots: [cwd] }, cwd);
  runObserveHook("codex", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "grep -rn foo ." }, tool_response: "hit1 hit2", cwd }, cwd);
  runObserveHook("codex", { hook_event_name: "PostToolUse", tool_name: "token-ops__build_compact_context", tool_response: "# pack", cwd }, cwd);

  const out = execFileSync(process.execPath, [cli, "audit"], { cwd, encoding: "utf8", env });
  assert.match(out, /Cursor observe hook/);
  assert.match(out, /Codex observe hook/);
  // Codex: 1 mcp / (1 search + 1 mcp) = 50%.
  assert.match(out, /Cn 50%/);
  assert.match(out, /unified_exec/, "must keep the honest coverage caveat");
});

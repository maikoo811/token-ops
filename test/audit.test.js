import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_SNIPPET_LINE_CAP,
  auditTranscriptFile,
  classifyBashCommand,
  computeHookDelivery,
  renderAuditReport,
  resolveTranscriptDir,
  runAudit
} from "../src/audit.js";

const cli = resolve("bin/token-ops.js");

// ---- classifyBashCommand ----

test("classifyBashCommand: plain viewing commands are views", () => {
  assert.equal(classifyBashCommand("cat src/core.js"), "view");
  assert.equal(classifyBashCommand("head -50 README.md"), "view");
  assert.equal(classifyBashCommand("tail -n 20 log.txt"), "view");
  assert.equal(classifyBashCommand("sed -n '10,40p' src/core.js"), "view");
});

test("classifyBashCommand: search intent wins over viewing", () => {
  assert.equal(classifyBashCommand("grep -rn foo src/"), "search");
  assert.equal(classifyBashCommand("rg 'pattern' ."), "search");
  assert.equal(classifyBashCommand("cat src/core.js | grep export"), "search");
  assert.equal(classifyBashCommand("find . -name '*.js'"), "search");
});

test("classifyBashCommand: everything else is ignored", () => {
  assert.equal(classifyBashCommand("ls -la"), "other");
  assert.equal(classifyBashCommand("npm test"), "other");
  assert.equal(classifyBashCommand("git status"), "other");
  assert.equal(classifyBashCommand(""), "other");
});

// ---- resolveTranscriptDir ----

test("resolveTranscriptDir munges the cwd path with dashes", () => {
  const dir = resolveTranscriptDir(`${sep}Users${sep}x${sep}proj`, `${sep}home`);
  assert.equal(dir, join(`${sep}home`, ".claude", "projects", "-Users-x-proj"));
});

// ---- auditTranscriptFile / runAudit ----

function assistantLine(blocks) {
  return JSON.stringify({ type: "assistant", message: { content: blocks } });
}

function resultLine(id, content) {
  return JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content }] } });
}

// 160 one-char lines: 319 ASCII chars → 80 estimated tokens, capped at 80/160 → 40.
const LONG_READ = Array(160).fill("x").join("\n");

function writeFixture(dir) {
  const lines = [
    assistantLine([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/p/a.js" } }]),
    resultLine("t1", LONG_READ),
    assistantLine([{ type: "tool_use", id: "t2", name: "Bash", input: { command: "cat notes.md" } }]),
    resultLine("t2", "short SECRETXYZ view"),
    assistantLine([{ type: "tool_use", id: "t3", name: "Bash", input: { command: "grep -rn foo ." } }]),
    resultLine("t3", "match line"),
    assistantLine([{ type: "tool_use", id: "t4", name: "Grep", input: { pattern: "foo" } }]),
    resultLine("t4", "hits"),
    assistantLine([{ type: "tool_use", id: "t5", name: "mcp__token-ops__build_compact_context", input: { task: "t" } }]),
    resultLine("t5", "# pack"),
    assistantLine([{ type: "tool_use", id: "t6", name: "Bash", input: { command: "npm test" } }]),
    resultLine("t6", "should not be counted anywhere"),
    "{broken json",
    JSON.stringify({ type: "summary", summary: "ignored" })
  ];
  writeFileSync(join(dir, "session.jsonl"), `${lines.join("\n")}\n`);
}

test("auditTranscriptFile counts calls, tokens, cap, and unparseable lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "token-ops-audit-"));
  writeFixture(dir);

  const { stats } = await runAuditDir(dir);
  assert.equal(stats.reads.builtinCalls, 1);
  assert.equal(stats.reads.bashViewCalls, 1);
  assert.equal(stats.searches.grepCalls, 1);
  assert.equal(stats.searches.bashSearchCalls, 1);
  assert.equal(stats.mcp.calls, 1);
  assert.equal(stats.mcp.byTool.build_compact_context, 1);
  assert.equal(stats.unparseableLines, 1);

  // The 160-line read (80 tokens) is capped to 40; the short view adds a few more.
  assert.ok(stats.reads.tokens >= 80, `read tokens ${stats.reads.tokens}`);
  const capSaving = stats.reads.tokens - stats.reads.cappedTokens;
  assert.equal(capSaving, 40, `cap should shave exactly the long read's excess half (got ${capSaving})`);
});

async function runAuditDir(dir) {
  const stats = {
    files: 0,
    lines: 0,
    unparseableLines: 0,
    reads: { builtinCalls: 0, bashViewCalls: 0, tokens: 0, cappedTokens: 0 },
    searches: { grepCalls: 0, globCalls: 0, bashSearchCalls: 0, tokens: 0 },
    mcp: { calls: 0, tokens: 0, byTool: {} },
    readEvents: []
  };
  await auditTranscriptFile(join(dir, "session.jsonl"), stats);
  return { stats };
}

test("renderAuditReport outputs aggregates only, never transcript content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "token-ops-audit-render-"));
  writeFixture(dir);
  const { stats } = await runAuditDir(dir);

  for (const lang of ["en", "ja"]) {
    const out = renderAuditReport({ stats, dir, found: true }, lang);
    assert.ok(!out.includes("SECRETXYZ"), `${lang}: transcript content must not leak into the report`);
    // 1 MCP call out of 5 fetch-type calls total.
    assert.match(out, /Cn 20%/);
    assert.match(out, new RegExp(String(AUDIT_SNIPPET_LINE_CAP)));
  }
});

test("token-ops audit runs end-to-end against a fake HOME", () => {
  // realpathSync: macOS /var is a symlink to /private/var, and the CLI munges
  // the resolved process.cwd(), so the fixture dir must match the resolved form.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "token-ops-audit-cwd-")));
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-audit-home-"));
  const transcriptDir = resolveTranscriptDir(cwd, fakeHome);
  mkdirSync(transcriptDir, { recursive: true });
  writeFixture(transcriptDir);

  const output = execFileSync(process.execPath, [cli, "audit"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: fakeHome }
  });

  assert.match(output, /Token Ops Audit/);
  assert.match(output, /Read: 1 calls/);
  assert.ok(!output.includes("SECRETXYZ"));
});

test("token-ops audit reports missing transcripts without crashing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-audit-empty-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-audit-nohome-"));

  const output = execFileSync(process.execPath, [cli, "audit"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: fakeHome }
  });

  assert.match(output, /No Claude Code transcripts found/);
});

// ---- computeHookDelivery (hook-path effectiveness) ----

test("computeHookDelivery attributes reads to the latest preceding firing", () => {
  const sessionRows = [
    { type: "hook", timestamp: "2026-01-01T00:00:00.000Z", files: ["a.js", "b.js"] },
    { type: "hook", timestamp: "2026-01-01T01:00:00.000Z", files: ["c.js"] },
    // Non-hook rows never count as firings.
    { type: "pack", timestamp: "2026-01-01T00:30:00.000Z", files: ["z.js"] }
  ];
  const readEvents = [
    // Before the first firing — not attributable, excluded from the totals.
    { timestamp: "2025-12-31T23:00:00.000Z", filePath: "/repo/a.js" },
    // Covered: a.js was in the first pack.
    { timestamp: "2026-01-01T00:10:00.000Z", filePath: "/repo/a.js" },
    // Not covered: x.js was never packed.
    { timestamp: "2026-01-01T00:20:00.000Z", filePath: "/repo/x.js" },
    // Not covered: the latest firing's pack is [c.js], not [a.js].
    { timestamp: "2026-01-01T01:10:00.000Z", filePath: "/repo/a.js" },
    // Covered by the second pack.
    { timestamp: "2026-01-01T01:20:00.000Z", filePath: "/repo/c.js" }
  ];

  const out = computeHookDelivery(sessionRows, readEvents, "/repo");
  assert.equal(out.firings, 2);
  assert.equal(out.reads, 4, "the pre-firing read must be excluded");
  assert.equal(out.coveredReads, 2);
  assert.equal(out.readsPerFiring, 2);
  assert.equal(out.coveredReadRate, 50);
});

test("computeHookDelivery returns zeros without firings", () => {
  const out = computeHookDelivery([], [{ timestamp: "2026-01-01T00:00:00.000Z", filePath: "/repo/a.js" }], "/repo");
  assert.deepEqual(out, { firings: 0, reads: 0, coveredReads: 0, readsPerFiring: 0, coveredReadRate: 0 });
});

test("audit report includes the hook delivery section only when firings exist", () => {
  // realpathSync: the CLI munges the resolved cwd, and computeHookDelivery
  // strips the resolved prefix from Read paths.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "token-ops-audit-hook-")));
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-audit-hook-home-"));
  const transcriptDir = resolveTranscriptDir(cwd, fakeHome);
  mkdirSync(transcriptDir, { recursive: true });

  mkdirSync(join(cwd, ".token-ops"));
  writeFileSync(
    join(cwd, ".token-ops", "session.jsonl"),
    `${JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", type: "hook", files: ["a.js"] })}\n`
  );

  const lines = [
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:01:00.000Z",
      message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: join(cwd, "a.js") } }] }
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "r1", content: "covered read" }] }
    })
  ];
  writeFileSync(join(transcriptDir, "session.jsonl"), `${lines.join("\n")}\n`);

  const output = execFileSync(process.execPath, [cli, "audit"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: fakeHome }
  });

  assert.match(output, /Hook delivery effectiveness/);
  assert.match(output, /Firings: 1 \/ Reads after a firing: 1 \(1 per firing\)/);
  assert.match(output, /Covered-read rate: 100%/);
});

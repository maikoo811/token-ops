import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  extractKeywords,
  estimateTokens,
  finalizeTokenBudget,
  recordSessionEvent,
  SESSION_LOG_KEEP_LINES,
  SESSION_LOG_MAX_BYTES,
  shouldInjectForPrompt,
  resolveLanguage
} from "../src/core.js";

// ---- extractKeywords ----

test("extractKeywords: ASCII tokens are lowercased and stop words dropped", () => {
  const out = extractKeywords("Fix the CSV import bug");
  assert.deepEqual(out, ["csv", "import", "bug"]);
});

test("extractKeywords: Japanese is split into per-word Han/Katakana tokens", () => {
  const out = extractKeywords("キーワード抽出のバグを直して");
  assert.ok(out.includes("キーワード"));
  assert.ok(out.includes("抽出"));
  assert.ok(out.includes("バグ"));
  assert.ok(!out.includes("キーワード抽出のバグを直して"));
});

test("extractKeywords: hiragana-only tokens are dropped (grammar particles)", () => {
  const out = extractKeywords("ファイルをひらいて");
  assert.ok(out.includes("ファイル"));
  assert.ok(!out.includes("ひらいて"));
});

test("extractKeywords: drops Japanese stop words 修正/追加/実装/変更", () => {
  // Note: contiguous Han runs become a single token (no morphological split),
  // so "認証機能" is one keyword, not 認証 + 機能.
  const out = extractKeywords("バグを修正したい");
  assert.ok(out.includes("バグ"));
  assert.ok(!out.includes("修正"), "stop word 修正 should be dropped");
});

test("extractKeywords: returns at most 20 unique keywords", () => {
  const longTask = Array.from({ length: 40 }, (_, index) => `kw${index}`).join(" ");
  const out = extractKeywords(longTask);
  assert.equal(out.length, 20);
  assert.equal(new Set(out).size, out.length);
});

// ---- estimateTokens ----

test("estimateTokens: rounds up to the nearest token (ASCII)", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("a"), 1);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("estimateTokens: ASCII scales at ~1 token per 4 chars", () => {
  const text = "x".repeat(400);
  assert.equal(estimateTokens(text), 100);
});

test("estimateTokens: Japanese is denser than ASCII (~1 token per 1.5 chars)", () => {
  // 6 Japanese chars under the old 1/4 heuristic = ceil(6/4) = 2.
  // New heuristic counts CJK at 1/1.5, so 6 chars = ceil(4) = 4.
  assert.equal(estimateTokens("バグを直して"), 4);
  // 60 Japanese chars under old = ceil(60/4) = 15; under new = ceil(60/1.5) = 40.
  assert.equal(estimateTokens("あ".repeat(60)), 40);
});

test("estimateTokens: mixed-script text sums per-script estimates", () => {
  // "Fix バグ" = 4 ASCII + 1 space + 2 JA. Old: ceil(7/4) = 2. New: ceil(5/4 + 2/1.5) = ceil(1.25 + 1.33) = 3.
  assert.equal(estimateTokens("Fix バグ"), 3);
});

// ---- finalizeTokenBudget ----

test("finalizeTokenBudget: computes saved tokens and percent vs selected files", () => {
  const out = finalizeTokenBudget(
    {
      selectedFileCount: 3,
      repoFileCount: 10,
      selectedFullTokens: 10000,
      packTokens: 0,
      snippetTokens: 0,
      repoTokens: 20000,
      savedTokens: 0,
      savedPercent: 0,
      repoSavedTokens: 0,
      repoSavedPercent: 0
    },
    2000
  );
  assert.equal(out.packTokens, 2000);
  assert.equal(out.savedTokens, 8000);
  assert.equal(out.savedPercent, 80);
  assert.equal(out.repoSavedTokens, 18000);
  assert.equal(out.repoSavedPercent, 90);
});

test("finalizeTokenBudget: clamps negative savings to zero", () => {
  const out = finalizeTokenBudget(
    {
      selectedFileCount: 1,
      repoFileCount: 1,
      selectedFullTokens: 100,
      packTokens: 0,
      snippetTokens: 0,
      repoTokens: 100,
      savedTokens: 0,
      savedPercent: 0,
      repoSavedTokens: 0,
      repoSavedPercent: 0
    },
    300
  );
  assert.equal(out.savedTokens, 0);
  assert.equal(out.repoSavedTokens, 0);
  assert.equal(out.savedPercent, 0);
});

test("finalizeTokenBudget: handles zero baselines without dividing by zero", () => {
  const out = finalizeTokenBudget(
    {
      selectedFileCount: 0,
      repoFileCount: 0,
      selectedFullTokens: 0,
      packTokens: 0,
      snippetTokens: 0,
      repoTokens: 0,
      savedTokens: 0,
      savedPercent: 0,
      repoSavedTokens: 0,
      repoSavedPercent: 0
    },
    50
  );
  assert.equal(out.savedPercent, 0);
  assert.equal(out.repoSavedPercent, 0);
});

// ---- shouldInjectForPrompt ----

test("shouldInjectForPrompt: requires English word boundaries", () => {
  assert.equal(shouldInjectForPrompt("Please fix the parser"), true);
  assert.equal(shouldInjectForPrompt("Reading the prefix list"), false, "`prefix` must not match `fix`");
  assert.equal(shouldInjectForPrompt("This is a fixture file"), false, "`fixture` must not match `fix`");
  assert.equal(shouldInjectForPrompt("Mailing address question"), false, "`address` must not match `add`");
  assert.equal(shouldInjectForPrompt("Run the test fixture"), true, "`test` standalone still triggers");
});

test("shouldInjectForPrompt: aggressive mode fires without trigger words", () => {
  // Prompts that would be REJECTED in smart mode (no coding keywords)
  assert.equal(shouldInjectForPrompt("How does this project work?", "aggressive"), true);
  assert.equal(shouldInjectForPrompt("Explain the rationale here", "aggressive"), true);
  assert.equal(shouldInjectForPrompt("どうやって動いているの", "aggressive"), true);
  // Same in smart mode → false
  assert.equal(shouldInjectForPrompt("How does this project work?", "smart"), false);
  assert.equal(shouldInjectForPrompt("どうやって動いているの", "smart"), false);
});

test("shouldInjectForPrompt: aggressive mode still applies length + self-ref filters", () => {
  assert.equal(shouldInjectForPrompt("ok", "aggressive"), false, "too short");
  assert.equal(shouldInjectForPrompt("token-ops is great", "aggressive"), false, "self-reference");
  assert.equal(shouldInjectForPrompt("", "aggressive"), false, "empty");
});

test("shouldInjectForPrompt: fires for natural Japanese requests", () => {
  assert.equal(shouldInjectForPrompt("バグを直して"), true);
  assert.equal(shouldInjectForPrompt("不具合の修正"), true);
  assert.equal(shouldInjectForPrompt("関数が動かない"), true);
  assert.equal(shouldInjectForPrompt("壊れているので見て"), true);
});

test("shouldInjectForPrompt: skips trivial, self-referential, or empty prompts", () => {
  assert.equal(shouldInjectForPrompt(""), false);
  assert.equal(shouldInjectForPrompt("ok"), false);
  assert.equal(shouldInjectForPrompt("ありがとう"), false, "no trigger keyword");
  assert.equal(shouldInjectForPrompt("token-opsを試したい"), false, "self-reference is excluded");
});

// ---- resolveLanguage ----

test("resolveLanguage: explicit lang overrides task detection", () => {
  assert.equal(resolveLanguage("en", "バグを直して"), "en");
  assert.equal(resolveLanguage("ja", "fix the bug"), "ja");
});

test("resolveLanguage: auto detects Japanese from task content", () => {
  assert.equal(resolveLanguage("auto", "バグを直して"), "ja");
  assert.equal(resolveLanguage("auto", "fix the bug"), "en");
  assert.equal(resolveLanguage("auto", ""), "en");
});

// ---- recordSessionEvent log rotation ----

test("recordSessionEvent trims session.jsonl once it exceeds the size cap", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-log-rotate-"));
  const path = join(cwd, ".token-ops", "session.jsonl");

  // Pre-seed an oversized log with one record per line.
  execFileSync(process.execPath, ["-e", `
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.join(${JSON.stringify(cwd)}, ".token-ops"), { recursive: true });
    const lines = [];
    const filler = "x".repeat(200);
    for (let i = 0; i < ${SESSION_LOG_KEEP_LINES + 2_000}; i++) {
      lines.push(JSON.stringify({ i, filler }));
    }
    fs.writeFileSync(path.join(${JSON.stringify(cwd)}, ".token-ops", "session.jsonl"), lines.join("\\n") + "\\n");
  `]);

  const sizeBefore = statSync(path).size;
  assert.ok(sizeBefore > SESSION_LOG_MAX_BYTES, "test fixture should exceed the cap to exercise trimming");

  // One more append triggers the trim pass.
  recordSessionEvent(cwd, { type: "test", task: "trigger trim", budget: {} });

  const after = readFileSync(path, "utf8").split("\n").filter(Boolean);
  assert.ok(after.length <= SESSION_LOG_KEEP_LINES, `should keep at most ${SESSION_LOG_KEEP_LINES} lines, got ${after.length}`);
  // The new event must still be present (it's the last line).
  const last = JSON.parse(after[after.length - 1]);
  assert.equal(last.task, "trigger trim");
});

test("recordSessionEvent is a no-op when TOKEN_OPS_DISABLE_LOG=1", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-disable-log-"));

  const originalValue = process.env.TOKEN_OPS_DISABLE_LOG;
  process.env.TOKEN_OPS_DISABLE_LOG = "1";
  try {
    const returnValue = recordSessionEvent(cwd, { type: "test", task: "should not be logged", budget: {} });
    assert.equal(returnValue, null, "recordSessionEvent should return null when disabled");
    // .token-ops directory should not have been created either
    assert.equal(existsSync(join(cwd, ".token-ops")), false, ".token-ops/ must not be created when disabled");
  } finally {
    if (originalValue === undefined) {
      delete process.env.TOKEN_OPS_DISABLE_LOG;
    } else {
      process.env.TOKEN_OPS_DISABLE_LOG = originalValue;
    }
  }
});

test("recordSessionEvent still logs when TOKEN_OPS_DISABLE_LOG is unset", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-log-default-"));
  const before = process.env.TOKEN_OPS_DISABLE_LOG;
  delete process.env.TOKEN_OPS_DISABLE_LOG;
  try {
    const returnValue = recordSessionEvent(cwd, { type: "test", task: "default", budget: {} });
    assert.ok(returnValue && returnValue.endsWith("session.jsonl"));
  } finally {
    if (before !== undefined) process.env.TOKEN_OPS_DISABLE_LOG = before;
  }
});

test("recordSessionEvent does not rewrite the file when under the cap", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-log-small-"));
  const path = join(cwd, ".token-ops", "session.jsonl");

  recordSessionEvent(cwd, { type: "test", task: "first", budget: {} });
  const firstSize = statSync(path).size;
  recordSessionEvent(cwd, { type: "test", task: "second", budget: {} });
  const secondSize = statSync(path).size;

  assert.ok(secondSize > firstSize, "small logs should just append, not rotate");
});

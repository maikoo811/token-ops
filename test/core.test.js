import test from "node:test";
import assert from "node:assert/strict";
import {
  extractKeywords,
  estimateTokens,
  finalizeTokenBudget,
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

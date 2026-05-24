import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { shouldInjectForPrompt } from "../src/core.js";

const cli = resolve("bin/token-ops.js");

test("prints help", () => {
  const output = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.match(output, /token-ops/);
  assert.match(output, /pack/);
});

test("builds a compact context pack from a git repository", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
  execFileSync("git", ["config", "user.name", "Token Ops Test"], { cwd });

  writeFileSync(join(cwd, "importer.js"), "export function importCsv(row) {\n  return row.csv_id;\n}\n");
  writeFileSync(join(cwd, "README.md"), "# Demo\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });

  const output = execFileSync(process.execPath, [cli, "pack", "fix csv importer"], {
    cwd,
    encoding: "utf8"
  });

  assert.match(output, /# Token Ops Context Pack/);
  assert.match(output, /importer\.js/);
  assert.match(output, /csv_id/);

  const report = execFileSync(process.execPath, [cli, "report"], {
    cwd,
    encoding: "utf8"
  });
  assert.match(report, /Token Ops Savings Report/);
  assert.match(report, /Runs: 1/);
});

test("installs Cursor and Claude Code project helpers", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-install-"));
  const output = execFileSync(process.execPath, [cli, "install"], {
    cwd,
    encoding: "utf8"
  });

  assert.match(output, /Installed token-ops integration/);
  assert.equal(existsSync(join(cwd, ".claude", "skills", "token-ops", "SKILL.md")), true);
  assert.equal(existsSync(join(cwd, ".claude", "settings.local.json")), true);
  assert.equal(existsSync(join(cwd, ".cursor", "rules", "token-ops.mdc")), true);
  assert.equal(existsSync(join(cwd, "AGENTS.md")), true);
});

test("claude prompt hook emits additional compact context", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-hook-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "README.md"), "# Demo\n\nCursor setup notes.\n");

  const output = execFileSync(process.execPath, [cli, "hook", "claude-user-prompt-submit"], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify({
      cwd,
      prompt: "READMEのCursor説明を改善して"
    })
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(parsed.hookSpecificOutput.additionalContext, /Token Ops コンテキストパック/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /トークン予算/);
  assert.match(parsed.hookSpecificOutput.additionalContext, /README\.md/);
});

test("splits Japanese prompts into per-word keywords, not one long blob", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-ja-keywords-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "README.md"), "# Demo\nキーワード抽出を行う\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init"], { cwd, stdio: "ignore" });

  const output = execFileSync(process.execPath, [cli, "pack", "キーワード抽出のバグを直して"], {
    cwd,
    encoding: "utf8"
  });

  assert.match(output, /`キーワード`/);
  assert.match(output, /`抽出`/);
  assert.match(output, /`バグ`/);
  assert.doesNotMatch(output, /`キーワード抽出のバグを直して`/);
});

test("bridges Japanese keywords to English file names during ranking", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-ja-bridge-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(
    join(cwd, "keyword_extractor.js"),
    "export function extractKeywords(task) {\n  return task.split(/\\s+/);\n}\n"
  );
  writeFileSync(join(cwd, "unrelated.js"), "export const noop = () => {};\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init"], { cwd, stdio: "ignore" });

  const output = execFileSync(process.execPath, [cli, "pack", "キーワード抽出のバグを直して"], {
    cwd,
    encoding: "utf8"
  });

  const relevantSection = output.split(/##\s+関連ファイル/)[1] || "";
  assert.match(relevantSection, /keyword_extractor\.js/);
  assert.doesNotMatch(output, /`keyword`/);
  assert.doesNotMatch(output, /`extract`/);
});

test("hook fires for natural Japanese bug-fix prompts", () => {
  assert.equal(shouldInjectForPrompt("バグを直して"), true);
  assert.equal(shouldInjectForPrompt("この関数が動かない"), true);
  assert.equal(shouldInjectForPrompt("不具合を直したい"), true);
  assert.equal(shouldInjectForPrompt("壊れているので見て"), true);
  assert.equal(shouldInjectForPrompt("ok"), false);
  assert.equal(shouldInjectForPrompt("token-opsを試す"), false);
});

test("prints high cost files as JSON", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-high-cost-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "large.js"), "export const value = 1;\n".repeat(100));

  const output = execFileSync(process.execPath, [cli, "high-cost-files", "--limit", "1"], {
    cwd,
    encoding: "utf8"
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].file, "large.js");
});

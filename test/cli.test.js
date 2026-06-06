import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("bridges expanded JA terms (フォルダ構造見直し) to English file matches", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-ja-structure-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "folder-layout.md"), "# Folder layout\n\nOverview of the directory structure.\n");
  writeFileSync(join(cwd, "unrelated.js"), "export const noop = () => {};\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init"], { cwd, stdio: "ignore" });

  const output = execFileSync(process.execPath, [cli, "pack", "フォルダ構造を見直して"], {
    cwd,
    encoding: "utf8"
  });

  const relevantSection = output.split(/##\s+関連ファイル/)[1] || "";
  assert.match(relevantSection, /folder-layout\.md/, "folder/structure/review bridge should pick the folder-layout.md file");
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

test("install adds .token-ops/ to .gitignore (creating it if missing)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-gitignore-new-"));
  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });
  const contents = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(contents, /\.token-ops\//);
});

test("install preserves existing .gitignore content and is idempotent", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-gitignore-merge-"));
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\nmy-secret.env\n");

  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });
  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });

  const contents = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(contents, /node_modules\//);
  assert.match(contents, /my-secret\.env/);
  const occurrences = (contents.match(/\.token-ops\//g) || []).length;
  assert.equal(occurrences, 1, "second install should not duplicate the entry");
});

test("uninstall removes the .token-ops/ entry it added", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-gitignore-uninstall-"));
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");

  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });
  execFileSync(process.execPath, [cli, "uninstall"], { cwd, encoding: "utf8" });

  const contents = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(contents, /node_modules\//);
  assert.doesNotMatch(contents, /\.token-ops\//);
});

test("install also adds .claude/settings.local.json to .gitignore", () => {
  // The file contains an absolute cliPath from process.argv[1], so leaking
  // it via git would break the config for any teammate whose node binary
  // lives at a different path. Belongs in .gitignore for the same reason
  // .token-ops/ does.
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-gitignore-claude-"));
  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });
  const contents = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(contents, /\.claude\/settings\.local\.json/);
});

test("install output explains why .claude/settings.local.json is gitignored", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-install-note-"));
  const output = execFileSync(process.execPath, [cli, "install"], {
    cwd,
    encoding: "utf8"
  });
  // We only require that the note is shown and mentions the path. The
  // exact wording is allowed to drift across releases.
  assert.match(output, /\.claude\/settings\.local\.json/);
  assert.match(output, /absolute path|stay local|gitignored/i);
});

test("uninstall removes the .claude/settings.local.json entry it added", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-gitignore-claude-uninstall-"));
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");

  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });
  execFileSync(process.execPath, [cli, "uninstall"], { cwd, encoding: "utf8" });

  const contents = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(contents, /node_modules\//);
  assert.doesNotMatch(contents, /\.claude\/settings\.local\.json/);
});

test("install upgrades a v0.4.x-style gitignore block (legacy header + only .token-ops/)", () => {
  // Simulates a repo where token-ops was installed under v0.4.x: the old
  // block has the "session log" header and only the .token-ops/ entry.
  // A re-install on v0.4.5+ should add the missing claude entry without
  // duplicating the existing one.
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-gitignore-upgrade-"));
  writeFileSync(
    join(cwd, ".gitignore"),
    "node_modules/\n\n# Token Ops session log\n.token-ops/\n"
  );

  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });

  const contents = readFileSync(join(cwd, ".gitignore"), "utf8");
  assert.match(contents, /\.token-ops\//);
  assert.match(contents, /\.claude\/settings\.local\.json/);
  const tokenOpsCount = (contents.match(/\.token-ops\//g) || []).length;
  assert.equal(tokenOpsCount, 1, "must not duplicate .token-ops/ when upgrading");
});

test("install claude-hook --trigger-mode aggressive bakes the flag into settings", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-trigger-mode-"));

  execFileSync(process.execPath, [cli, "install", "claude-hook", "--trigger-mode", "aggressive"], {
    cwd,
    encoding: "utf8"
  });

  const settings = JSON.parse(readFileSync(join(cwd, ".claude", "settings.local.json"), "utf8"));
  const entry = settings.hooks.UserPromptSubmit[0];
  const args = entry.hooks[0].args;

  assert.ok(args.includes("--trigger-mode"), "args should include --trigger-mode flag");
  assert.equal(args[args.indexOf("--trigger-mode") + 1], "aggressive");
});

test("install claude-hook (default smart mode) omits --trigger-mode flag", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-trigger-default-"));

  execFileSync(process.execPath, [cli, "install", "claude-hook"], { cwd, encoding: "utf8" });

  const settings = JSON.parse(readFileSync(join(cwd, ".claude", "settings.local.json"), "utf8"));
  const args = settings.hooks.UserPromptSubmit[0].hooks[0].args;

  assert.ok(!args.includes("--trigger-mode"), "default smart mode should not write the flag");
});

// ---- AST-based snippet boundary detection (JS/TS) ----

function setupJsRepo(seedFiles) {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-ast-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  for (const [name, content] of Object.entries(seedFiles)) {
    writeFileSync(join(cwd, name), content);
  }
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init"], { cwd, stdio: "ignore" });
  return cwd;
}

test("AST mode: snippet contains the entire enclosing function for JS files", () => {
  const cwd = setupJsRepo({
    "auth.js": [
      "// header comment",
      "const PADDING = 1;",
      "",
      "export function loginUser(name) {",
      "  if (!name) {",
      "    throw new Error('name required');",
      "  }",
      "  return { name };",
      "}",
      "",
      "function unrelated() {",
      "  return 42;",
      "}"
    ].join("\n")
  });
  const output = execFileSync(process.execPath, [cli, "pack", "fix loginUser"], { cwd, encoding: "utf8" });
  // The whole loginUser body must appear — start signature, throw line, and closing brace
  assert.match(output, /export function loginUser\(name\)/);
  assert.match(output, /throw new Error\('name required'\)/);
  assert.match(output, /return \{ name \}/);
  // The padding above (`const PADDING = 1;`) should NOT be there — AST is precise
  assert.doesNotMatch(output, /const PADDING/);
});

test("AST mode: falls back to window mode when the function exceeds max-lines", () => {
  // Construct a function whose body is 80 lines — larger than --max-lines 20
  const bodyLines = Array.from({ length: 80 }, (_, i) => `  const v${i} = ${i};`).join("\n");
  const file = `export function huge() {\n${bodyLines}\n  return loginUser('end');\n}\n`;
  const cwd = setupJsRepo({ "huge.js": file });

  const output = execFileSync(process.execPath, [cli, "pack", "fix loginUser", "--max-lines", "20"], {
    cwd, encoding: "utf8"
  });
  // Window mode would center on the match (the `return loginUser('end')` line near the end);
  // it should be present, but the function signature at line 1 should NOT (it's too far away).
  assert.match(output, /loginUser/);
  assert.doesNotMatch(output, /function huge\(\)/, "signature far from match should not appear under window mode");
});

test("AST mode: non-JS files still use window mode", () => {
  const cwd = setupJsRepo({
    "notes.md": "# Heading\n\nA mention of loginUser in prose.\n\nMore prose.\n"
  });
  const output = execFileSync(process.execPath, [cli, "pack", "fix loginUser"], { cwd, encoding: "utf8" });
  assert.match(output, /loginUser/);
  // No JS parse should have happened; the Markdown content is just snippet'd
  assert.match(output, /# Heading/);
});

test("AST mode: braces inside strings and comments don't break the parser", () => {
  const cwd = setupJsRepo({
    "tricky.js": [
      "export function loginUser(name) {",
      "  const trap1 = '{ not a real brace }';",
      '  const trap2 = "} another fake";',
      "  // } orphan in comment",
      "  /* and { another } block comment */",
      "  return `template ${name} with } braces`;",
      "}"
    ].join("\n")
  });
  const output = execFileSync(process.execPath, [cli, "pack", "fix loginUser"], { cwd, encoding: "utf8" });
  // The full function body up to and including the closing brace must be selected
  assert.match(output, /export function loginUser\(name\)/);
  assert.match(output, /template \$\{name\}/);
  // The closing `}` must be present (proves the parser walked all the way through)
  assert.match(output, /^\s+\d+\s+\|\s+\}\s*$/m);
});

test("install --global writes to fake HOME instead of cwd", () => {
  // Use HOME override so the install lands in a tmpdir, not the maintainer's
  // real ~/.claude. Project cwd is a separate tmpdir to confirm it stays empty.
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-global-cwd-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-global-home-"));

  const out = execFileSync(
    process.execPath,
    [cli, "install", "claude-hook", "--global"],
    { cwd, encoding: "utf8", env: { ...process.env, HOME: fakeHome } }
  );

  // Global install: files land in HOME, NOT in the project cwd
  assert.equal(existsSync(join(fakeHome, ".claude", "settings.json")), true,
    "global hook should write to ~/.claude/settings.json");
  assert.equal(existsSync(join(fakeHome, ".claude", "skills", "token-ops", "SKILL.md")), true,
    "global SKILL should write to ~/.claude/skills/token-ops/");
  assert.equal(existsSync(join(cwd, ".claude")), false,
    "global install must not touch the project cwd");
  assert.equal(existsSync(join(cwd, ".gitignore")), false,
    "global install must not touch project .gitignore");

  assert.match(out, /user-wide/, "output should label the scope as user-wide");
});

test("uninstall --global removes the global hook + leaves project files intact", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-global-uninstall-cwd-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-global-uninstall-home-"));
  const env = { ...process.env, HOME: fakeHome };

  // Pre-state: install both project-scoped (in cwd) and global (in HOME)
  execFileSync(process.execPath, [cli, "install", "claude-hook"], { cwd, encoding: "utf8", env });
  execFileSync(process.execPath, [cli, "install", "claude-hook", "--global"], { cwd, encoding: "utf8", env });

  // Both exist
  assert.equal(existsSync(join(cwd, ".claude", "settings.local.json")), true);
  assert.equal(existsSync(join(fakeHome, ".claude", "settings.json")), true);

  // Uninstall ONLY the global one
  execFileSync(process.execPath, [cli, "uninstall", "claude-hook", "--global"], { cwd, encoding: "utf8", env });

  assert.equal(existsSync(join(fakeHome, ".claude", "settings.json")), false,
    "global hook should be removed");
  assert.equal(existsSync(join(cwd, ".claude", "settings.local.json")), true,
    "project hook must NOT be touched");
});

test("install --global codex is rejected (codex has no global concept)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-global-codex-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-global-codex-home-"));

  assert.throws(
    () => execFileSync(
      process.execPath,
      [cli, "install", "codex", "--global"],
      { cwd, encoding: "utf8", env: { ...process.env, HOME: fakeHome }, stdio: "pipe" }
    ),
    /not supported for codex/
  );
});

test("install cursor --global writes to ~/.cursor/mcp.json and prints the User Rule", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-global-cursor-cwd-"));
  const fakeHome = mkdtempSync(join(tmpdir(), "token-ops-global-cursor-home-"));

  const out = execFileSync(
    process.execPath,
    [cli, "install", "cursor", "--global"],
    { cwd, encoding: "utf8", env: { ...process.env, HOME: fakeHome } }
  );

  // The MCP config file is created with token-ops registered
  const mcpPath = join(fakeHome, ".cursor", "mcp.json");
  assert.equal(existsSync(mcpPath), true);
  const mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
  assert.ok(mcp.mcpServers["token-ops"], "mcp.json should declare token-ops");
  assert.match(mcp.mcpServers["token-ops"].args[0], /mcp[\\/]+server\.js$/);

  // User Rules cannot be installed via file — output prints rule text instead
  assert.match(out, /paste this once/i);
  assert.match(out, /User Rules/);
  // No file-based rule should be written under project either
  assert.equal(existsSync(join(cwd, ".cursor")), false);
});

test("install claude-hook bakes the absolute path to node into command (GUI-launchable)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-nodepath-"));
  execFileSync(process.execPath, [cli, "install", "claude-hook"], { cwd, encoding: "utf8" });

  const settings = JSON.parse(readFileSync(join(cwd, ".claude", "settings.local.json"), "utf8"));
  const command = settings.hooks.UserPromptSubmit[0].hooks[0].command;

  assert.equal(command, process.execPath,
    "command should be the absolute path of the node binary that ran the install");
  assert.notEqual(command, "node", "must not fall back to bare 'node'");
  assert.ok(command.startsWith("/") || /^[A-Z]:\\/.test(command),
    "path must be absolute (POSIX or Windows-style)");
});

test("hook respects --trigger-mode aggressive (fires on prompts without trigger words)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-hook-aggressive-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "README.md"), "# Demo\n\nSome project notes.\n");

  // Prompt with no coding keywords — smart mode would reject it.
  const prompt = "How does this project work?";

  const smartOutput = execFileSync(
    process.execPath,
    [cli, "hook", "claude-user-prompt-submit"],
    { cwd, encoding: "utf8", input: JSON.stringify({ cwd, prompt }) }
  );
  assert.equal(smartOutput.trim(), "{}", "smart mode should reject prompt without trigger words");

  const aggressiveOutput = execFileSync(
    process.execPath,
    [cli, "hook", "claude-user-prompt-submit", "--trigger-mode", "aggressive"],
    { cwd, encoding: "utf8", input: JSON.stringify({ cwd, prompt }) }
  );
  const parsed = JSON.parse(aggressiveOutput);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(parsed.hookSpecificOutput.additionalContext, /Token Ops/);
});

test("uninstall removes everything install created", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-uninstall-"));

  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });
  assert.equal(existsSync(join(cwd, ".claude", "skills", "token-ops", "SKILL.md")), true);
  assert.equal(existsSync(join(cwd, ".claude", "settings.local.json")), true);
  assert.equal(existsSync(join(cwd, ".cursor", "rules", "token-ops.mdc")), true);
  assert.equal(existsSync(join(cwd, "AGENTS.md")), true);

  const output = execFileSync(process.execPath, [cli, "uninstall"], { cwd, encoding: "utf8" });

  assert.match(output, /Uninstalled token-ops integration/);
  assert.equal(existsSync(join(cwd, ".claude", "skills", "token-ops", "SKILL.md")), false);
  assert.equal(existsSync(join(cwd, ".claude", "settings.local.json")), false);
  assert.equal(existsSync(join(cwd, ".cursor", "rules", "token-ops.mdc")), false);
  assert.equal(existsSync(join(cwd, "AGENTS.md")), false);
});

test("uninstall preserves unrelated settings.local.json hooks and AGENTS.md content", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-uninstall-preserve-"));

  // Pre-existing user content that uninstall must NOT touch.
  writeFileSync(
    join(cwd, "AGENTS.md"),
    "# Repository Instructions\n\n## Pre-existing\n\nKeep this paragraph.\n"
  );

  execFileSync(process.execPath, [cli, "install"], { cwd, encoding: "utf8" });

  // Add an unrelated hook to settings.local.json that uninstall must NOT touch.
  const settingsPath = join(cwd, ".claude", "settings.local.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.hooks.UserPromptSubmit.push({
    matcher: "",
    hooks: [{ type: "command", command: "echo", args: ["unrelated"], timeout: 5 }]
  });
  settings.permissions = { allow: ["Bash(ls)"] };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  execFileSync(process.execPath, [cli, "uninstall"], { cwd, encoding: "utf8" });

  // Settings file still exists with the unrelated hook + permissions intact.
  assert.equal(existsSync(settingsPath), true);
  const after = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(after.hooks.UserPromptSubmit.length, 1);
  assert.deepEqual(after.hooks.UserPromptSubmit[0].hooks[0].args, ["unrelated"]);
  assert.deepEqual(after.permissions, { allow: ["Bash(ls)"] });

  // AGENTS.md preserved its pre-existing content; token-ops block removed.
  const agents = readFileSync(join(cwd, "AGENTS.md"), "utf8");
  assert.match(agents, /Keep this paragraph\./);
  assert.doesNotMatch(agents, /token-ops:start/);
});

test("uninstall on a clean directory is a no-op with a helpful message", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-uninstall-noop-"));
  const output = execFileSync(process.execPath, [cli, "uninstall"], { cwd, encoding: "utf8" });
  assert.match(output, /Nothing to uninstall/);
});

test("claude prompt hook falls back gracefully when input.cwd is invalid", () => {
  // A non-existent cwd in the hook payload — the hook should not crash;
  // it should silently fall back to process.cwd() (this test's cwd, which
  // IS a git repo: the token-ops repo itself).
  const output = execFileSync(
    process.execPath,
    [cli, "hook", "claude-user-prompt-submit"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        cwd: "/this/path/definitely/does/not/exist",
        prompt: "fix the bug in extractKeywords"
      })
    }
  );

  // Should be valid JSON — either {} or a hookSpecificOutput object.
  const parsed = JSON.parse(output);
  assert.ok(typeof parsed === "object", "hook must always emit a JSON object");
  // The bogus cwd must NOT appear anywhere in the output.
  assert.doesNotMatch(output, /\/this\/path\/definitely\/does\/not\/exist/);
});

test("claude prompt hook falls back gracefully when input.cwd is not a git repo", () => {
  const nonGitDir = mkdtempSync(join(tmpdir(), "token-ops-hook-nogit-"));
  writeFileSync(join(nonGitDir, "README.md"), "# just a directory, not a git repo\n");

  const output = execFileSync(
    process.execPath,
    [cli, "hook", "claude-user-prompt-submit"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        cwd: nonGitDir,
        prompt: "fix the bug in extractKeywords"
      })
    }
  );

  const parsed = JSON.parse(output);
  assert.ok(typeof parsed === "object", "hook must always emit a JSON object");
  // Whatever pack it produces, the non-git path must not be the reported root.
  if (parsed.hookSpecificOutput) {
    assert.doesNotMatch(
      parsed.hookSpecificOutput.additionalContext,
      new RegExp(nonGitDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  }
});

test("symlink to a file outside the repo is never included in the pack", () => {
  const cwd = mkdtempSync(join(tmpdir(), "token-ops-symlink-"));
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "real.txt"), "this file is genuinely inside the repo\n");

  // Create a separate file outside the repo that should NEVER appear in pack output.
  const outsideDir = mkdtempSync(join(tmpdir(), "token-ops-outside-"));
  const outsidePath = join(outsideDir, "SHOULD_NOT_LEAK.txt");
  writeFileSync(outsidePath, "SUPER_SECRET_TOKEN_OPS_SENTINEL\n");

  // Track the symlink inside the repo.
  execFileSync("ln", ["-s", outsidePath, join(cwd, "leak.txt")]);
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "init"], {
    cwd,
    stdio: "ignore"
  });

  const output = execFileSync(process.execPath, [cli, "pack", "find the secret"], {
    cwd,
    encoding: "utf8"
  });

  assert.doesNotMatch(output, /SUPER_SECRET_TOKEN_OPS_SENTINEL/, "symlink-followed content must not leak into pack");
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

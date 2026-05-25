#!/usr/bin/env node
// Aggregate Token Ops hook firings in `.token-ops/session.jsonl` by
// prompt type and print a Markdown breakdown.
//
// Usage:
//   cd /path/to/your/project
//   node /path/to/token-ops/docs/session-stats.mjs
//
// Output:
//   Markdown table you can paste into a README, plus an aggregate
//   savings summary in tokens and approximate USD.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const logPath = join(cwd, ".token-ops", "session.jsonl");

if (!existsSync(logPath)) {
  console.error(`No session log at ${logPath}. Run \`token-ops pack\` or install the hook first.`);
  process.exit(1);
}

const rows = readFileSync(logPath, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// "hook" entries are the only ones that represent a real user prompt
// being auto-augmented by Token Ops. `pack` and `mcp.*` entries come
// from explicit CLI / MCP invocations and would bias the savings story.
const hookRows = rows.filter((r) => r.type === "hook");

// Exact prompt strings used inside `test/cli.test.js` so the development
// `npm test` runs don't pollute a developer's own session aggregate.
const TEST_FIXTURES = new Set([
  "fix the bug in extractKeywords",
  "READMEのCursor説明を改善して",
  "find the secret"
]);

const real = hookRows.filter((r) => !TEST_FIXTURES.has(r.task));

function classify(task) {
  const p = String(task || "");
  if (/バグを直|fix.*bug|直して|不具合|修正して/i.test(p)) {
    return "Bug fix / task request";
  }
  if (/(エラー|error|info\]|fatal|stack|console\.log)/i.test(p) && p.length > 80) {
    return "Diagnosis (pasted log)";
  }
  if (/[?？]$|なの[?？]|どう|教えて|意味ね|どうやって|何を|何が|how /i.test(p)) {
    return "Question / clarification";
  }
  if (/(確認して|verify|チェック|プッシュ できた|やろう|やって$|進めて|でやって|でok|これで)/i.test(p)) {
    return "Decision / verification";
  }
  return "Other";
}

const median = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] || 0;

const buckets = new Map();
for (const r of real) {
  const type = classify(r.task);
  if (!buckets.has(type)) buckets.set(type, []);
  buckets.get(type).push(r);
}

function summarize(rows) {
  return {
    count: rows.length,
    medianPack: median(rows.map((r) => r.budget?.packTokens || 0)),
    medianSavedVsFiles: median(rows.map((r) => r.budget?.savedTokens || 0)),
    medianSavedVsRepo: median(rows.map((r) => r.budget?.repoSavedTokens || 0))
  };
}

const totalSavedVsRepo = real.reduce((sum, r) => sum + (r.budget?.repoSavedTokens || 0), 0);
const totalSavedVsFiles = real.reduce((sum, r) => sum + (r.budget?.savedTokens || 0), 0);
const totalPack = real.reduce((sum, r) => sum + (r.budget?.packTokens || 0), 0);

const SONNET_USD_PER_MTOK = 3;
const OPUS_USD_PER_MTOK = 15;

console.log("# Token Ops Session Stats\n");
console.log(`Source: \`${logPath}\``);
console.log(`Hook firings counted: ${real.length}` +
  (hookRows.length > real.length ? ` (excluded ${hookRows.length - real.length} test-fixture entries)` : "") +
  "\n");

if (real.length === 0) {
  console.log("No real hook firings yet — install the Claude Code hook and use it for a while, then re-run.\n");
  process.exit(0);
}

console.log("## By prompt type\n");
console.log("| Prompt type | Count | Median pack | Median saved vs whole repo |");
console.log("|---|---|---|---|");
const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [type, list] of sorted) {
  const s = summarize(list);
  console.log(`| ${type} | ${s.count} | ~${s.medianPack.toLocaleString()} tokens | ~${s.medianSavedVsRepo.toLocaleString()} tokens |`);
}

console.log("\n## Aggregate\n");
console.log(`- Hook firings: **${real.length}**`);
console.log(`- Total pack tokens generated: ~${totalPack.toLocaleString()}`);
console.log(`- Total avoided vs reading the same selected files in full: ~${totalSavedVsFiles.toLocaleString()} tokens`);
console.log(`- Total avoided vs reading the whole repo each time: **~${totalSavedVsRepo.toLocaleString()} tokens**`);
console.log(`- Approx cost saved at Sonnet 4.5 ($${SONNET_USD_PER_MTOK}/MTok input): **~$${(totalSavedVsRepo * SONNET_USD_PER_MTOK / 1_000_000).toFixed(2)}**`);
console.log(`- Approx cost saved at Opus 4.7 ($${OPUS_USD_PER_MTOK}/MTok input): **~$${(totalSavedVsRepo * OPUS_USD_PER_MTOK / 1_000_000).toFixed(2)}**`);

console.log("\n## Mermaid bar chart\n");
console.log("```mermaid");
console.log("xychart-beta");
console.log("  title \"Median tokens saved per prompt type (vs whole-repo)\"");
const xLabels = sorted.map(([type]) => `"${type.split(" /")[0].split(" (")[0]}"`).join(", ");
const yValues = sorted.map(([, list]) => summarize(list).medianSavedVsRepo);
const yMax = Math.ceil(Math.max(...yValues) * 1.1 / 1000) * 1000;
console.log(`  x-axis [${xLabels}]`);
console.log(`  y-axis "Tokens saved" 0 --> ${yMax.toLocaleString().replace(/,/g, "")}`);
console.log(`  bar [${yValues.join(", ")}]`);
console.log("```");

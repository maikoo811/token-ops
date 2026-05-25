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
//   savings summary in tokens and approximate USD at Claude API list
//   prices. All numbers compare the generated pack against reading
//   the same ranked files in full — the whole-repo "ceiling" metric
//   that some tools report is intentionally omitted because it
//   overstates real savings.

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

// Only `hook` entries represent a real user prompt being auto-augmented.
// `pack` (CLI) and `mcp.*` (Cursor / MCP) entries come from explicit
// invocations and would bias the "did the hook earn its keep" story.
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
  // Catch-all for prompts that don't fit a named category — typically
  // general feedback, observations, or pasted content with no clear
  // intent verb. Named explicitly so readers don't see a bare "Other".
  return "General comments / feedback";
}

const median = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)] || 0;
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

const buckets = new Map();
for (const r of real) {
  const type = classify(r.task);
  if (!buckets.has(type)) buckets.set(type, []);
  buckets.get(type).push(r);
}

const totalPack = sum(real.map((r) => r.budget?.packTokens || 0));
const totalSavedVsFiles = sum(real.map((r) => r.budget?.savedTokens || 0));
const baseline = totalPack + totalSavedVsFiles;

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

console.log("## Aggregate\n");
console.log(`- Hook firings: **${real.length}**`);
console.log(`- Generated packs: ~${totalPack.toLocaleString()} tokens`);
console.log(`- Equivalent full reads of the same ranked files: ~${baseline.toLocaleString()} tokens`);
console.log(`- **Avoided: ~${totalSavedVsFiles.toLocaleString()} tokens**`);
console.log(`- Approx Sonnet 4.5 input cost saved: ~$${(totalSavedVsFiles * SONNET_USD_PER_MTOK / 1_000_000).toFixed(2)}`);
console.log(`- Approx Opus 4.7 input cost saved: ~$${(totalSavedVsFiles * OPUS_USD_PER_MTOK / 1_000_000).toFixed(2)}`);

console.log("\n## By prompt type (median per firing)\n");
console.log("| Prompt type | Median pack | Median saved |");
console.log("|---|---|---|");
// Sort by firing count, descending. "General comments / feedback"
// is a legitimate category alongside the others (not a janitorial
// dump), so it competes on the same count basis.
const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [type, list] of sorted) {
  const medPack = median(list.map((r) => r.budget?.packTokens || 0));
  const medSaved = median(list.map((r) => r.budget?.savedTokens || 0));
  console.log(`| ${type} | ~${medPack.toLocaleString()} tokens | ~${medSaved.toLocaleString()} tokens |`);
}

console.log("\n## Mermaid bar chart\n");
console.log("```mermaid");
console.log("xychart-beta");
console.log("  title \"Median tokens saved per prompt type (vs same files in full)\"");
const xLabels = sorted.map(([type]) => `"${type.split(" /")[0].split(" (")[0]}"`).join(", ");
const yValues = sorted.map(([, list]) => median(list.map((r) => r.budget?.savedTokens || 0)));
const yMax = Math.max(...yValues, 1);
const yAxisMax = Math.ceil(yMax * 1.1 / 1000) * 1000;
console.log(`  x-axis [${xLabels}]`);
console.log(`  y-axis "Tokens saved" 0 --> ${yAxisMax}`);
console.log(`  bar [${yValues.join(", ")}]`);
console.log("```");

console.log("\n## Caveats\n");
console.log("- `saved` here = `(tokens of fully reading the ranked files) − (tokens of the pack)`. Real-world savings are at most this number — Token Ops doesn't prevent the agent from reading more after receiving the pack.");
console.log(`- Per-type medians come from small samples (${Math.min(...sorted.map(([,l])=>l.length))}–${Math.max(...sorted.map(([,l])=>l.length))} firings per category). The aggregate is the more stable number.`);
console.log("- Token counts are estimates: `length / 4` for ASCII, `length / 1.5` for CJK characters.");

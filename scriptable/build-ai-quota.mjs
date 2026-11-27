import { readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const source = read("../scripting/ai-quota/api.ts");

// Share the CPA client and all provider parsing/aggregation, but not Scripting's
// globals, network transport, interactive refresh state or cache policy.
function section(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`Missing shared API section: ${from} → ${to}`);
  return source.slice(start, end).replace(/^export /gm, "").trim();
}

const core = stripTypeScriptTypes([
  section("export const CACHE_TTL_MS", "export function nativeAppURL"),
  section("export function normalizeCpaBaseUrl", "export function cacheScope"),
  section("// ---------- Helpers ----------", "function wait("),
  section("// ---------- CPA ----------", "export function mergeCachedService"),
].join("\n\n"));

const output = [read("./src/header.txt").trimEnd(), core.trimEnd(), read("./src/host.mjs").trimEnd()]
  .join("\n\n").replace(/[ \t]+$/gm, "") + "\n";
const target = new URL("./AI-Quota.js", import.meta.url);
if (process.argv.includes("--check")) {
  if (read("./AI-Quota.js") !== output) throw new Error("AI-Quota.js is stale. Run node scriptable/build-ai-quota.mjs");
} else {
  writeFileSync(target, output);
}

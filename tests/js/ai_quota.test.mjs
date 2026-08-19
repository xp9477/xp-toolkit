import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../scriptable/AI-Quota.js", import.meta.url),
  "utf8"
);
const end = source.indexOf("// ---------- Draw ----------");
assert.ok(end > 0, "AI-Quota core marker not found");

class Color {
  constructor(hex, alpha) {
    this.hex = hex;
    this.alpha = alpha;
  }

  static dynamic(light, dark) {
    return { light, dark };
  }
}

const context = vm.createContext({ Color, console });
vm.runInContext(
  `${source.slice(0, end)}\n` +
    "globalThis.testApi = { hasAnyAuth, normalizeCpaBaseUrl, cacheScope, authIndexOf, " +
    "normalizeUsageWindow, parseChatGPTUsage, parseAntigravity };",
  context
);
const api = context.testApi;

test("configuration requires both CPA address and key", () => {
  assert.equal(
    api.hasAnyAuth({ cpaBaseUrl: "https://cpa.example", cpaApiKey: "key" }),
    true
  );
  assert.equal(api.hasAnyAuth({ cpaBaseUrl: "", cpaApiKey: "key" }), false);
  assert.equal(
    api.hasAnyAuth({ cpaBaseUrl: "https://cpa.example", cpaApiKey: "" }),
    false
  );
});

test("CPA address accepts explicit HTTP and HTTPS endpoints", () => {
  assert.equal(
    api.normalizeCpaBaseUrl("https://cpa.example:50442/"),
    "https://cpa.example:50442"
  );
  assert.equal(api.normalizeCpaBaseUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(api.normalizeCpaBaseUrl("http://192.168.1.20:50442"), "http://192.168.1.20:50442");
  assert.equal(api.normalizeCpaBaseUrl("http://cpa.internal"), "http://cpa.internal");
  assert.throws(() => api.normalizeCpaBaseUrl("https://user@cpa.example"), /纯主机地址/);
  assert.throws(() => api.normalizeCpaBaseUrl("https://cpa.example/path"), /纯主机地址/);
  assert.equal(api.hasAnyAuth({ cpaBaseUrl: "http://cpa.internal", cpaApiKey: "secret" }), true);
});

test("cache scope changes without exposing the raw key", () => {
  const first = api.cacheScope({
    cpaBaseUrl: "https://a.example",
    cpaApiKey: "secret-a",
  });
  const second = api.cacheScope({
    cpaBaseUrl: "https://a.example",
    cpaApiKey: "secret-b",
  });
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /secret/);
});

test("auth index zero is valid", () => {
  assert.equal(api.authIndexOf({ auth_index: 0 }), 0);
  assert.equal(api.authIndexOf({ authIndex: "abc" }), "abc");
  assert.equal(api.authIndexOf({}), null);
});

test("usage windows accept numeric strings", () => {
  const window = api.normalizeUsageWindow({
    used_percent: "25.5",
    limit_window_seconds: "604800",
    reset_at: "2030-01-01T00:00:00Z",
  });
  assert.equal(window.usedPct, 25.5);
  assert.equal(window.remainingPct, 74.5);
  assert.equal(window.label, "本周");
});

test("ChatGPT parser chooses the longest active window", () => {
  const parsed = api.parseChatGPTUsage({
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 10, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 30, limit_window_seconds: 604800 },
    },
  });
  assert.equal(parsed.remainingPct, 70);
  assert.equal(parsed.windowLabel, "本周");
  assert.match(parsed.extra, /5小时剩 90%/);
});

test("Google parser rejects responses without quota buckets", () => {
  assert.throws(
    () => api.parseAntigravity({ groups: [] }),
    /无法解析 Google 额度/
  );
});

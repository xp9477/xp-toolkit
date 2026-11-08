import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../../scripting/ai-quota/api.ts";

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

test("CPA matcher keeps every enabled account of a provider", () => {
  const files = [
    { provider: "antigravity", name: "a.json", auth_index: 1, disabled: true },
    { provider: "antigravity", name: "b.json", auth_index: 2 },
    { provider: "gemini", name: "c.json", authIndex: 3 },
    { provider: "antigravity", name: "dup.json", auth_index: 2 },
    { provider: "codex", name: "one.json", auth_index: 4 },
    { provider: "openai", name: "two.json", auth_index: 5 },
    { provider: "xai", name: "grok.json", auth_index: 9 },
  ];
  const gemini = api.findCpaFiles(files, [/antigravity/, /gemini/]);
  assert.equal(gemini.length, 2);
  assert.equal(api.authIndexOf(gemini[0]), 2);
  assert.equal(api.authIndexOf(gemini[1]), 3);
  const codex = api.findCpaFiles(files, [/openai/, /chatgpt/, /codex/]);
  assert.equal(codex.length, 2);
  assert.equal(api.authIndexOf(codex[0]), 4);
  assert.equal(api.authIndexOf(codex[1]), 5);
});

test("remaining percent averages across accounts without counting them", () => {
  const two = api.averageServices([
    { ok: true, remainingPct: 80, resetHint: "3天后", extra: "5小时剩 90%" },
    { ok: true, remainingPct: 20, resetHint: "1天后", extra: "5小时剩 10%" },
  ]);
  assert.equal(two.remainingPct, 50);
  assert.equal(two.usedPct, 50);
  assert.equal(two.extra, "5小时剩 10%");
  assert.equal(two.resetHint, "1天后");

  const three = api.averageServices([
    { ok: true, remainingPct: 90, extra: "" },
    { ok: true, remainingPct: 60, extra: "" },
    { ok: true, remainingPct: 30, extra: "" },
  ]);
  assert.equal(three.remainingPct, 60);
  assert.equal(three.extra, "");

  const partial = api.averageServices([{ ok: true, remainingPct: 40, extra: "" }, null, { ok: false }]);
  assert.equal(partial.remainingPct, 40);
  assert.equal(partial.extra, "");

  const single = api.averageServices([{ ok: true, remainingPct: 77, resetHint: "2天后", extra: "" }]);
  assert.equal(single.remainingPct, 77);
  assert.equal(single.extra, "");
});

function installHost(entries = {}) {
  const box = { ...entries };
  globalThis.Storage = {
    get(key) {
      return Object.prototype.hasOwnProperty.call(box, key) ? box[key] : null;
    },
    set(key, value) {
      box[key] = value;
      return true;
    },
    remove(key) {
      delete box[key];
    },
  };
  globalThis.Keychain = { get() { return null; }, set() {} };
  globalThis.Widget = { parameter: "" };
  return box;
}

test("refresh flag expires so a crashed reload cannot stick", () => {
  installHost();
  assert.equal(api.isRefreshing(), false);
  api.setRefreshing(true);
  assert.equal(api.isRefreshing(), true);
  api.setRefreshing(false);
  assert.equal(api.isRefreshing(), false);
  assert.equal(api.isRefreshing(Date.now()), false);

  const started = Date.now() - api.REFRESHING_TTL_MS - 1000;
  installHost({ [api.REFRESHING_KEY]: started });
  assert.equal(api.isRefreshing(), false);
  assert.equal(api.isRefreshing(started + 1000), true);
});

test("cached quota can be shown without a network fetch, even after the TTL", () => {
  const cfg = { cpaBaseUrl: "https://cpa.example", cpaApiKey: "secret" };
  const fetchedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  installHost({
    [api.KEY.cpaBase]: cfg.cpaBaseUrl,
    [api.KEY.cpaKey]: cfg.cpaApiKey,
    [api.CACHE_KEY]: {
      scope: api.cacheScope(cfg),
      savedAt: fetchedAt,
      data: {
        fetchedAt,
        chatgpt: { remainingPct: 50 },
        gemini: { remainingPct: 60 },
      },
    },
  });
  const cached = api.readCachedQuota();
  assert.equal(cached.isCached, true);
  assert.equal(cached.fetchedAt, fetchedAt);
  assert.equal(cached.chatgpt.remainingPct, 50);
  assert.equal(cached.gemini.remainingPct, 60);

  installHost({
    [api.KEY.cpaBase]: cfg.cpaBaseUrl,
    [api.KEY.cpaKey]: cfg.cpaApiKey,
    [api.CACHE_KEY]: {
      scope: "other",
      savedAt: fetchedAt,
      data: { fetchedAt, chatgpt: {}, gemini: {} },
    },
  });
  assert.equal(api.readCachedQuota(), null);
});

test("service tap URLs directly target native app schemes", () => {
  assert.equal(api.serviceTapURL("chatgpt"), "com.openai.chat://");
  assert.equal(api.serviceTapURL("gemini"), "googlegemini://");
  assert.equal(api.serviceTapURL("unknown"), "com.openai.chat://");
});

test("reset hint chooses the earliest/fastest refreshing account", () => {
  const now = Date.now();
  const res = api.averageServices([
    { ok: true, remainingPct: 15, resetAt: now + 500000000, resetHint: "5天后", extra: "5小时剩 0%" },
    { ok: true, remainingPct: 85, resetAt: now + 3600000, resetHint: "1小时后", extra: "" },
    { ok: true, remainingPct: 50, resetAt: now + 86400000, resetHint: "1天后", extra: "" },
  ]);
  assert.equal(res.remainingPct, 50);
  assert.equal(res.usedPct, 50);
  assert.equal(res.resetHint, "1小时后");
  assert.equal(res.resetAt, now + 3600000);
});

test("ChatGPT parser extracts 5-hour window information", () => {
  const parsed = api.parseChatGPTUsage({
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: "2030-01-01T05:00:00Z" },
      secondary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: "2030-01-07T00:00:00Z" },
    },
  });
  assert.equal(parsed.remainingPct, 60);
  assert.equal(parsed.remaining5hPct, 80);
  assert.ok(parsed.reset5hHint);
});

test("Google parser extracts 5-hour bucket information", () => {
  const parsed = api.parseAntigravity({
    groups: [
      {
        displayName: "Gemini Models",
        buckets: [
          { bucketId: "gemini-weekly", displayName: "Weekly Limit Remaining", remainingFraction: 0.9, resetTime: "2030-01-07T00:00:00Z" },
          { bucketId: "gemini-5h", displayName: "Five Hour Limit Remaining", remainingFraction: 0.85, resetTime: "2030-01-01T04:00:00Z" }
        ]
      }
    ]
  });
  assert.equal(parsed.remainingPct, 90);
  assert.equal(parsed.remaining5hPct, 85);
  assert.ok(parsed.reset5hHint);
});

test("averageServices computes 5-hour averages and earliest 5h cooldown", () => {
  const now = Date.now();
  const res = api.averageServices([
    { ok: true, remainingPct: 80, resetAt: now + 500000, resetHint: "5天后", remaining5hPct: 70, reset5hAt: now + 7200000, reset5hHint: "2小时后" },
    { ok: true, remainingPct: 60, resetAt: now + 300000, resetHint: "3天后", remaining5hPct: 90, reset5hAt: now + 3600000, reset5hHint: "1小时后" },
  ]);
  assert.equal(res.remainingPct, 70);
  assert.equal(res.remaining5hPct, 80);
  assert.equal(res.reset5hHint, "1小时后");
});

test("Google parser uses the Gemini group and ignores a full Claude/GPT group", () => {
  const parsed = api.parseAntigravity({
    groups: [
      {
        displayName: "Gemini Models",
        buckets: [
          { bucketId: "gemini-weekly", window: "weekly", displayName: "Weekly Limit Remaining", remainingFraction: 0.198, resetTime: "2030-01-07T00:00:00Z" },
          { bucketId: "gemini-5h", window: "5h", displayName: "Five Hour Limit Remaining", remainingFraction: 0.98, resetTime: "2030-01-01T04:00:00Z" }
        ]
      },
      {
        displayName: "Claude and GPT models",
        buckets: [
          { bucketId: "3p-weekly", window: "weekly", displayName: "Weekly Limit Remaining", remainingFraction: 1, resetTime: "2030-01-07T00:00:00Z" },
          { bucketId: "3p-5h", window: "5h", displayName: "Five Hour Limit Remaining", remainingFraction: 1, resetTime: "2030-01-01T04:00:00Z" }
        ]
      }
    ]
  });
  assert.equal(parsed.remainingPct, 19.8);
  assert.equal(parsed.remaining5hPct, 98);
});

test("Google parser rejects a Claude-only summary instead of showing 100%", () => {
  assert.throws(
    () => api.parseAntigravity({
      groups: [
        {
          displayName: "Claude and GPT models",
          buckets: [
            { bucketId: "3p-weekly", window: "weekly", displayName: "Weekly Limit Remaining", remainingFraction: 1 },
            { bucketId: "3p-5h", window: "5h", displayName: "Five Hour Limit Remaining", remainingFraction: 1 }
          ]
        }
      ]
    }),
    /没有 Gemini 额度/
  );
});

test("unconfigured quota contains only ChatGPT and Gemini", async () => {
  installHost();
  const data = await api.fetchQuotaData();
  assert.equal(data.chatgpt.ok, false);
  assert.equal(data.gemini.ok, false);
  assert.equal("grok" in data, false);
  assert.deepEqual(Object.keys(api.URLS), ["chatgpt", "gemini"]);
});

test("legacy cache retains supported quotas without Grok or its warnings", async (t) => {
  const cfg = { cpaBaseUrl: "https://cpa.example", cpaApiKey: "secret" };
  const fetchedAt = new Date().toISOString();
  const legacyData = {
    fetchedAt,
    grok: { remainingPct: 40 },
    chatgpt: { remainingPct: 50, ok: true },
    gemini: { remainingPct: 60, ok: true },
    errors: ["SuperGrok: CPA 未找到 Grok 认证", "Grok: 登录已过期", "Gemini: 登录已过期"],
  };
  const box = installHost({
    [api.KEY.cpaBase]: cfg.cpaBaseUrl,
    [api.KEY.cpaKey]: cfg.cpaApiKey,
    [api.CACHE_KEY]: { scope: api.cacheScope(cfg), savedAt: fetchedAt, data: legacyData },
  });
  t.mock.method(globalThis, "fetch", () => {
    assert.fail("reading a fresh cache must not fetch the network");
  });
  for (const data of [api.readCachedQuota(), await api.fetchQuotaData()]) {
    assert.equal(data.isCached, true);
    assert.equal(data.chatgpt.remainingPct, 50);
    assert.equal(data.gemini.remainingPct, 60);
    assert.equal("grok" in data, false);
    assert.deepEqual(data.errors, ["Gemini: 登录已过期"]);
  }
  box[api.CACHE_KEY] = JSON.stringify({ scope: api.cacheScope(cfg), savedAt: fetchedAt, data: legacyData });
  assert.equal("grok" in api.readCachedQuota(), false);
});

test("forced refresh requests and caches only ChatGPT and Gemini even with xAI auth", async (t) => {
  const cfg = { cpaBaseUrl: "https://cpa.example", cpaApiKey: "secret" };
  const box = installHost({ [api.KEY.cpaBase]: cfg.cpaBaseUrl, [api.KEY.cpaKey]: cfg.cpaApiKey });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/auth-files")) {
      return Response.json({ files: [
        { provider: "xai", name: "grok.json", auth_index: 9 },
        { provider: "codex", name: "chatgpt.json", auth_index: 1 },
        { provider: "antigravity", name: "gemini.json", auth_index: 2 },
      ] });
    }
    assert.equal(url, `${cfg.cpaBaseUrl}/v0/management/api-call`);
    const request = JSON.parse(options.body);
    calls.push(request);
    const responses = {
      "https://chatgpt.com/backend-api/wham/usage": {
        plan_type: "plus",
        rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 604800 } },
      },
      "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary": {
        groups: [{ displayName: "Gemini Models", buckets: [
          { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.6 },
        ] }],
      },
    };
    assert.ok(Object.hasOwn(responses, request.url), `unexpected provider request: ${request.url}`);
    return Response.json({ status_code: 200, body: responses[request.url] });
  });
  const data = await api.fetchQuotaData(true);
  assert.equal(data.chatgpt.remainingPct, 70);
  assert.equal(data.gemini.remainingPct, 60);
  assert.deepEqual(data.errors, []);
  assert.deepEqual(calls.map((call) => call.auth_index).sort(), ["1", "2"]);
  assert.equal("grok" in data, false);
  assert.equal("grok" in box[api.CACHE_KEY].data, false);
});

test("missing supported credentials never adds a Grok warning", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ files: [] }));
  const data = await api.fetchAll({ cpaBaseUrl: "https://cpa.example", cpaApiKey: "secret" });
  assert.equal(data.errors.length, 2);
  assert.ok(data.errors.every((error) => /^(ChatGPT|Gemini):/.test(error)));
  assert.equal("grok" in data, false);
});

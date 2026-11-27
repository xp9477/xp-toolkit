import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const code = readFileSync(new URL("../../scriptable/AI-Quota.js", import.meta.url), "utf8");
const appScript = new vm.Script(`(async () => {\n${code}\n})()`);
const CONFIG_KEY = "xp-toolkit.ai-quota.scriptable.config.v1";
const REFRESH = "refresh-quota";
const key = "fixture-admin-secret";
const scope = "12345678-0000-4000-8000-123456789abc";
const base = "https://cpa.example";
const expires = 4102444800;

function fixture() {
  const account = (name, provider, auth_index) => ({ name, provider, auth_index });
  return {
    files: [account("xai-ignore", "xai", 1), account("gpt-1", "codex", 2),
      account("gpt-2", "codex", 3), account("google", "antigravity", 4)],
    quota: {
      2: { plan_type: "plus", rate_limit: {
        primary_window: { used_percent: 30, limit_window_seconds: 18000, reset_at: expires },
        secondary_window: { used_percent: 60, limit_window_seconds: 604800, reset_at: expires },
      } },
      3: { plan_type: "plus", rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: expires },
        secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: expires },
      } },
      4: { groups: [
        { displayName: "Claude and GPT models", buckets: [{ bucketId: "3p-weekly", remainingFraction: 1 }] },
        { displayName: "Gemini", buckets: [
          { bucketId: "gemini-weekly", remainingFraction: 0.92 },
          { bucketId: "gemini-5h", remainingFraction: 0.8 },
        ] },
      ] },
    },
  };
}

function host({ configured = true, actionSupport = true, buttonSupport = true } = {}) {
  const credentials = new Map();
  const files = new Map();
  const requests = [];
  const dialogs = [];
  const queue = [];
  const samples = fixture();
  let networkMode = "ok";
  let displayed;
  let completed;
  if (configured) credentials.set(CONFIG_KEY, JSON.stringify({ scope, cpaBaseUrl: base, cpaApiKey: key }));

  class Stack {
    constructor() { this.children = []; }
    addStack() { const stack = new Stack(); this.children.push(stack); return stack; }
    addText(value) {
      assert.equal(typeof value, "string");
      const node = { value, rightAlignText() {} };
      this.children.push(node);
      return node;
    }
    addDate(date) {
      assert.ok(Number.isFinite(date.getTime()));
      const node = { date, applyRelativeStyle() { this.style = "relative"; }, applyTimeStyle() { this.style = "clock"; } };
      this.children.push(node);
      return node;
    }
    addProgress(value, options) {
      const node = this.addStack();
      node.progress = { value, ...options };
      return node;
    }
    addSpacer() {}
    centerAlignContent() {}
    topAlignContent() {}
    layoutVertically() {}
    setPadding() {}
  }
  if (actionSupport) Stack.prototype.setAction = function (title, options) { this.control = { title, ...options }; };
  if (buttonSupport) Stack.prototype.addButton = Stack.prototype.setAction || function (title, options) { this.control = { title, ...options }; };

  class Request {
    constructor(url) { this.url = url; }
    async loadString() {
      requests.push(this);
      if (networkMode === "offline") throw new Error("error with private request details");
      if (networkMode === "redirect") {
        assert.equal(this.onRedirect({ url: "https://other.example" }), null);
        this.response = { statusCode: 302 };
        return "redirect response";
      }
      this.response = { statusCode: 200 };
      if (this.url.endsWith("/auth-files")) return JSON.stringify({ files: samples.files });
      const body = JSON.parse(this.body);
      if (networkMode === "failGPT" && ["2", "3"].includes(body.authIndex)) {
        return JSON.stringify({ status_code: 403, body: { error: `untrusted upstream content: ${key}` } });
      }
      return JSON.stringify({ status_code: 200, body: JSON.stringify(samples.quota[body.authIndex]) });
    }
  }

  class Alert {
    fields = [];
    addTextField(_, value) { this.fields.push({ value }); }
    addSecureTextField() { this.fields.push({ secure: true }); }
    addAction() {}
    addCancelAction() {}
    addDestructiveAction() {}
    textFieldValue(index) { return this.input[index]; }
    async presentAlert() {
      dialogs.push(this);
      const { action = -1, input = [] } = queue.shift() ?? {};
      this.input = input;
      return action;
    }
  }

  class ListWidget extends Stack {
    async presentSmall() { displayed = this; }
    async presentMedium() { displayed = this; }
    async presentLarge() { displayed = this; }
  }
  const storage = {
    libraryDirectory: () => "/library",
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (path) => files.has(path),
    readString: (path) => files.get(path),
    writeString: (path, value) => files.set(path, value),
    remove: (path) => files.delete(path),
  };
  const globals = {
    Alert, Request, ListWidget,
    UUID: { string: () => "22222222-0000-4000-8000-123456789abc" },
    FileManager: { local: () => storage },
    Keychain: { contains: credentials.has.bind(credentials), get: credentials.get.bind(credentials),
      set: credentials.set.bind(credentials), remove: credentials.delete.bind(credentials) },
    Script: { setWidget: (w) => { displayed = w; }, complete: () => { completed++; } },
    URLScheme: { forRunningScript: () => "scriptable:///run/AI-Quota" },
    Size: class { constructor(width, height) { Object.assign(this, { width, height }); } },
    Color: class { static dynamic(light, dark) { return { light, dark }; } },
    Font: { systemFont: (size) => size, boldSystemFont: (size) => size },
  };
  return { credentials, files, requests, dialogs, queue, samples,
    mode: (mode) => { networkMode = mode; },
    snapshot: () => JSON.parse([...files.values()].at(-1)),
    async run({ family = "medium", widgetAction = null, widgetParameter = "", app = false } = {}) {
      completed = 0;
      displayed = null;
      await appScript.runInNewContext({ ...globals, args: { widgetAction, widgetParameter },
        config: { runsInWidget: !app, runsInApp: app, widgetFamily: family } });
      assert.equal(completed, 1);
      return displayed;
    },
  };
}

function walk(node) {
  return [node, ...(node.children ?? []).flatMap(walk)];
}
function labels(node) {
  return walk(node).map((element) => element.value).filter(Boolean).join(" | ");
}

test("single-file Scriptable delivery fetches CPA quota and averages accounts", async () => {
  const h = host();
  const widget = await h.run();
  const snapshot = h.snapshot();
  assert.equal(snapshot.state, "已更新");
  assert.deepEqual(Object.keys(snapshot.services), ["chatgpt", "gemini"]);
  assert.equal(snapshot.services.chatgpt.accountCount, 2);
  assert.equal(snapshot.services.chatgpt.remainingPct, 60);
  assert.equal(snapshot.services.chatgpt.remaining5hPct, 80);
  assert.equal(snapshot.services.gemini.remainingPct, 92);
  assert.equal(snapshot.services.gemini.remaining5hPct, 80);
  assert.equal(h.requests.length, 4);
  for (const request of h.requests) {
    assert.ok(request.url.startsWith(`${base}/v0/management/`));
    assert.equal(request.headers.Authorization, `Bearer ${key}`);
    assert.equal(request.timeoutInterval, 8);
    assert.equal(request.onRedirect({ url: "https://elsewhere.example" }), null);
  }
  for (const request of h.requests.slice(1)) {
    assert.equal(request.method, "POST");
    const body = JSON.parse(request.body);
    assert.equal(typeof body.authIndex, "string");
    assert.equal(body.authIndex, body.auth_index);
    assert.notEqual(body.authIndex, "1");
    assert.equal(body.header.Authorization, "Bearer $TOKEN$");
    if (body.authIndex === "4") assert.equal(body.header["User-Agent"], "antigravity/hub/2.23.0 darwin/arm64");
  }
  assert.ok(walk(widget).some((node) => node.control?.id === REFRESH));
  assert.ok(walk(widget).some((node) => node.progress?.value === 60));
  assert.ok(walk(widget).some((node) => node.style === "relative"));
  assert.ok(![...h.files.values()][0].includes(key));
  assert.ok(widget.refreshAfterDate.getTime() > Date.now());
});

test("an action bypasses TTL and only failed providers retain old timestamps", async () => {
  const h = host();
  await h.run();
  const initial = h.snapshot();
  await h.run();
  assert.equal(h.requests.length, 4);
  h.mode("failGPT");
  h.samples.quota[4].groups[1].buckets[0].remainingFraction = 0.85;
  assert.equal(await h.run({ widgetAction: { id: REFRESH } }), null);
  assert.equal(h.requests.length, 8);
  const mixed = h.snapshot();
  assert.equal(mixed.state, "部分更新");
  assert.equal(mixed.services.gemini.remainingPct, 85);
  assert.equal(mixed.services.chatgpt.remainingPct, 60);
  assert.equal(mixed.services.chatgpt.at, initial.services.chatgpt.at);
  assert.equal(mixed.services.chatgpt.stale, true);
  assert.ok(![...h.files.values()][0].includes(key));
  assert.match(labels(await h.run()), /ChatGPT · 缓存/);
  assert.equal(h.requests.length, 8);
  h.mode("offline");
  await h.run({ widgetAction: { id: REFRESH } });
  assert.equal(h.snapshot().state, "缓存");
  assert.equal(h.snapshot().services.gemini.at, mixed.services.gemini.at);
  assert.equal(h.snapshot().services.gemini.stale, true);
  assert.match(labels(await h.run()), /连接失败或超时/);
  assert.equal(h.requests.length, 9);
});

test("a new credential scope cannot display the previous account's cached percentages", async () => {
  const h = host();
  await h.run();
  const cfg = JSON.parse(h.credentials.get(CONFIG_KEY));
  cfg.scope = "d2345678-0000-4000-8000-123456789abc";
  h.credentials.set(CONFIG_KEY, JSON.stringify(cfg));
  h.mode("redirect");
  const rendered = labels(await h.run());
  assert.match(rendered, /发生重定向/);
  assert.match(rendered, /暂不可用/);
  assert.doesNotMatch(rendered, /70%|60%|92%/);
  assert.equal(h.requests.length, 5);
  assert.equal(h.snapshot().freshCount, 0);
});

test("lock screen is display only; circular family defaults to the lowest quota", async () => {
  const h = host();
  for (const family of ["accessoryInline", "accessoryRectangular", "accessoryCircular"]) {
    const widget = await h.run({ family });
    assert.ok(walk(widget).every((node) => !node.control && !node.url));
    assert.match(labels(widget), /(?:GPT|60%)/);
  }
  const circular = await h.run({ family: "accessoryCircular", widgetParameter: "gemini" });
  assert.match(labels(circular), /92%/);
  assert.ok(walk(circular).some((node) => node.progress?.style === "circular"));
  assert.equal(h.requests.length, 4);
});

test("large families render account names; small keeps a compact clock", async () => {
  const h = host();
  for (const family of ["large", "extraLarge", "extraLargePortrait"]) {
    const widget = await h.run({ family });
    assert.match(labels(widget), /账号明细.*gpt-1.*google.*gpt-2/);
  }
  const small = await h.run({ family: "small" });
  assert.ok(walk(small).some((node) => node.style === "clock"));
  assert.doesNotMatch(labels(small), /gpt-1/);
});

test("older hosts fall back to a button, then the app link", async () => {
  const button = await host({ actionSupport: false }).run();
  assert.ok(walk(button).some((node) => node.control?.id === REFRESH));
  const link = await host({ actionSupport: false, buttonSupport: false }).run();
  assert.equal(link.url, "scriptable:///run/AI-Quota");
});

test("App setup stores secrets in Keychain; widget parameters cannot supply an origin or key", async () => {
  const h = host({ configured: false });
  const missing = await h.run({ widgetParameter: JSON.stringify({ cpaBaseUrl: base, cpaApiKey: key }) });
  assert.match(labels(missing), /未配置/);
  assert.equal(h.requests.length, 0);
  h.queue.push({ action: 0, input: [`${base}/`, key] });
  await h.run({ app: true });
  const cfg = JSON.parse(h.credentials.get(CONFIG_KEY));
  assert.equal(cfg.cpaBaseUrl, base);
  assert.equal(cfg.cpaApiKey, key);
  assert.equal(h.dialogs[0].fields[1].secure, true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.files.size, 0);
  h.queue.push({ action: 4 }, { action: 0, input: ["https://new.example", ""] });
  await h.run({ app: true });
  assert.equal(JSON.parse(h.credentials.get(CONFIG_KEY)).cpaBaseUrl, base);
  await h.run();
  h.queue.push({ action: 5 }, { action: 0 });
  await h.run({ app: true });
  assert.equal(h.credentials.size, 0);
  assert.equal(h.files.size, 0);
});

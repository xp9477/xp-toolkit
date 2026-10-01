import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const scriptSource = readFileSync(
  new URL("../../proxy/loon/script/yanxuan-cookie-capture.js", import.meta.url),
  "utf8"
);

const pluginSource = readFileSync(
  new URL("../../proxy/loon/plugin/yanxuan-cookie-capture.plugin", import.meta.url),
  "utf8"
);

function runScript({
  url = "https://act.you.163.com/act-attendance/att/v4/index",
  headers = {},
  persistentStoreData = {},
  writeResult = true,
  omitPersistentStore = false,
  brokenStoreWrite = false,
  throwInHeader = false,
} = {}) {
  let doneArg = null;
  let doneCallCount = 0;
  const storeWrites = [];
  const notifications = [];
  const logs = [];

  let requestHeaders = headers;
  if (throwInHeader) {
    requestHeaders = {
      get Cookie() {
        throw new Error("Sensitive error detail with yx_csrf=leaked_secret");
      },
    };
  }

  const storeObj = omitPersistentStore
    ? undefined
    : {
        write: brokenStoreWrite
          ? null
          : function (value, key) {
              storeWrites.push({ key, value });
              if (writeResult) {
                persistentStoreData[key] = value;
                return true;
              }
              return false;
            },
        read: function (key) {
          return persistentStoreData[key] || null;
        },
      };

  const context = vm.createContext({
    $request: {
      url,
      headers: requestHeaders,
    },
    $persistentStore: storeObj,
    $notification: {
      post(title, subtitle, content, opts) {
        notifications.push({ title, subtitle, content, opts });
      },
    },
    $done(arg) {
      doneCallCount++;
      doneArg = arg;
    },
    $httpClient: {
      get() {
        throw new Error("Unexpected network call via $httpClient.get");
      },
      post() {
        throw new Error("Unexpected network call via $httpClient.post");
      },
    },
    fetch() {
      throw new Error("Unexpected network call via fetch");
    },
    console: {
      log(...args) {
        logs.push(args.join(" "));
      },
      error(...args) {
        logs.push(args.join(" "));
      },
    },
    URL,
  });

  vm.runInContext(scriptSource, context);

  return {
    doneArg,
    doneCallCount,
    storeWrites,
    notifications,
    logs,
  };
}

test("Loon plugin defines valid v2 script rule and MITM host", () => {
  assert.match(
    pluginSource,
    /\[Script\]/,
    "plugin must define [Script] section"
  );
  assert.match(
    pluginSource,
    /request if \$\{url\} ~= \/\^https:\\\/\\\/act\\\.you\\\.163\\\.com\\\/act-attendance\\\/\(\?:task\\\/list\|att\\\/v4\\\/index\|att\\\/v3\\\/sign\)\(\?:\[\?#\]\|\$\)\/ then script\(/,
    "plugin must use v2 syntax targeting the 3 attendance paths"
  );
  assert.match(
    pluginSource,
    /\[MITM\]\s*\n\s*hostname\s*=\s*act\.you\.163\.com/,
    "plugin must specify MITM hostname act.you.163.com"
  );
});

test("Script accepts all 3 target paths on act.you.163.com and finishes with single $done({})", () => {
  const targetPaths = [
    "/act-attendance/task/list",
    "/act-attendance/att/v4/index",
    "/act-attendance/att/v3/sign",
  ];

  for (const path of targetPaths) {
    const url = `https://act.you.163.com${path}?timestamp=1700000000`;
    const res = runScript({
      url,
      headers: {
        Cookie: "yx_csrf=mock_csrf_val; yx_sid=mock_sid_val",
      },
    });

    assert.equal(res.doneCallCount, 1, "$done must be called exactly once");
    assert.equal(JSON.stringify(res.doneArg), "{}", "must finish with unmodified $done({})");
    assert.equal(res.storeWrites.length, 1, `should capture on ${path}`);
    assert.equal(res.storeWrites[0].key, "yanxuan_daily_sign");
    const parsed = JSON.parse(res.storeWrites[0].value);
    assert.match(parsed.cookie, /yx_csrf=mock_csrf_val/);
    assert.match(parsed.cookie, /yx_sid=mock_sid_val/);
  }
});

test("Script rejects non-target hosts, invalid ports, userinfo, and fragments", () => {
  const invalidUrls = [
    "https://example.com/act-attendance/task/list",
    "https://act.you.163.com.attacker.com/act-attendance/att/v4/index",
    "https://attacker.com/act-attendance/att/v3/sign?orig=https://act.you.163.com",
    "http://act.you.163.com/act-attendance/att/v4/index",
    "https://you.163.com/act-attendance/task/list",
    "https://user:pass@act.you.163.com/act-attendance/task/list",
    "https://act.you.163.com:8443/act-attendance/att/v4/index",
    "https://act.you.163.com/act-attendance/att/v3/sign#fragment",
  ];

  for (const url of invalidUrls) {
    const res = runScript({
      url,
      headers: {
        Cookie: "yx_csrf=secret_csrf; yx_sid=secret_sid",
      },
    });

    assert.equal(res.doneCallCount, 1, "$done must be called exactly once");
    assert.equal(JSON.stringify(res.doneArg), "{}");
    assert.equal(res.storeWrites.length, 0, `must not write store for ${url}`);
    assert.equal(res.notifications.length, 0, `must not notify for ${url}`);
  }
});

test("Script rejects unauthorized paths on act.you.163.com", () => {
  const invalidPaths = [
    "https://act.you.163.com/act-attendance/att/v2/index",
    "https://act.you.163.com/act-attendance/other",
    "https://act.you.163.com/xhr/login",
    "https://act.you.163.com/",
  ];

  for (const url of invalidPaths) {
    const res = runScript({
      url,
      headers: {
        Cookie: "yx_csrf=secret_csrf; yx_sid=secret_sid",
      },
    });

    assert.equal(res.doneCallCount, 1, "$done must be called exactly once");
    assert.equal(JSON.stringify(res.doneArg), "{}");
    assert.equal(res.storeWrites.length, 0, `must not write store for ${url}`);
    assert.equal(res.notifications.length, 0, `must not notify for ${url}`);
  }
});

test("Script filters strictly to 4 allowed Cookie keys and drops everything else", () => {
  const rawCookie = [
    "SESSION_ID=drop_me_sensitive_1",
    "yx_csrf=allowed_csrf_123",
    "tracking_id=drop_me_tracker",
    "yx_new_sid=allowed_new_sid_456",
    "password=drop_me_pass",
    "NTES_YD_SESS=allowed_sess_789",
    "yx_sid=allowed_sid_abc",
    "unrelated=drop_me_val",
  ].join("; ");

  const res = runScript({
    headers: {
      Cookie: rawCookie,
      "User-Agent": "YanXuanApp/9.7.6",
    },
  });

  assert.equal(res.storeWrites.length, 1);
  const payload = JSON.parse(res.storeWrites[0].value);

  // Allowed keys must be present
  assert.match(payload.cookie, /yx_csrf=allowed_csrf_123/);
  assert.match(payload.cookie, /yx_new_sid=allowed_new_sid_456/);
  assert.match(payload.cookie, /NTES_YD_SESS=allowed_sess_789/);
  assert.match(payload.cookie, /yx_sid=allowed_sid_abc/);

  // Forbidden keys must be excluded
  assert.doesNotMatch(payload.cookie, /SESSION_ID/);
  assert.doesNotMatch(payload.cookie, /tracking_id/);
  assert.doesNotMatch(payload.cookie, /password/);
  assert.doesNotMatch(payload.cookie, /unrelated/);

  // UA should be saved
  assert.equal(payload.ua, "YanXuanApp/9.7.6");
});

test("Script requires both yx_csrf and at least one session cookie", () => {
  // Case 1: only yx_csrf, no session cookie
  const res1 = runScript({
    headers: {
      Cookie: "yx_csrf=csrf_only",
    },
  });
  assert.equal(res1.storeWrites.length, 0, "missing session cookie must not save");
  assert.equal(res1.notifications.length, 0);

  // Case 2: session cookie only, no yx_csrf
  const res2 = runScript({
    headers: {
      Cookie: "yx_sid=sid_only",
    },
  });
  assert.equal(res2.storeWrites.length, 0, "missing yx_csrf must not save");
  assert.equal(res2.notifications.length, 0);

  // Case 3: empty cookie header
  const res3 = runScript({
    headers: {},
  });
  assert.equal(res3.storeWrites.length, 0);
  assert.equal(res3.notifications.length, 0);
});

test("Fail-Closed: Script does not notify if $persistentStore is missing or write unavailable", () => {
  const cookie = "yx_csrf=mock_csrf; yx_sid=mock_sid";

  // Case 1: $persistentStore undefined
  const res1 = runScript({
    headers: { Cookie: cookie },
    omitPersistentStore: true,
  });
  assert.equal(res1.doneCallCount, 1);
  assert.equal(res1.notifications.length, 0, "missing persistent store must fail-closed");

  // Case 2: $persistentStore.write is not a function
  const res2 = runScript({
    headers: { Cookie: cookie },
    brokenStoreWrite: true,
  });
  assert.equal(res2.doneCallCount, 1);
  assert.equal(res2.notifications.length, 0, "non-function write must fail-closed");

  // Case 3: write returns false
  const res3 = runScript({
    headers: { Cookie: cookie },
    writeResult: false,
  });
  assert.equal(res3.doneCallCount, 1);
  assert.equal(res3.notifications.length, 0, "failed write must not trigger success notification");
});

test("Script deduplicates identical payload without sending repeated notifications", () => {
  const cookie = "yx_csrf=mock_csrf; yx_sid=mock_sid";
  const expectedPayload = JSON.stringify({ cookie: "yx_csrf=mock_csrf; yx_sid=mock_sid" });

  const res = runScript({
    headers: { Cookie: cookie },
    persistentStoreData: {
      yanxuan_daily_sign: expectedPayload,
    },
  });

  assert.equal(res.doneCallCount, 1);
  assert.equal(res.storeWrites.length, 0, "must not re-write identical payload");
  assert.equal(res.notifications.length, 0, "must not notify for identical payload");
});

test("Notification text matches requirement and does not leak secrets, clipboard attached", () => {
  const secretCsrf = "sensitive_csrf_value_999";
  const secretSid = "sensitive_sid_value_888";

  const res = runScript({
    headers: {
      Cookie: `yx_csrf=${secretCsrf}; yx_sid=${secretSid}`,
    },
  });

  assert.equal(res.notifications.length, 1);
  const notification = res.notifications[0];

  assert.equal(
    notification.content,
    "点击本通知复制所需配置，然后到青龙新增 yanxuan_daily_sign 环境变量"
  );

  // Title, subtitle, content must NEVER leak the secret cookies
  assert.doesNotMatch(notification.title, new RegExp(secretCsrf));
  assert.doesNotMatch(notification.title, new RegExp(secretSid));
  assert.doesNotMatch(notification.subtitle, new RegExp(secretCsrf));
  assert.doesNotMatch(notification.subtitle, new RegExp(secretSid));
  assert.doesNotMatch(notification.content, new RegExp(secretCsrf));
  assert.doesNotMatch(notification.content, new RegExp(secretSid));

  // Clipboard is attached on notification opts for tap-to-copy
  assert.ok(notification.opts && typeof notification.opts.clipboard === "string");
  const clipboardPayload = JSON.parse(notification.opts.clipboard);
  assert.match(clipboardPayload.cookie, new RegExp(secretCsrf));
  assert.match(clipboardPayload.cookie, new RegExp(secretSid));

  // Logs must not leak secrets
  for (const logLine of res.logs) {
    assert.doesNotMatch(logLine, new RegExp(secretCsrf));
    assert.doesNotMatch(logLine, new RegExp(secretSid));
  }
});

test("Catch block logs fixed message without err.message or credentials", () => {
  const res = runScript({
    throwInHeader: true,
  });

  assert.equal(res.doneCallCount, 1, "$done called once despite exception");
  assert.equal(JSON.stringify(res.doneArg), "{}");
  assert.equal(res.storeWrites.length, 0);
  assert.equal(res.notifications.length, 0);
  assert.equal(res.logs.length, 1);
  assert.equal(res.logs[0], "[YanXuan Capture] 处理异常已拦截");
  assert.doesNotMatch(res.logs[0], /leaked_secret/);
});

test("Script ignores malformed cookie values with control characters or oversized length", () => {
  const overflowVal = "a".repeat(600);
  const newlineVal = "val\r\ninjection";

  const res = runScript({
    headers: {
      Cookie: `yx_csrf=valid_csrf; yx_sid=${overflowVal}; yx_new_sid=${newlineVal}; NTES_YD_SESS=valid_sess`,
    },
  });

  assert.equal(res.storeWrites.length, 1);
  const payload = JSON.parse(res.storeWrites[0].value);
  assert.match(payload.cookie, /yx_csrf=valid_csrf/);
  assert.match(payload.cookie, /NTES_YD_SESS=valid_sess/);
  assert.doesNotMatch(payload.cookie, /yx_sid=/);
  assert.doesNotMatch(payload.cookie, /yx_new_sid=/);
});

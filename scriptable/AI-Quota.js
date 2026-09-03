// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: brown; icon-glyph: book;
//
// AI Quota — SuperGrok / ChatGPT Plus / Google AI Pro
// Release: 2026-08-26.1
// 中号组件：系统背景、官方彩色 logo、Notion / Instapaper 排版。
//
// 配置（任选，可叠加）：
// 1) App 内运行，按提示写入 Keychain
// 2) 小组件参数 JSON，见 README
//
// 三个套餐都读 CPA 认证，额度请求由本脚本发出。
// 不要把真实 Token / Cookie 提交进仓库。

const KEY = {
  cpaBase: "cpa.quota.baseUrl",
  cpaKey: "cpa.quota.apiKey",
};

const CACHE_FILE = "ai-quota-cache.json";
const CACHE_TTL_MS = 10 * 60 * 1000;
const REFRESH_MIN = 15;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const URLS = {
  grok: "grok://",
  chatgpt: "com.openai.chat://",
  gemini: "googlegemini://",
};

function nativeAppURL(id) {
  return URLS[id] || URLS.grok;
}

function serviceTapURL(id) {
  // On iOS, Grok's `grok://` works when opened by Scriptable but is not
  // consistently accepted as a direct WidgetKit link. ChatGPT and Gemini
  // behave the opposite way, so only Grok uses the Scriptable relay.
  if (id !== "grok") return nativeAppURL(id);
  try {
    const base = URLScheme.forRunningScript();
    const sep = base.indexOf("?") >= 0 ? "&" : "?";
    return `${base}${sep}open=grok`;
  } catch (_) {
    return nativeAppURL(id);
  }
}

// ---------- Theme ----------
function isDark() {
  return Device.isUsingDarkAppearance();
}

function ink() {
  return isDark() ? new Color("#F3F1EC") : new Color("#1C1B18");
}

function faint() {
  return isDark() ? new Color("#6E6C66") : new Color("#B0ABA3");
}

function track() {
  return isDark() ? new Color("#3F3E39") : new Color("#EDE9E2");
}

function warn() {
  return isDark() ? new Color("#E08A2E") : new Color("#C56A12");
}

function bad() {
  return isDark() ? new Color("#E07070") : new Color("#C04040");
}

function ok() {
  return isDark() ? new Color("#7DCE78") : new Color("#3E9A48");
}

const UI = {
  ink: Color.dynamic(new Color("#1C1B18"), new Color("#F2F4F7")),
  muted: Color.dynamic(new Color("#7A766F"), new Color("#8B93A0")),
  faint: Color.dynamic(new Color("#B0ABA3"), new Color("#5C6470")),
  rule: Color.dynamic(new Color("#E6E2DA"), new Color("#1E2630")),
};

function accentFor(remainingPct) {
  if (remainingPct == null) return faint();
  if (remainingPct <= 8) return bad();
  if (remainingPct <= 22) return warn();
  return ok();
}

function displayFont(size) {
  return Font.boldSystemFont(size);
}

// ---------- Config ----------
function readConfig() {
  const cfg = {
    cpaBaseUrl: "",
    cpaApiKey: "",
  };

  try {
    if (args.widgetParameter) {
      const raw = String(args.widgetParameter).trim();
      if (raw.startsWith("{")) {
        const p = JSON.parse(raw);
        cfg.cpaBaseUrl = String(p.cpaBaseUrl || p.baseUrl || "").trim();
        cfg.cpaApiKey = String(p.cpaApiKey || p.apiKey || "").trim();
      }
    }
  } catch (e) {
    console.warn("widgetParameter parse failed", e);
  }

  if (!cfg.cpaBaseUrl && Keychain.contains(KEY.cpaBase)) cfg.cpaBaseUrl = Keychain.get(KEY.cpaBase);
  if (!cfg.cpaApiKey && Keychain.contains(KEY.cpaKey)) cfg.cpaApiKey = Keychain.get(KEY.cpaKey);
  try {
    cfg.cpaBaseUrl = normalizeCpaBaseUrl(cfg.cpaBaseUrl);
  } catch (e) {
    cfg.configError = String(e.message || e);
    cfg.cpaBaseUrl = "";
  }
  return cfg;
}

function hasAnyAuth(cfg) {
  if (!cfg.cpaBaseUrl || !cfg.cpaApiKey) return false;
  try {
    normalizeCpaBaseUrl(cfg.cpaBaseUrl);
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeCpaBaseUrl(value) {
  const clean = String(value || "").trim().replace(/\/+$/, "");
  if (!clean) return "";

  // 地址由用户明确配置；允许内网常见的 HTTP 部署。
  // 仍拒绝 userinfo、路径、查询参数和片段，避免密钥被意外转发。
  const match = clean.match(
    /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i
  );
  if (!match) throw new Error("CPA 地址必须是纯主机地址，例如 https://host:port");
  const port = match[3] ? Number(match[3]) : null;
  if (port != null && (port < 1 || port > 65535)) throw new Error("CPA 端口无效");
  return clean;
}

function cacheScope(cfg) {
  // FNV-1a 仅用于隔离缓存，不作为密码学摘要；缓存中不保存原始 API Key。
  const input = `${cfg.cpaBaseUrl || ""}\u0000${cfg.cpaApiKey || ""}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function promptField(title, message, placeholder, value, secure) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  if (secure) a.addSecureTextField(placeholder, value || "");
  else a.addTextField(placeholder, value || "");
  a.addAction("保存");
  a.addCancelAction("取消");
  const i = await a.present();
  if (i !== 0) return null;
  return (a.textFieldValue(0) || "").trim();
}

async function configureInteractive(cfg) {
  if (config.runsInWidget) return cfg;

  const base = await promptField(
    "CPA",
    "CLI Proxy API 管理端地址。SuperGrok / ChatGPT / Google 的认证都从这里读。",
    "https://host:port",
    cfg.cpaBaseUrl || "",
    false
  );
  if (base == null) return cfg;
  const key = await promptField("CPA", "管理端 API Key", "API Key", "", true);
  if (key == null) return cfg;
  let clean;
  try {
    clean = normalizeCpaBaseUrl(base);
  } catch (e) {
    const invalid = new Alert();
    invalid.title = "CPA 地址无效";
    invalid.message = String(e.message || e);
    invalid.addCancelAction("返回");
    await invalid.present();
    return cfg;
  }
  if (!clean) return cfg;
  if (clean) Keychain.set(KEY.cpaBase, clean);
  if (key) Keychain.set(KEY.cpaKey, key);
  cfg.cpaBaseUrl = clean || cfg.cpaBaseUrl;
  cfg.cpaApiKey = key || cfg.cpaApiKey;
  return cfg;
}

// ---------- Cache ----------
function cachePath() {
  return FileManager.local().joinPath(FileManager.local().documentsDirectory(), CACHE_FILE);
}

function loadCache() {
  try {
    const fm = FileManager.local();
    const p = cachePath();
    if (!fm.fileExists(p)) return null;
    return JSON.parse(fm.readString(p));
  } catch (_) {
    return null;
  }
}

function saveCache(payload) {
  try {
    FileManager.local().writeString(cachePath(), JSON.stringify(payload));
  } catch (e) {
    console.warn("cache write failed", e);
  }
}

// ---------- Helpers ----------
function clampPct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.max(0, Math.min(100, Number(n)));
}

function pctLabel(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${Math.round(v)}`;
}

function formatResetMs(ms) {
  if (ms <= 0) return "即将恢复";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return hours > 0 ? `${days}天${hours}小时后` : `${days}天后`;
  if (hours > 0) return mins > 0 ? `${hours}小时${mins}分后` : `${hours}小时后`;
  return `${Math.max(1, mins)}分钟后`;
}

function parseResetHint(isoOrMs, description) {
  let end = null;
  if (isoOrMs != null) {
    if (typeof isoOrMs === "number") end = new Date(isoOrMs < 1e12 ? isoOrMs * 1000 : isoOrMs);
    else end = new Date(isoOrMs);
    if (!Number.isNaN(end.getTime())) return formatResetMs(end.getTime() - Date.now());
  }
  if (description) {
    const src = String(description);
    const d = src.match(/(\d+)\s*days?/i);
    const h = src.match(/(\d+)\s*hours?/i);
    const m = src.match(/(\d+)\s*min/i);
    if (d || h || m) {
      const days = d ? Number(d[1]) : 0;
      const hours = h ? Number(h[1]) : 0;
      const mins = m ? Number(m[1]) : 0;
      return formatResetMs(((days * 24 + hours) * 60 + mins) * 60000);
    }
  }
  return null;
}

function emptyService(id, name, url, note) {
  return {
    id,
    name,
    plan: "",
    remainingPct: null,
    usedPct: null,
    windowLabel: note || "未配置",
    resetHint: "",
    extra: "",
    url,
    ok: false,
  };
}

function wait(sec) {
  return new Promise((resolve) => Timer.schedule(sec, false, resolve));
}

function isRetryable(err) {
  const code = err && err.statusCode;
  return code === 502 || code === 503 || code === 504 || !code;
}

function friendlyHttpError(e) {
  const code = e && e.statusCode;
  if (code === 502 || code === 503 || code === 504) return "CPA 暂时不可用";
  if (code === 401 || code === 403) return "登录已过期";
  if (code === 429) return "请求太频繁";
  return String((e && e.message) || e);
}

async function loadJSONOnce(url, opts = {}) {
  const req = new Request(url);
  req.timeoutInterval = opts.timeout || 20;
  req.method = opts.method || "GET";
  const headers = {
    Accept: "application/json",
    "User-Agent": UA,
    ...(opts.headers || {}),
  };
  req.headers = headers;
  if (opts.body != null) {
    if (typeof opts.body === "string") req.body = opts.body;
    else {
      req.headers["Content-Type"] = req.headers["Content-Type"] || "application/json";
      req.body = JSON.stringify(opts.body);
    }
  }
  const res = await req.loadString();
  const code = req.response && req.response.statusCode;
  if (code && code >= 400) {
    const err = new Error(`HTTP ${code}`);
    err.statusCode = code;
    err.body = res;
    throw err;
  }
  if (!res) return {};
  try {
    return JSON.parse(res);
  } catch (_) {
    return res;
  }
}

async function loadJSON(url, opts = {}) {
  const tries = opts.retries == null ? 3 : opts.retries;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await loadJSONOnce(url, opts);
    } catch (e) {
      last = e;
      if (!isRetryable(e) || i === tries - 1) throw e;
      await wait(0.4 * (i + 1));
    }
  }
  throw last;
}

// ---------- CPA ----------
async function cpaGet(baseUrl, apiKey, path) {
  const trustedBaseUrl = normalizeCpaBaseUrl(baseUrl);
  return loadJSON(`${trustedBaseUrl}/v0/management${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

async function cpaApiCall(baseUrl, apiKey, body) {
  const trustedBaseUrl = normalizeCpaBaseUrl(baseUrl);
  return loadJSON(`${trustedBaseUrl}/v0/management/api-call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    timeout: 30,
  });
}

function parseApiBody(resp) {
  if (!resp) throw new Error("empty api-call");
  const code = Number(resp.status_code ?? resp.statusCode ?? 0);
  let body = resp.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }
  if (code && code >= 400) {
    const msg = (body && (body.error || body.message || body.msg)) || `HTTP ${code}`;
    const err = new Error(String(msg));
    err.statusCode = code;
    throw err;
  }
  return body;
}

async function listCpaFiles(cfg) {
  if (!cfg.cpaBaseUrl || !cfg.cpaApiKey) return [];
  const resp = await cpaGet(cfg.cpaBaseUrl, cfg.cpaApiKey, "/auth-files");
  return Array.isArray(resp?.files) ? resp.files : [];
}

function findCpaFiles(files, testers) {
  const seen = new Set();
  const matched = [];
  for (const f of files || []) {
    if (f.disabled) continue;
    const blob = `${f.provider || ""} ${f.type || ""} ${f.name || ""}`.toLowerCase();
    if (!testers.some((t) => t.test(blob))) continue;
    const index = authIndexOf(f);
    const key = index == null ? `name:${f.name || ""}` : `idx:${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(f);
  }
  return matched;
}

function authIndexOf(file) {
  const value = file?.auth_index ?? file?.authIndex;
  return value == null || value === "" ? null : value;
}

// ---------- Parsers ----------
function parseGrokBilling(body) {
  const cfg = body?.config || body || {};
  const usedPct = clampPct(Number(cfg.creditUsagePercent ?? cfg.credit_usage_percent));
  const remainingPct = usedPct == null ? null : clampPct(100 - usedPct);
  const periodEnd = cfg.currentPeriod?.end || cfg.billingPeriodEnd || cfg.billing_period_end || null;

  return {
    id: "grok",
    name: "SuperGrok",
    plan: "周额度",
    remainingPct,
    usedPct,
    windowLabel: "本周",
    resetHint: parseResetHint(periodEnd),
    extra: "",
    url: URLS.grok,
    ok: remainingPct != null,
  };
}

function prettyChatPlan(plan) {
  const raw = String(plan || "");
  const p = raw.toLowerCase();
  if (!p) return "Plus";
  if (p === "plus") return "Plus";
  if (p === "pro") return "Pro";
  if (p === "free") return "Free";
  if (p === "team") return "Team";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function windowLabelFromSeconds(seconds) {
  if (!Number.isFinite(seconds)) return "额度";
  if (seconds >= 6 * 24 * 3600) return "本周";
  if (seconds >= 20 * 3600) return `${Math.round(seconds / 86400)}天`;
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `${hours}小时`;
}

function isLatentWindow(win) {
  const used = Number(win?.used_percent);
  const resetAfter = Number(win?.reset_after_seconds);
  const limit = Number(win?.limit_window_seconds);
  return used === 0 && Number.isFinite(resetAfter) && Number.isFinite(limit) && resetAfter >= limit;
}

function normalizeUsageWindow(win) {
  const usedPercent = Number(win?.used_percent);
  if (!Number.isFinite(usedPercent)) return null;
  const seconds = Number(win.limit_window_seconds);
  return {
    usedPct: clampPct(usedPercent),
    remainingPct: clampPct(100 - usedPercent),
    seconds: Number.isFinite(seconds) ? seconds : null,
    resetHint: parseResetHint(win.reset_at),
    label: windowLabelFromSeconds(seconds),
    latent: isLatentWindow(win),
  };
}

function parseChatGPTUsage(usage) {
  const rl = usage?.rate_limit || {};
  const windows = [rl.primary_window, rl.secondary_window]
    .map(normalizeUsageWindow)
    .filter(Boolean);

  if (!windows.length && usage?.spend_control?.individual_limit) {
    const lim = usage.spend_control.individual_limit;
    const usedPct = clampPct(Number(lim.used_percent));
    const remainingPct =
      lim.remaining_percent != null
        ? clampPct(Number(lim.remaining_percent))
        : usedPct == null
          ? null
          : clampPct(100 - usedPct);
    return {
      id: "chatgpt",
      name: "ChatGPT",
      plan: prettyChatPlan(usage?.plan_type),
      remainingPct,
      usedPct,
      windowLabel: "额度",
      resetHint: parseResetHint(lim.reset_at),
      extra: "",
      url: URLS.chatgpt,
      ok: remainingPct != null,
    };
  }

  if (!windows.length) throw new Error("无法解析 ChatGPT 额度");

  const weekly =
    windows.find((w) => w.seconds != null && w.seconds >= 6 * 24 * 3600) ||
    windows.slice().sort((a, b) => (b.seconds || 0) - (a.seconds || 0))[0];
  const other = windows.find((w) => w !== weekly && !w.latent);
  return {
    id: "chatgpt",
    name: "ChatGPT",
    plan: prettyChatPlan(usage?.plan_type),
    remainingPct: weekly.remainingPct,
    usedPct: weekly.usedPct,
    windowLabel: weekly.label,
    resetHint: weekly.resetHint,
    extra: other ? `${other.label}剩 ${Math.round(other.remainingPct)}%` : "",
    url: URLS.chatgpt,
    ok: weekly.remainingPct != null,
  };
}

function parseAntigravity(body) {
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  const buckets = [];
  for (const g of groups) {
    for (const b of g.buckets || []) {
      const remaining = Number(b.remainingFraction ?? b.remaining_fraction);
      if (Number.isNaN(remaining)) continue;
      const remainingPct = clampPct(remaining * 100);
      buckets.push({
        id: `${b.bucketId || ""} ${g.displayName || ""} ${b.displayName || ""}`,
        remainingPct,
        usedPct: clampPct(100 - remainingPct),
        resetHint: parseResetHint(b.resetTime || b.reset_time),
        label: b.displayName || g.displayName || "额度",
      });
    }
  }
  if (!buckets.length) throw new Error("无法解析 Google 额度");
  const geminiBuckets = buckets.filter((b) => /gemini/i.test(`${b.id} ${b.label}`));
  const pool = geminiBuckets.length ? geminiBuckets : buckets;
  const weekly =
    pool.find((b) => /week|weekly|周/i.test(`${b.id} ${b.label}`)) ||
    pool.find((b) => /week|weekly|周/i.test(b.resetHint || "")) ||
    pool[0];
  return {
    id: "gemini",
    name: "Gemini",
    plan: "",
    remainingPct: weekly.remainingPct,
    usedPct: weekly.usedPct,
    windowLabel: "本周",
    resetHint: weekly.resetHint,
    extra: "",
    url: URLS.gemini,
    ok: weekly.remainingPct != null,
  };
}

// ---------- Fetchers ----------
function averageServices(services) {
  const ok = (services || []).filter((s) => s && s.ok && s.remainingPct != null);
  if (!ok.length) throw new Error("无法解析额度");
  const remainingPct = clampPct(
    ok.reduce((sum, s) => sum + Number(s.remainingPct), 0) / ok.length
  );
  const bottleneck = ok.slice().sort((a, b) => a.remainingPct - b.remainingPct)[0];
  return Object.assign({}, bottleneck, {
    remainingPct,
    usedPct: remainingPct == null ? null : clampPct(100 - remainingPct),
    extra: bottleneck.extra || "",
    ok: remainingPct != null,
  });
}

async function fetchAveragedAccounts(files, testers, fetchOne, missingError) {
  const accounts = findCpaFiles(files, testers);
  if (!accounts.length) throw new Error(missingError);
  const errors = [];
  const settled = await Promise.all(
    accounts.map(async (file) => {
      try {
        return await fetchOne(file);
      } catch (e) {
        errors.push(e);
        return null;
      }
    })
  );
  if (!settled.some((s) => s && s.ok && s.remainingPct != null)) {
    throw errors[0] || new Error(missingError);
  }
  return averageServices(settled);
}

async function fetchGrokAccount(cfg, xai) {
  const authIndex = authIndexOf(xai);
  if (authIndex == null) throw new Error("CPA 未找到 Grok 认证");
  const resp = await cpaApiCall(cfg.cpaBaseUrl, cfg.cpaApiKey, {
    authIndex,
    method: "GET",
    url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
    header: {
      Authorization: "Bearer $TOKEN$",
      "x-xai-token-auth": "xai-grok-cli",
      "x-grok-client-version": "0.2.91",
      accept: "*/*",
      "user-agent": "grok-pager/0.2.91 grok-shell/0.2.91 (ios; aarch64)",
    },
  });
  return parseGrokBilling(parseApiBody(resp));
}

async function fetchGrok(cfg, files) {
  if (!cfg.cpaApiKey || !cfg.cpaBaseUrl) {
    return emptyService("grok", "SuperGrok", URLS.grok, "未配置");
  }
  return fetchAveragedAccounts(
    files,
    [/xai/, /grok/],
    (file) => fetchGrokAccount(cfg, file),
    "CPA 未找到 Grok 认证"
  );
}

async function fetchChatGPTAccount(cfg, openai) {
  const authIndex = authIndexOf(openai);
  if (authIndex == null) throw new Error("CPA 未找到 ChatGPT 认证");
  const accountId =
    openai.account_id || openai.accountId || openai.chatgpt_account_id || openai.chatgptAccountId || "";
  const header = {
    Authorization: "Bearer $TOKEN$",
    Accept: "application/json",
  };
  if (accountId) header["ChatGPT-Account-Id"] = String(accountId);
  const resp = await cpaApiCall(cfg.cpaBaseUrl, cfg.cpaApiKey, {
    authIndex,
    method: "GET",
    url: "https://chatgpt.com/backend-api/wham/usage",
    header,
  });
  return parseChatGPTUsage(parseApiBody(resp));
}

async function fetchChatGPT(cfg, files) {
  if (!cfg.cpaApiKey || !cfg.cpaBaseUrl) {
    return emptyService("chatgpt", "ChatGPT", URLS.chatgpt, "未配置");
  }
  return fetchAveragedAccounts(
    files,
    [/openai/, /chatgpt/, /codex/],
    (file) => fetchChatGPTAccount(cfg, file),
    "CPA 未找到 ChatGPT 认证"
  );
}

async function fetchGeminiAccount(cfg, ag) {
  const authIndex = authIndexOf(ag);
  if (authIndex == null) throw new Error("CPA 未找到 Google 认证");
  const project = ag.project_id || ag.projectId || "";
  const resp = await cpaApiCall(cfg.cpaBaseUrl, cfg.cpaApiKey, {
    authIndex,
    method: "POST",
    url: "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    header: {
      Authorization: "Bearer $TOKEN$",
      "Content-Type": "application/json",
      "User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=ios; arch=arm64)",
    },
    data: JSON.stringify(project ? { project } : {}),
  });
  return parseAntigravity(parseApiBody(resp));
}

async function fetchGemini(cfg, files) {
  if (!cfg.cpaApiKey || !cfg.cpaBaseUrl) {
    return emptyService("gemini", "Gemini", URLS.gemini, "未配置");
  }
  return fetchAveragedAccounts(
    files,
    [/antigravity/, /gemini/],
    (file) => fetchGeminiAccount(cfg, file),
    "CPA 未找到 Google 认证"
  );
}

async function fetchAll(cfg) {
  const errors = [];
  let files = [];
  if (cfg.cpaApiKey && cfg.cpaBaseUrl) {
    try {
      files = await listCpaFiles(cfg);
    } catch (e) {
      errors.push(`CPA: ${friendlyHttpError(e)}`);
    }
  }
  const jobs = [
    ["grok", () => fetchGrok(cfg, files), "SuperGrok", URLS.grok],
    ["chatgpt", () => fetchChatGPT(cfg, files), "ChatGPT", URLS.chatgpt],
    ["gemini", () => fetchGemini(cfg, files), "Gemini", URLS.gemini],
  ];

  const results = await Promise.all(
    jobs.map(async ([id, fn, name, url]) => {
      try {
        return [id, await fn(), null];
      } catch (e) {
        const msg = friendlyHttpError(e);
        return [id, emptyService(id, name, url, msg), `${name}: ${msg}`];
      }
    })
  );
  const services = {};
  for (const [id, service, error] of results) {
    services[id] = service;
    if (error) errors.push(error);
  }

  return {
    fetchedAt: new Date().toISOString(),
    grok: services.grok,
    chatgpt: services.chatgpt,
    gemini: services.gemini,
    errors,
  };
}

function mergeCachedService(fresh, cached, id) {
  if (fresh[id] && fresh[id].ok) return fresh[id];
  if (cached && cached[id] && cached[id].ok) return cached[id];
  return fresh[id];
}

async function getData(cfg) {
  const scope = cacheScope(cfg);
  const loaded = loadCache();
  // 旧缓存没有 scope；地址或 Key 变化时也必须立即失效，避免串账号显示。
  const cached = loaded?.scope === scope ? loaded : null;
  const now = Date.now();
  if (cached?.data?.fetchedAt) {
    const age = now - new Date(cached.data.fetchedAt).getTime();
    if (age >= 0 && age < CACHE_TTL_MS) {
      return { data: cached.data, fromCache: true, stale: false };
    }
  }
  try {
    const data = await fetchAll(cfg);
    if (cached?.data) {
      data.grok = mergeCachedService(data, cached.data, "grok");
      data.chatgpt = mergeCachedService(data, cached.data, "chatgpt");
      data.gemini = mergeCachedService(data, cached.data, "gemini");
    }
    if (data.grok?.ok || data.chatgpt?.ok || data.gemini?.ok) {
      saveCache({ scope, savedAt: new Date().toISOString(), data });
    }
    return { data, fromCache: false, stale: false };
  } catch (e) {
    if (cached?.data) return { data: cached.data, fromCache: true, stale: true, error: e };
    throw e;
  }
}

// ---------- Draw ----------
function makeCtx(w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = false;
  return ctx;
}

function scaleImage(image, w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.drawImageInRect(image, new Rect(0, 0, w, h));
  return ctx.getImage();
}

function addFixedImage(parent, image, w, h) {
  const box = parent.addStack();
  box.size = new Size(w, h);
  box.layoutHorizontally();
  box.centerAlignContent();
  const img = box.addImage(image);
  img.imageSize = new Size(w, h);
  img.resizable = false;
  return img;
}

const LOGO_B64 = {
  grok: "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",
  chatgpt: "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",
  gemini: "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",
};

const logoCache = {};
function logoFor(id, size) {
  const key = `${id}:${size}`;
  if (logoCache[key]) return logoCache[key];
  const b64 = LOGO_B64[id];
  if (!b64) return null;
  try {
    const raw = Image.fromData(Data.fromBase64String(b64));
    logoCache[key] = scaleImage(raw, size, size);
  } catch (e) {
    console.warn("logo decode failed", id, e);
    return null;
  }
  return logoCache[key];
}

function drawBar(w, h, remainingPct, color) {
  const ctx = makeCtx(w, h);
  const r = h / 2;
  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, w, h), r, r);
  ctx.setFillColor(track());
  ctx.addPath(bg);
  ctx.fillPath();

  const pct = remainingPct == null ? 0 : Math.max(0, Math.min(100, remainingPct)) / 100;
  if (pct > 0) {
    const fw = Math.max(h, w * pct);
    const fg = new Path();
    fg.addRoundedRect(new Rect(0, 0, fw, h), r, r);
    ctx.setFillColor(color);
    ctx.addPath(fg);
    ctx.fillPath();
  }
  return ctx.getImage();
}

function drawRing(size, remainingPct, stroke, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const line = stroke;
  const r = (size - line) / 2;
  const c = new Point(size / 2, size / 2);

  const trackPath = new Path();
  trackPath.addEllipse(new Rect(line / 2, line / 2, size - line, size - line));
  ctx.setStrokeColor(track());
  ctx.setLineWidth(line);
  ctx.addPath(trackPath);
  ctx.strokePath();

  const pct = remainingPct == null ? 0 : Math.max(0, Math.min(100, remainingPct)) / 100;
  if (pct > 0.001) {
    const path = new Path();
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * pct;
    const steps = Math.max(20, Math.floor(90 * pct));
    for (let i = 0; i <= steps; i++) {
      const a = start + ((end - start) * i) / steps;
      const p = new Point(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
      if (i === 0) path.move(p);
      else path.addLine(p);
    }
    ctx.setStrokeColor(color);
    ctx.setLineWidth(line);
    ctx.addPath(path);
    ctx.strokePath();
  }

  const label = remainingPct == null ? "—" : `${Math.round(remainingPct)}`;
  ctx.setTextAlignedCenter();
  ctx.setTextColor(remainingPct == null ? faint() : ink());
  const fontSize = size >= 80 ? 22 : size >= 62 ? 17 : 13;
  ctx.setFont(Font.boldSystemFont(fontSize));
  ctx.drawTextInRect(label, new Rect(0, size / 2 - fontSize / 2 - 6, size, fontSize + 2));
  if (remainingPct != null) {
    ctx.setFont(Font.mediumSystemFont(Math.max(8, Math.floor(fontSize * 0.55))));
    ctx.setTextColor(faint());
    ctx.drawTextInRect("%", new Rect(0, size / 2 + fontSize / 2 - 4, size, 14));
  }
  return ctx.getImage();
}

// ---------- UI ----------
function t(stack, text, { size = 12, color = UI.ink, weight = "regular", lines = 1, font } = {}) {
  const el = stack.addText(String(text ?? ""));
  el.textColor = color;
  el.lineLimit = lines;
  el.font =
    font ||
    (weight === "bold"
      ? Font.boldSystemFont(size)
      : weight === "semibold"
        ? Font.semiboldSystemFont(size)
        : weight === "medium"
          ? Font.mediumSystemFont(size)
          : Font.systemFont(size));
  return el;
}

function sp(stack, n) {
  if (n == null) stack.addSpacer();
  else stack.addSpacer(n);
}

function addRule(parent) {
  const line = parent.addStack();
  line.layoutHorizontally();
  line.backgroundColor = UI.rule;
  line.size = new Size(0, 1);
  line.addSpacer();
}

function rowMeta(svc) {
  const bits = [];
  if (svc.windowLabel) bits.push(svc.windowLabel);
  if (svc.resetHint) bits.push(svc.resetHint);
  if (svc.extra) bits.push(svc.extra);
  return bits.join("  ·  ");
}

function addServiceColumn(parent, svc, opts = {}) {
  const { logoSize = 16, nameSize = 11, ringSize = 68, stroke = 6, colWidth } = opts;
  const col = parent.addStack();
  col.layoutVertically();
  col.centerAlignContent();
  col.url = serviceTapURL(svc.id);
  if (colWidth) col.size = new Size(colWidth, 0);

  const title = col.addStack();
  title.layoutHorizontally();
  title.centerAlignContent();
  sp(title);
  const logo = logoFor(svc.id, logoSize);
  if (logo) {
    addFixedImage(title, logo, logoSize, logoSize);
    sp(title, 4);
  }
  const name = t(title, svc.name, { size: nameSize, weight: "semibold", color: UI.ink });
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.8;
  sp(title);

  sp(col, 8);

  const ringRow = col.addStack();
  ringRow.layoutHorizontally();
  sp(ringRow);
  addFixedImage(
    ringRow,
    drawRing(ringSize, svc.remainingPct, stroke, accentFor(svc.remainingPct)),
    ringSize,
    ringSize
  );
  sp(ringRow);

  sp(col, 6);
  const hint = svc.resetHint || svc.windowLabel || "";
  const hintRow = col.addStack();
  hintRow.layoutHorizontally();
  hintRow.centerAlignContent();
  sp(hintRow);
  const sub = t(hintRow, hint, { size: 10, color: UI.muted, lines: 1 });
  sub.minimumScaleFactor = 0.75;
  sp(hintRow);

  return col;
}

function applySystemChrome(widget) {
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);
}

function ordered(data) {
  return [data.grok, data.chatgpt, data.gemini].filter(Boolean);
}

function buildColumns(widget, data, opts) {
  const body = widget.addStack();
  body.layoutHorizontally();
  body.topAlignContent();
  const services = ordered(data);
  const n = Math.max(1, services.length);
  const colWidth = opts.colWidth || Math.floor(300 / n);
  services.forEach((svc, i) => {
    if (i > 0) sp(body, 6);
    addServiceColumn(body, svc, Object.assign({}, opts, { colWidth }));
  });
  return body;
}

function buildMedium(data) {
  const w = new ListWidget();
  applySystemChrome(w);
  w.setPadding(12, 10, 10, 10);
  sp(w);
  buildColumns(w, data, { logoSize: 16, nameSize: 11, ringSize: 70, stroke: 6, colWidth: 104 });
  sp(w);
  return w;
}

function buildSmall(data) {
  const w = new ListWidget();
  applySystemChrome(w);
  w.setPadding(10, 8, 8, 8);
  sp(w);
  buildColumns(w, data, { logoSize: 13, nameSize: 9, ringSize: 46, stroke: 5 });
  sp(w);
  return w;
}

function buildLarge(data) {
  const w = new ListWidget();
  applySystemChrome(w);
  w.setPadding(16, 16, 14, 16);
  sp(w);
  buildColumns(w, data, { logoSize: 18, nameSize: 13, ringSize: 100, stroke: 8, colWidth: 140 });
  sp(w);

  if (data.errors?.length) {
    sp(w, 12);
    t(w, data.errors.join("  ·  "), { size: 10, color: UI.muted, lines: 3 });
  }
  return w;
}

function buildError(message) {
  const w = new ListWidget();
  applySystemChrome(w);
  w.setPadding(16, 16, 16, 16);
  t(w, message || "加载失败", { size: 13, color: UI.ink, lines: 5 });
  sp(w, 8);
  t(w, "在 App 内运行脚本完成配置", { size: 11, color: UI.muted, lines: 3 });
  return w;
}

function chooseBuilder() {
  const f = config.widgetFamily;
  if (f === "small") return buildSmall;
  if (f === "large" || f === "extraLarge") return buildLarge;
  return buildMedium;
}

// ---------- Main ----------
async function presentPreviewMenu(data, cfg) {
  const a = new Alert();
  a.title = "AI Quota";
  const lines = ordered(data).map((s) => {
    const left = s.remainingPct == null ? "—" : `${Math.round(s.remainingPct)}% 剩余`;
    return `${s.name}  ${left}  ${rowMeta(s)}`;
  });
  const extra = (data.errors || []).join("\n");
  a.message = `${lines.join("\n")}${extra ? `\n\n${extra}` : ""}`;
  a.addAction("预览小号");
  a.addAction("预览中号");
  a.addAction("预览大号");
  a.addAction("测试 App 跳转");
  a.addAction("配置 CPA");
  a.addCancelAction("完成");
  const i = await a.present();
  if (i === 0) await buildSmall(data).presentSmall();
  else if (i === 1) await buildMedium(data).presentMedium();
  else if (i === 2) await buildLarge(data).presentLarge();
  else if (i === 3) {
    const test = new Alert();
    test.title = "测试 App 跳转";
    test.message = "选择后会直接打开对应 App，不使用任何网页回退。";
    test.addAction("打开 Grok");
    test.addAction("打开 ChatGPT");
    test.addAction("打开 Gemini");
    test.addCancelAction("取消");
    const appIndex = await test.present();
    if (appIndex >= 0 && appIndex <= 2) {
      const id = ["grok", "chatgpt", "gemini"][appIndex];
      Safari.open(nativeAppURL(id));
    }
  } else if (i === 4) {
    const next = await configureInteractive(cfg);
    if (hasAnyAuth(next)) {
      const fresh = await getData(next);
      await presentPreviewMenu(fresh.data, next);
    }
  }
}

async function main() {
  const openId = args.queryParameters && args.queryParameters.open;
  if (openId === "grok") {
    Safari.open(URLS.grok);
    return;
  }

  let cfg = readConfig();

  if (!config.runsInWidget && !hasAnyAuth(cfg)) {
    cfg = await configureInteractive(cfg);
  }

  if (!hasAnyAuth(cfg)) {
    const w = buildError(
      cfg.configError || "尚未配置。请在 Scriptable 内运行本脚本，填写 CPA 地址与 API Key。"
    );
    if (config.runsInWidget) Script.setWidget(w);
    else await w.presentMedium();
    return;
  }

  try {
    const { data, stale, error } = await getData(cfg);
    if (stale && error) {
      data.errors = [`缓存 ${error.message || error}`, ...(data.errors || [])];
    }

    if (!config.runsInWidget) {
      await presentPreviewMenu(data, cfg);
      return;
    }

    Script.setWidget(chooseBuilder()(data));
  } catch (e) {
    console.error(e);
    const w = buildError(String(e.message || e));
    if (config.runsInWidget) Script.setWidget(w);
    else await w.presentMedium();
  }
}

await main();
Script.complete();

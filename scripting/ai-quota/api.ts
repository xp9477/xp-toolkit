import type {
  Config,
  ServiceQuota,
  ServiceAccountDetail,
  CPAAuth,
  QuotaData,
  UsageWindow,
  CachePayload,
  ServiceId,
} from "./types";

export const KEY = {
  cpaBase: "cpa.quota.baseUrl",
  cpaKey: "cpa.quota.apiKey",
};

export const CACHE_KEY = "ai-quota-cache";
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

export const URLS: Record<ServiceId, string> = {
  grok: "grok://",
  chatgpt: "com.openai.chat://",
  gemini: "googlegemini://",
};

export function nativeAppURL(id: string): string {
  return URLS[id as ServiceId] || URLS.grok;
}

export function serviceTapURL(id: string): string {
  return nativeAppURL(id);
}

// Keychain and Storage are host namespaces, not exports of "scripting".
// https://scriptingapp.github.io/guide/Device%20Capabilities/Keychain
// https://scriptingapp.github.io/guide/Utilities/Storage
// Widget is imported by entry files; widget.tsx/app_intents.tsx also see it as a global.
// Look them up on globalThis so the compiler does not rewrite them into
// `import { Keychain } from "scripting"` (that binding is undefined at runtime).
function hostGlobal(name: "Widget" | "Keychain" | "Storage"): any {
  return (globalThis as any)[name];
}

export function getWidget(): any {
  return hostGlobal("Widget");
}

export function getKeychain(): any {
  return hostGlobal("Keychain");
}

export function getStorage(): any {
  return hostGlobal("Storage");
}

// ---------- Config ----------
export function readConfig(overrideParam?: string): Config {
  const cfg: Config = {
    cpaBaseUrl: "",
    cpaApiKey: "",
  };

  const widget = getWidget();
  const keychain = getKeychain();
  const storage = getStorage();

  const param = overrideParam !== undefined ? overrideParam : widget?.parameter;
  if (param) {
    try {
      const raw = String(param).trim();
      if (raw.startsWith("{")) {
        const p = JSON.parse(raw);
        cfg.cpaBaseUrl = String(p.cpaBaseUrl || p.baseUrl || "").trim();
        cfg.cpaApiKey = String(p.cpaApiKey || p.apiKey || "").trim();
      }
    } catch (e) {
      console.warn("widgetParameter parse failed", e);
    }
  }

  if (!cfg.cpaBaseUrl && keychain?.get) {
    try {
      cfg.cpaBaseUrl = keychain.get(KEY.cpaBase) || "";
    } catch (_) {}
  }
  if (!cfg.cpaApiKey && keychain?.get) {
    try {
      cfg.cpaApiKey = keychain.get(KEY.cpaKey) || "";
    } catch (_) {}
  }

  if (!cfg.cpaBaseUrl && storage?.get) {
    try {
      cfg.cpaBaseUrl = storage.get(KEY.cpaBase) || "";
    } catch (_) {}
  }
  if (!cfg.cpaApiKey && storage?.get) {
    try {
      cfg.cpaApiKey = storage.get(KEY.cpaKey) || "";
    } catch (_) {}
  }

  try {
    cfg.cpaBaseUrl = normalizeCpaBaseUrl(cfg.cpaBaseUrl);
  } catch (e: any) {
    cfg.configError = String(e.message || e);
    cfg.cpaBaseUrl = "";
  }
  return cfg;
}

export function hasAnyAuth(cfg: { cpaBaseUrl?: string; cpaApiKey?: string }): boolean {
  if (!cfg.cpaBaseUrl || !cfg.cpaApiKey) return false;
  try {
    normalizeCpaBaseUrl(cfg.cpaBaseUrl);
    return true;
  } catch (_) {
    return false;
  }
}

export function normalizeCpaBaseUrl(value: string): string {
  const clean = String(value || "").trim().replace(/\/+$/, "");
  if (!clean) return "";

  const match = clean.match(
    /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i
  );
  if (!match) throw new Error("CPA 地址必须是纯主机地址，例如 https://host:port");
  const port = match[3] ? Number(match[3]) : null;
  if (port != null && (port < 1 || port > 65535)) throw new Error("CPA 端口无效");
  return clean;
}

export function cacheScope(cfg: { cpaBaseUrl?: string; cpaApiKey?: string }): string {
  const input = `${cfg.cpaBaseUrl || ""}\u0000${cfg.cpaApiKey || ""}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------- Helpers ----------
export function clampPct(n: any): number | null {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.max(0, Math.min(100, Number(n)));
}

export function pctLabel(v: any): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${Math.round(v)}`;
}

export function formatResetMs(ms: number): string {
  if (ms <= 0) return "即将恢复";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return hours > 0 ? `${days}天${hours}小时后` : `${days}天后`;
  if (hours > 0) return mins > 0 ? `${hours}小时${mins}分后` : `${hours}小时后`;
  return `${Math.max(1, mins)}分钟后`;
}

export function parseResetTimeMs(isoOrMs?: any, description?: any): number | null {
  if (isoOrMs != null) {
    let end: Date;
    if (typeof isoOrMs === "number") end = new Date(isoOrMs < 1e12 ? isoOrMs * 1000 : isoOrMs);
    else end = new Date(isoOrMs);
    const ms = end.getTime();
    if (!Number.isNaN(ms)) return ms;
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
      return Date.now() + ((days * 24 + hours) * 60 + mins) * 60000;
    }
  }
  return null;
}

export function parseResetHint(isoOrMs?: any, description?: any): string | null {
  const ms = parseResetTimeMs(isoOrMs, description);
  if (ms != null) {
    return formatResetMs(ms - Date.now());
  }
  return null;
}

export function emptyService(id: ServiceId, name: string, url: string, note?: string): ServiceQuota {
  return {
    id,
    name,
    plan: "",
    remainingPct: null,
    usedPct: null,
    windowLabel: note || "未配置",
    resetHint: "",
    resetAt: null,
    remaining5hPct: null,
    reset5hHint: null,
    reset5hAt: null,
    extra: "",
    url,
    ok: false,
  };
}

function wait(sec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

function isRetryable(err: any): boolean {
  const code = err && err.statusCode;
  return code === 502 || code === 503 || code === 504 || !code;
}

function friendlyHttpError(e: any): string {
  const code = e && e.statusCode;
  if (code === 502 || code === 503 || code === 504) return "CPA 暂时不可用";
  if (code === 401 || code === 403) return "登录已过期";
  if (code === 429) return "请求太频繁";
  return String((e && e.message) || e);
}

async function loadJSONOnce(url: string, opts: any = {}): Promise<any> {
  const timeoutMs = (opts.timeout || 20) * 1000;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        ...(opts.headers || {}),
      },
      body:
        opts.body != null
          ? typeof opts.body === "string"
            ? opts.body
            : JSON.stringify(opts.body)
          : undefined,
      signal: controller ? controller.signal : undefined,
    });

    const code = res.status;
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const err: any = new Error(`HTTP ${code}`);
      err.statusCode = code;
      err.body = text;
      throw err;
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function loadJSON(url: string, opts: any = {}): Promise<any> {
  const tries = opts.retries == null ? 3 : opts.retries;
  let last: any;
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
export async function cpaGet(baseUrl: string, apiKey: string, path: string): Promise<any> {
  const trustedBaseUrl = normalizeCpaBaseUrl(baseUrl);
  return loadJSON(`${trustedBaseUrl}/v0/management${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export async function cpaApiCall(baseUrl: string, apiKey: string, body: any): Promise<any> {
  const trustedBaseUrl = normalizeCpaBaseUrl(baseUrl);
  const normalizedBody = Object.assign({}, body);
  const rawIdx = normalizedBody.authIndex ?? normalizedBody.auth_index;
  if (rawIdx != null) {
    const strIdx = String(rawIdx);
    normalizedBody.auth_index = strIdx;
    normalizedBody.authIndex = strIdx;
  }
  return loadJSON(`${trustedBaseUrl}/v0/management/api-call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: normalizedBody,
    timeout: 30,
  });
}

export function parseApiBody(resp: any): any {
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
    const err: any = new Error(String(msg));
    err.statusCode = code;
    throw err;
  }
  return body;
}

export async function listCpaFiles(cfg: Config): Promise<CPAAuth[]> {
  if (!cfg.cpaBaseUrl || !cfg.cpaApiKey) return [];
  const resp = await cpaGet(cfg.cpaBaseUrl, cfg.cpaApiKey, "/auth-files");
  return Array.isArray(resp?.files) ? resp.files : [];
}

export function findCpaFiles(files: CPAAuth[] | undefined, testers: RegExp[]): CPAAuth[] {
  const seen = new Set<string>();
  const matched: CPAAuth[] = [];
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

export function authIndexOf(file: any): string | number | null {
  const value = file?.auth_index ?? file?.authIndex;
  return value == null || value === "" ? null : value;
}

// ---------- Parsers ----------
export function parseGrokBilling(body: any): ServiceQuota {
  const cfg = body?.config || body || {};
  let usedPct = clampPct(Number(cfg.creditUsagePercent ?? cfg.credit_usage_percent));
  if (usedPct == null && cfg.currentPeriod) {
    usedPct = 0;
  }
  const remainingPct = usedPct == null ? null : clampPct(100 - usedPct);
  if (remainingPct == null) {
    throw new Error("无法解析 Grok 额度");
  }
  const periodEnd = cfg.currentPeriod?.end || cfg.billingPeriodEnd || cfg.billing_period_end || null;

  return {
    id: "grok",
    name: "SuperGrok",
    plan: "周额度",
    remainingPct,
    usedPct,
    windowLabel: "本周",
    resetHint: parseResetHint(periodEnd),
    resetAt: parseResetTimeMs(periodEnd),
    remaining5hPct: null,
    reset5hHint: null,
    reset5hAt: null,
    extra: "",
    url: URLS.grok,
    ok: true,
  };
}

export function prettyChatPlan(plan: any): string {
  const raw = String(plan || "");
  const p = raw.toLowerCase();
  if (!p) return "Plus";
  if (p === "plus") return "Plus";
  if (p === "pro") return "Pro";
  if (p === "free") return "Free";
  if (p === "team") return "Team";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function windowLabelFromSeconds(seconds: any): string {
  if (!Number.isFinite(seconds)) return "额度";
  if (seconds >= 6 * 24 * 3600) return "本周";
  if (seconds >= 20 * 3600) return `${Math.round(seconds / 86400)}天`;
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `${hours}小时`;
}

export function isLatentWindow(win: any): boolean {
  const used = Number(win?.used_percent);
  const resetAfter = Number(win?.reset_after_seconds);
  const limit = Number(win?.limit_window_seconds);
  return used === 0 && Number.isFinite(resetAfter) && Number.isFinite(limit) && resetAfter >= limit;
}

export function normalizeUsageWindow(win: any): UsageWindow | null {
  const usedPercent = Number(win?.used_percent);
  if (!Number.isFinite(usedPercent)) return null;
  const seconds = Number(win.limit_window_seconds);
  return {
    usedPct: clampPct(usedPercent),
    remainingPct: clampPct(100 - usedPercent),
    seconds: Number.isFinite(seconds) ? seconds : null,
    resetHint: parseResetHint(win.reset_at),
    resetAt: parseResetTimeMs(win.reset_at),
    label: windowLabelFromSeconds(seconds),
    latent: isLatentWindow(win),
  };
}

export function parseChatGPTUsage(usage: any): ServiceQuota {
  const rl = usage?.rate_limit || {};
  const windows = [rl.primary_window, rl.secondary_window]
    .map(normalizeUsageWindow)
    .filter((w): w is UsageWindow => w !== null);

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
      resetAt: parseResetTimeMs(lim.reset_at),
      remaining5hPct: null,
      reset5hHint: null,
      reset5hAt: null,
      extra: "",
      url: URLS.chatgpt,
      ok: remainingPct != null,
    };
  }

  if (!windows.length) throw new Error("无法解析 ChatGPT 额度");

  const weekly =
    windows.find((w) => w.seconds != null && w.seconds >= 6 * 24 * 3600) ||
    windows.slice().sort((a, b) => (b.seconds || 0) - (a.seconds || 0))[0];
  const win5h = windows.find((w) => w !== weekly && w.seconds != null && w.seconds <= 24 * 3600);

  let remaining5hPct: number | null = null;
  let reset5hHint: string | null = null;
  let reset5hAt: number | null = null;

  if (win5h) {
    remaining5hPct = win5h.remainingPct;
    if (win5h.usedPct === 0) {
      reset5hHint = "满";
      reset5hAt = null;
    } else {
      reset5hHint = win5h.resetHint;
      reset5hAt = win5h.resetAt;
    }
  }

  return {
    id: "chatgpt",
    name: "ChatGPT",
    plan: prettyChatPlan(usage?.plan_type),
    remainingPct: weekly.remainingPct,
    usedPct: weekly.usedPct,
    windowLabel: weekly.label,
    resetHint: weekly.resetHint,
    resetAt: weekly.resetAt,
    remaining5hPct,
    reset5hHint,
    reset5hAt,
    extra: win5h ? `${win5h.label}剩 ${Math.round(win5h.remainingPct || 0)}%` : "",
    url: URLS.chatgpt,
    ok: weekly.remainingPct != null,
  };
}

export function parseAntigravity(body: any): ServiceQuota {
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  const buckets: any[] = [];
  for (const g of groups) {
    for (const b of g.buckets || []) {
      const remaining = Number(b.remainingFraction ?? b.remaining_fraction);
      if (Number.isNaN(remaining)) continue;
      const remainingPct = clampPct(remaining * 100);
      buckets.push({
        id: `${b.bucketId || ""} ${g.displayName || ""} ${b.displayName || ""}`,
        remainingPct,
        usedPct: clampPct(100 - (remainingPct || 0)),
        resetHint: parseResetHint(b.resetTime || b.reset_time, b.description),
        resetAt: parseResetTimeMs(b.resetTime || b.reset_time, b.description),
        label: b.displayName || g.displayName || "额度",
        bucketId: b.bucketId,
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
  const bucket5h = pool.find(
    (b) => b !== weekly && (/5h|hour|小时/i.test(`${b.id} ${b.label}`) || b.bucketId === "gemini-5h")
  );

  let remaining5hPct: number | null = null;
  let reset5hHint: string | null = null;
  let reset5hAt: number | null = null;

  if (bucket5h) {
    remaining5hPct = bucket5h.remainingPct;
    if (bucket5h.remainingPct != null && bucket5h.remainingPct >= 99.9) {
      reset5hHint = "满";
      reset5hAt = null;
    } else {
      reset5hHint = bucket5h.resetHint;
      reset5hAt = bucket5h.resetAt;
    }
  }

  return {
    id: "gemini",
    name: "Gemini",
    plan: "",
    remainingPct: weekly.remainingPct,
    usedPct: weekly.usedPct,
    windowLabel: "本周",
    resetHint: weekly.resetHint,
    resetAt: weekly.resetAt,
    remaining5hPct,
    reset5hHint,
    reset5hAt,
    extra: bucket5h ? `5小时剩 ${Math.round(bucket5h.remainingPct || 0)}%` : "",
    url: URLS.gemini,
    ok: weekly.remainingPct != null,
  };
}

// ---------- Fetchers ----------
export function averageServices(services: (ServiceQuota | null | undefined)[]): ServiceQuota {
  const ok = (services || []).filter(
    (s): s is ServiceQuota => s != null && s.ok && s.remainingPct != null
  );
  if (!ok.length) throw new Error("无法解析额度");
  const remainingPct = clampPct(
    ok.reduce((sum, s) => sum + Number(s.remainingPct), 0) / ok.length
  );
  const bottleneck = ok.slice().sort((a, b) => (a.remainingPct || 0) - (b.remainingPct || 0))[0];
  const withReset = ok.filter((s) => s.resetAt != null && Number.isFinite(s.resetAt));
  const earliestReset = withReset.length
    ? withReset.slice().sort((a, b) => (a.resetAt || 0) - (b.resetAt || 0))[0]
    : bottleneck;

  const with5h = ok.filter((s) => s.remaining5hPct != null && Number.isFinite(s.remaining5hPct));
  let remaining5hPct: number | null = null;
  let reset5hHint: string | null = null;
  let reset5hAt: number | null = null;

  if (with5h.length > 0) {
    remaining5hPct = clampPct(
      with5h.reduce((sum, s) => sum + Number(s.remaining5hPct), 0) / with5h.length
    );
    const activeCooldowns = with5h.filter(
      (s) => s.reset5hAt != null && Number.isFinite(s.reset5hAt) && s.reset5hHint !== "满"
    );
    if (activeCooldowns.length > 0) {
      const earliest5h = activeCooldowns.slice().sort((a, b) => (a.reset5hAt || 0) - (b.reset5hAt || 0))[0];
      reset5hHint = earliest5h.reset5hHint;
      reset5hAt = earliest5h.reset5hAt;
    } else {
      reset5hHint = "满";
    }
  }

  return Object.assign({}, bottleneck, {
    remainingPct,
    usedPct: remainingPct == null ? null : clampPct(100 - remainingPct),
    resetHint: earliestReset.resetHint || bottleneck.resetHint || "",
    resetAt: earliestReset.resetAt ?? bottleneck.resetAt ?? null,
    remaining5hPct,
    reset5hHint,
    reset5hAt,
    extra: bottleneck.extra || "",
    ok: remainingPct != null,
  });
}

async function fetchAveragedAccounts(
  files: CPAAuth[],
  testers: RegExp[],
  fetchOne: (file: CPAAuth) => Promise<ServiceQuota>,
  missingError: string
): Promise<ServiceQuota> {
  const accounts = findCpaFiles(files, testers);
  if (!accounts.length) throw new Error(missingError);
  const errors: string[] = [];
  const settled = await Promise.all(
    accounts.map(async (file) => {
      try {
        const res = await fetchOne(file);
        return { ok: true, res, file };
      } catch (e: any) {
        errors.push(`${file.name || "account"}: ${e.message || e}`);
        return { ok: false, error: e, file };
      }
    })
  );
  const successful = settled.filter(
    (s): s is { ok: true; res: ServiceQuota; file: CPAAuth } =>
      Boolean(s && s.ok && s.res && s.res.ok && s.res.remainingPct != null)
  );
  if (!successful.length) {
    throw new Error(errors[0] || missingError);
  }
  const result = averageServices(successful.map((s) => s.res));
  result.accountCount = successful.length;
  result.totalAccounts = accounts.length;
  result.accountDetails = successful.map((s) => ({
    name: s.file.name || s.file.account || s.file.email || "account",
    remainingPct: s.res.remainingPct,
    resetHint: s.res.resetHint,
    resetAt: s.res.resetAt,
    remaining5hPct: s.res.remaining5hPct,
    reset5hHint: s.res.reset5hHint,
    reset5hAt: s.res.reset5hAt,
    extra: s.res.extra,
  }));
  if (errors.length > 0 && errors.length < accounts.length) {
    result.warnings = errors;
  }
  return result;
}

async function fetchGrokAccount(cfg: Config, xai: CPAAuth): Promise<ServiceQuota> {
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

export async function fetchGrok(cfg: Config, files: CPAAuth[]): Promise<ServiceQuota> {
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

async function fetchChatGPTAccount(cfg: Config, openai: CPAAuth): Promise<ServiceQuota> {
  const authIndex = authIndexOf(openai);
  if (authIndex == null) throw new Error("CPA 未找到 ChatGPT 认证");
  const accountId =
    openai.account_id ||
    openai.accountId ||
    openai.chatgpt_account_id ||
    openai.chatgptAccountId ||
    openai.id_token?.chatgpt_account_id ||
    openai.idToken?.chatgptAccountId ||
    "";
  const header: Record<string, string> = {
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

export async function fetchChatGPT(cfg: Config, files: CPAAuth[]): Promise<ServiceQuota> {
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

async function fetchGeminiAccount(cfg: Config, ag: CPAAuth): Promise<ServiceQuota> {
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

export async function fetchGemini(cfg: Config, files: CPAAuth[]): Promise<ServiceQuota> {
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

export async function fetchAll(cfg: Config): Promise<QuotaData> {
  const errors: string[] = [];
  let files: CPAAuth[] = [];
  if (cfg.cpaApiKey && cfg.cpaBaseUrl) {
    try {
      files = await listCpaFiles(cfg);
    } catch (e: any) {
      errors.push(`CPA: ${friendlyHttpError(e)}`);
    }
  }
  type Job = [ServiceId, () => Promise<ServiceQuota>, string, string];
  const jobs: Job[] = [
    ["grok", () => fetchGrok(cfg, files), "SuperGrok", URLS.grok],
    ["chatgpt", () => fetchChatGPT(cfg, files), "ChatGPT", URLS.chatgpt],
    ["gemini", () => fetchGemini(cfg, files), "Gemini", URLS.gemini],
  ];

  const results = await Promise.all(
    jobs.map(async ([id, fn, name, url]) => {
      try {
        const service = await fn();
        const errs = service.warnings || [];
        return [id, service, errs.length ? `${name}: 部分账号获取失败 (${errs.join("; ")})` : null] as const;
      } catch (e: any) {
        const msg = friendlyHttpError(e);
        return [id, emptyService(id, name, url, msg), `${name}: ${msg}`] as const;
      }
    })
  );
  const services: any = {};
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

export function mergeCachedService(
  fresh: Record<string, ServiceQuota>,
  cached: Record<string, ServiceQuota>,
  id: string
): ServiceQuota {
  if (fresh[id] && fresh[id].ok) return fresh[id];
  if (cached && cached[id] && cached[id].ok) return cached[id];
  return fresh[id];
}

export async function fetchQuotaData(forceRefresh = false): Promise<QuotaData> {
  const cfg = readConfig();
  if (!hasAnyAuth(cfg)) {
    return {
      fetchedAt: new Date().toISOString(),
      grok: emptyService("grok", "SuperGrok", URLS.grok, cfg.configError || "未配置"),
      chatgpt: emptyService("chatgpt", "ChatGPT", URLS.chatgpt, cfg.configError || "未配置"),
      gemini: emptyService("gemini", "Gemini", URLS.gemini, cfg.configError || "未配置"),
      errors: [cfg.configError || "尚未配置 CPA 地址与 API Key"],
      isCached: false,
    };
  }

  const scope = cacheScope(cfg);
  const storage = getStorage();
  let cachedPayload: CachePayload | null = null;
  if (storage?.get) {
    try {
      const raw = storage.get(CACHE_KEY);
      if (raw) {
        cachedPayload = typeof raw === "string" ? JSON.parse(raw) : raw;
      }
    } catch (_) {}
  }

  const cached = cachedPayload?.scope === scope ? cachedPayload : null;
  const now = Date.now();
  if (!forceRefresh && cached?.data?.fetchedAt) {
    const age = now - new Date(cached.data.fetchedAt).getTime();
    if (age >= 0 && age < CACHE_TTL_MS) {
      return { ...cached.data, isCached: true };
    }
  }

  try {
    const data = await fetchAll(cfg);
    if (cached?.data && !forceRefresh) {
      data.grok = mergeCachedService(data as any, cached.data as any, "grok");
      data.chatgpt = mergeCachedService(data as any, cached.data as any, "chatgpt");
      data.gemini = mergeCachedService(data as any, cached.data as any, "gemini");
    }
    if (data.grok?.ok || data.chatgpt?.ok || data.gemini?.ok) {
      if (storage?.set) {
        try {
          storage.set(CACHE_KEY, {
            scope,
            savedAt: new Date().toISOString(),
            data,
          });
        } catch (e) {
          console.warn("Storage cache write failed", e);
        }
      }
    }
    return { ...data, isCached: false };
  } catch (e: any) {
    if (cached?.data) {
      return {
        ...cached.data,
        isCached: true,
        errors: [`缓存 ${e.message || e}`, ...(cached.data.errors || [])],
      };
    }
    throw e;
  }
}

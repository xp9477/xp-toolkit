// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: chart-pie;
//
// CPA Quota Widget
// 在 iOS 小组件上显示 CPA (CLI Proxy API) 的 Anti Gravity 与 Grok 配额。
// 样式参考 Claude Code Usage：深色紫黑背景 + 圆环进度 + 用量条 + 底部 chips。
//
// 配置方式（任选其一）：
// 1) App 内首次运行脚本，按提示写入 Keychain
// 2) 小组件参数 JSON：{"baseUrl":"https://cpa.example:50442","apiKey":"xxx"}
// 3) 小组件参数简写：baseUrl|apiKey  或  仅 apiKey
//
// 支持：Small / Medium / Large / 锁屏 Accessory

const KEYCHAIN_BASE = "cpa.quota.baseUrl";
const KEYCHAIN_KEY = "cpa.quota.apiKey";
const CACHE_FILE = "cpa-quota-cache.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESH_MIN = 15;

// ---------- Theme ----------
const THEME = {
  bgTop: new Color("#160B28"),
  bgBottom: new Color("#0A0612"),
  card: new Color("#1C1030", 0.78),
  track: new Color("#2C1B45"),
  text: new Color("#F5F3FF"),
  muted: new Color("#C4B5FD"),
  dim: new Color("#8B7AAF"),
  purple: new Color("#A78BFA"),
  purpleDeep: new Color("#7C3AED"),
  indigo: new Color("#818CF8"),
  cyan: new Color("#22D3EE"),
  green: new Color("#34D399"),
  yellow: new Color("#FBBF24"),
  orange: new Color("#FB923C"),
  red: new Color("#F87171"),
  pink: new Color("#F472B6"),
};

const AG_COLORS = {
  main: THEME.purple,
  gemini: THEME.cyan,
  thirdParty: THEME.orange,
};

const GROK_COLORS = {
  main: THEME.indigo,
  build: THEME.purple,
  imagine: THEME.pink,
  chat: THEME.cyan,
  other: THEME.yellow,
};

// ---------- Config ----------
function readConfig() {
  let baseUrl = "";
  let apiKey = "";

  try {
    if (args.widgetParameter) {
      const raw = String(args.widgetParameter).trim();
      if (raw.startsWith("{")) {
        const p = JSON.parse(raw);
        baseUrl = String(p.baseUrl || p.base_url || "").trim();
        apiKey = String(p.apiKey || p.api_key || p.token || "").trim();
      } else if (raw.includes("|")) {
        const [u, k] = raw.split("|");
        baseUrl = String(u || "").trim();
        apiKey = String(k || "").trim();
      } else if (raw) {
        apiKey = raw;
      }
    }
  } catch (e) {
    console.warn("widgetParameter parse failed", e);
  }

  if (!baseUrl && Keychain.contains(KEYCHAIN_BASE)) baseUrl = Keychain.get(KEYCHAIN_BASE);
  if (!apiKey && Keychain.contains(KEYCHAIN_KEY)) apiKey = Keychain.get(KEYCHAIN_KEY);

  baseUrl = (baseUrl || "https://cpa.990226.xyz:50442").replace(/\/+$/, "");
  return { baseUrl, apiKey: apiKey || "" };
}

async function ensureConfigInteractive(cfg) {
  if (cfg.apiKey || config.runsInWidget) return cfg;

  const alert = new Alert();
  alert.title = "CPA Quota 配置";
  alert.message = "填写 CPA 管理端地址与 API Key（保存到 Keychain）";
  alert.addTextField("Base URL", cfg.baseUrl || "https://cpa.990226.xyz:50442");
  alert.addSecureTextField("API Key", "");
  alert.addAction("保存");
  alert.addCancelAction("取消");
  const idx = await alert.present();
  if (idx !== 0) return cfg;

  const baseUrl = (alert.textFieldValue(0) || "").trim().replace(/\/+$/, "");
  const apiKey = (alert.textFieldValue(1) || "").trim();
  if (baseUrl) Keychain.set(KEYCHAIN_BASE, baseUrl);
  if (apiKey) Keychain.set(KEYCHAIN_KEY, apiKey);
  return { baseUrl: baseUrl || cfg.baseUrl, apiKey: apiKey || cfg.apiKey };
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

// ---------- Network ----------
async function cpaGet(baseUrl, apiKey, path) {
  const req = new Request(`${baseUrl}/v0/management${path}`);
  req.timeoutInterval = 20;
  req.headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  return req.loadJSON();
}

async function cpaApiCall(baseUrl, apiKey, body) {
  const req = new Request(`${baseUrl}/v0/management/api-call`);
  req.method = "POST";
  req.timeoutInterval = 30;
  req.headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  req.body = JSON.stringify(body);
  return req.loadJSON();
}

function parseApiBody(resp) {
  if (!resp) throw new Error("empty api-call response");
  const code = Number(resp.status_code ?? resp.statusCode ?? 0);
  let body = resp.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_) {}
  }
  if (code && code >= 400) {
    const msg =
      (body && (body.error || body.message || body.msg)) || `upstream HTTP ${code}`;
    throw new Error(String(msg));
  }
  return body;
}

// ---------- Parse ----------
function clampPct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.max(0, Math.min(100, Number(n)));
}

function parseResetHint(iso, description) {
  if (description) {
    const m =
      String(description).match(/refresh(?:es)? in ([^.]+)/i) ||
      String(description).match(/fully refresh in ([^.]+)/i);
    if (m) return m[1].trim();
  }
  if (!iso) return null;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - Date.now();
  if (ms <= 0) return "即将";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
  return `${Math.max(1, mins)}分钟`;
}

function formatClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseAntigravity(body, meta = {}) {
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  const buckets = [];

  for (const g of groups) {
    const gName = g.displayName || g.display_name || "Group";
    for (const b of g.buckets || []) {
      const remaining = Number(b.remainingFraction ?? b.remaining_fraction);
      if (Number.isNaN(remaining)) continue;
      const remainingPct = clampPct(remaining * 100);
      const usedPct = clampPct(100 - remainingPct);
      buckets.push({
        id: b.bucketId || b.bucket_id || gName,
        group: gName,
        label: b.displayName || b.display_name || gName,
        remainingPct,
        usedPct,
        resetTime: b.resetTime || b.reset_time || null,
        resetHint: parseResetHint(b.resetTime || b.reset_time, b.description),
        description: b.description || "",
      });
    }
  }

  const gemini =
    buckets.find((b) => /gemini/i.test(`${b.id} ${b.group} ${b.label}`)) || null;
  const third =
    buckets.find((b) => /claude|gpt|3p/i.test(`${b.id} ${b.group} ${b.label}`)) || null;
  // Primary ring focuses on Claude/GPT (usually tighter); fallback first bucket
  const primary = third || buckets[0] || null;

  return {
    provider: "antigravity",
    title: "Anti Gravity",
    account: meta.email || meta.account || "",
    primary,
    bars: [
      gemini && {
        name: "Gemini",
        usedPct: gemini.usedPct,
        remainingPct: gemini.remainingPct,
        color: AG_COLORS.gemini,
        resetHint: gemini.resetHint,
      },
      third && {
        name: "Claude/GPT",
        usedPct: third.usedPct,
        remainingPct: third.remainingPct,
        color: AG_COLORS.thirdParty,
        resetHint: third.resetHint,
      },
    ].filter(Boolean),
    resetHint: primary?.resetHint || null,
    usedPct: primary?.usedPct ?? null,
    remainingPct: primary?.remainingPct ?? null,
  };
}

function prettyProduct(name) {
  const n = String(name || "");
  if (/build/i.test(n)) return "Build";
  if (/imagine/i.test(n)) return "Imagine";
  if (/chat/i.test(n)) return "Chat";
  return n.replace(/^Grok/i, "") || n;
}

function parseGrok(body, meta = {}) {
  const cfg = body?.config || body || {};
  const usedPct = clampPct(Number(cfg.creditUsagePercent ?? cfg.credit_usage_percent));
  const remainingPct = usedPct == null ? null : clampPct(100 - usedPct);
  const periodEnd =
    cfg.currentPeriod?.end || cfg.billingPeriodEnd || cfg.billing_period_end || null;
  const products = Array.isArray(cfg.productUsage || cfg.product_usage)
    ? (cfg.productUsage || cfg.product_usage).map((p, i) => {
        const up = clampPct(Number(p.usagePercent ?? p.usage_percent ?? 0)) ?? 0;
        const colors = [
          GROK_COLORS.build,
          GROK_COLORS.imagine,
          GROK_COLORS.chat,
          GROK_COLORS.other,
        ];
        return {
          name: prettyProduct(p.product || p.name || `P${i + 1}`),
          usedPct: up,
          remainingPct: clampPct(100 - up),
          color: colors[i % colors.length],
        };
      })
    : [];

  return {
    provider: "xai",
    title: "Grok",
    account: meta.email || meta.account || "",
    periodEnd,
    bars: products,
    resetHint: parseResetHint(periodEnd, null),
    usedPct,
    remainingPct,
  };
}

async function fetchAllQuotas(cfg) {
  const filesResp = await cpaGet(cfg.baseUrl, cfg.apiKey, "/auth-files");
  const files = Array.isArray(filesResp?.files) ? filesResp.files : [];

  const agFile =
    files.find(
      (f) => !f.disabled && (f.provider === "antigravity" || f.type === "antigravity")
    ) || null;
  const xaiFile =
    files.find(
      (f) =>
        !f.disabled &&
        (f.provider === "xai" || f.type === "xai" || /xai|grok/i.test(f.name || ""))
    ) || null;

  const result = {
    fetchedAt: new Date().toISOString(),
    antigravity: null,
    grok: null,
    errors: [],
  };

  const jobs = [];

  if (agFile?.auth_index) {
    jobs.push(
      (async () => {
        try {
          const project = agFile.project_id || agFile.projectId || "";
          const resp = await cpaApiCall(cfg.baseUrl, cfg.apiKey, {
            authIndex: agFile.auth_index,
            method: "POST",
            url: "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
            header: {
              Authorization: "Bearer $TOKEN$",
              "Content-Type": "application/json",
              "User-Agent":
                "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
            },
            data: JSON.stringify(project ? { project } : {}),
          });
          result.antigravity = parseAntigravity(parseApiBody(resp), agFile);
        } catch (e) {
          result.errors.push(`AG: ${e.message || e}`);
        }
      })()
    );
  } else {
    result.errors.push("AG: 未找到认证");
  }

  if (xaiFile?.auth_index) {
    jobs.push(
      (async () => {
        try {
          const resp = await cpaApiCall(cfg.baseUrl, cfg.apiKey, {
            authIndex: xaiFile.auth_index,
            method: "GET",
            url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
            header: {
              Authorization: "Bearer $TOKEN$",
              "x-xai-token-auth": "xai-grok-cli",
              "x-grok-client-version": "0.2.91",
              accept: "*/*",
              "user-agent": "grok-pager/0.2.91 grok-shell/0.2.91 (macos; aarch64)",
            },
          });
          result.grok = parseGrok(parseApiBody(resp), xaiFile);
        } catch (e) {
          result.errors.push(`Grok: ${e.message || e}`);
        }
      })()
    );
  } else {
    result.errors.push("Grok: 未找到认证");
  }

  await Promise.all(jobs);
  return result;
}

async function getQuotaData(cfg) {
  const cached = loadCache();
  const now = Date.now();
  if (cached?.data?.fetchedAt) {
    const age = now - new Date(cached.data.fetchedAt).getTime();
    if (
      age >= 0 &&
      age < CACHE_TTL_MS &&
      (cached.data.antigravity || cached.data.grok)
    ) {
      return { data: cached.data, fromCache: true, stale: false };
    }
  }

  try {
    const data = await fetchAllQuotas(cfg);
    saveCache({ savedAt: new Date().toISOString(), data });
    return { data, fromCache: false, stale: false };
  } catch (e) {
    if (cached?.data) return { data: cached.data, fromCache: true, stale: true, error: e };
    throw e;
  }
}

// ---------- Draw ----------
function colorByUsage(usedPct) {
  if (usedPct == null) return THEME.dim;
  if (usedPct >= 95) return THEME.red;
  if (usedPct >= 80) return THEME.orange;
  if (usedPct >= 60) return THEME.yellow;
  return THEME.green;
}

function ringColor(usedPct, preferred) {
  if (usedPct == null) return preferred || THEME.purple;
  if (usedPct >= 95) return THEME.red;
  if (usedPct >= 80) return THEME.orange;
  return preferred || THEME.purple;
}

function drawRingWithLabel(size, usedPct, stroke, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const line = stroke;
  const r = (size - line) / 2;
  const c = new Point(size / 2, size / 2);

  const track = new Path();
  track.addEllipse(new Rect(line / 2, line / 2, size - line, size - line));
  ctx.setStrokeColor(THEME.track);
  ctx.setLineWidth(line);
  ctx.addPath(track);
  ctx.strokePath();

  const pct = usedPct == null ? 0 : Math.max(0, Math.min(100, usedPct)) / 100;
  if (pct > 0.001) {
    const path = new Path();
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * pct;
    const steps = Math.max(18, Math.floor(80 * pct));
    for (let i = 0; i <= steps; i++) {
      const t = start + ((end - start) * i) / steps;
      const x = c.x + r * Math.cos(t);
      const y = c.y + r * Math.sin(t);
      if (i === 0) path.move(new Point(x, y));
      else path.addLine(new Point(x, y));
    }
    ctx.setStrokeColor(color);
    ctx.setLineWidth(line);
    ctx.addPath(path);
    ctx.strokePath();
  }

  const label = usedPct == null ? "—" : `${Math.round(usedPct)}%`;
  ctx.setTextAlignedCenter();
  ctx.setTextColor(THEME.text);
  const fontSize = size >= 100 ? 26 : size >= 80 ? 22 : size >= 64 ? 18 : 15;
  ctx.setFont(Font.boldSystemFont(fontSize));
  const textH = fontSize + 2;
  ctx.drawTextInRect(label, new Rect(0, size / 2 - textH / 2 - 4, size, textH));

  ctx.setFont(Font.mediumSystemFont(Math.max(8, Math.floor(size * 0.12))));
  ctx.setTextColor(THEME.dim);
  ctx.drawTextInRect("已用", new Rect(0, size / 2 + fontSize / 2 - 2, size, 14));

  return ctx.getImage();
}

function drawBar(w, h, usedPct, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const radius = h / 2;
  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, w, h), radius, radius);
  ctx.setFillColor(THEME.track);
  ctx.addPath(bg);
  ctx.fillPath();

  const pct = usedPct == null ? 0 : Math.max(0, Math.min(100, usedPct)) / 100;
  if (pct > 0) {
    const fw = Math.max(h, w * pct);
    const fg = new Path();
    fg.addRoundedRect(new Rect(0, 0, fw, h), radius, radius);
    ctx.setFillColor(color || THEME.purple);
    ctx.addPath(fg);
    ctx.fillPath();
  }
  return ctx.getImage();
}

// ---------- UI helpers ----------
function applyGradient(widget) {
  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [THEME.bgTop, THEME.bgBottom];
  widget.backgroundGradient = g;
}

function t(stack, text, { size = 12, color = THEME.text, weight = "regular", lines = 1, align } = {}) {
  const el = stack.addText(String(text ?? ""));
  el.textColor = color;
  el.lineLimit = lines;
  el.font =
    weight === "bold"
      ? Font.boldSystemFont(size)
      : weight === "semibold"
        ? Font.semiboldSystemFont(size)
        : weight === "medium"
          ? Font.mediumSystemFont(size)
          : Font.systemFont(size);
  if (align === "center") el.centerAlignText();
  if (align === "right") el.rightAlignText();
  return el;
}

function sp(stack, n) {
  if (n == null) stack.addSpacer();
  else stack.addSpacer(n);
}

function pctLabel(v) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v)}%`;
}

function setRefresh(widget) {
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);
}

function addHeader(widget, data, compact = false) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  t(row, "CPA Quota", {
    size: compact ? 11 : 13,
    color: THEME.purple,
    weight: "semibold",
  });
  sp(row);
  const ts = data?.fetchedAt ? formatClock(data.fetchedAt) : "";
  t(row, ts ? `更新 ${ts}` : "", { size: compact ? 9 : 10, color: THEME.dim });
}

function addBarRow(parent, name, usedPct, color, rightText, barW = 90) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const nameT = t(row, name, { size: 10, color: THEME.muted, weight: "medium" });
  nameT.lineLimit = 1;
  nameT.minimumScaleFactor = 0.75;
  // keep labels readable
  try {
    nameT.font = Font.mediumSystemFont(10);
  } catch (_) {}

  sp(row, 6);
  const barImg = row.addImage(drawBar(barW, 6, usedPct, color));
  barImg.imageSize = new Size(barW, 6);
  barImg.resizable = false;
  sp(row, 6);
  t(row, rightText || pctLabel(usedPct), {
    size: 10,
    color: THEME.text,
    weight: "medium",
  });
}

function addChipRow(parent, items) {
  if (!items?.length) return;
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  items.forEach((it, idx) => {
    if (idx > 0) sp(row, 6);
    const chip = row.addStack();
    chip.layoutHorizontally();
    chip.centerAlignContent();
    chip.backgroundColor = new Color("#2A1A40", 0.95);
    chip.cornerRadius = 9;
    chip.setPadding(5, 8, 5, 8);
    const dot = chip.addText("●");
    dot.font = Font.systemFont(7);
    dot.textColor = it.color || THEME.purple;
    sp(chip, 4);
    t(chip, `${it.name} ${pctLabel(it.usedPct)}`, {
      size: 9,
      color: THEME.text,
      weight: "medium",
    });
  });
  sp(row);
}

function addServiceColumn(parent, service, accent, opts = {}) {
  const {
    ringSize = 84,
    stroke = 9,
    barWidth = 96,
    showAccount = false,
    showRemainingText = true,
    compactBars = false,
  } = opts;

  const col = parent.addStack();
  col.layoutVertically();
  col.centerAlignContent();

  if (!service) {
    t(col, "暂无数据", { size: 12, color: THEME.dim, align: "center" });
    return col;
  }

  // title
  const titleRow = col.addStack();
  titleRow.layoutHorizontally();
  titleRow.centerAlignContent();
  sp(titleRow);
  t(titleRow, service.title, { size: 12, color: THEME.muted, weight: "semibold" });
  sp(titleRow);

  sp(col, 8);

  // ring
  const ringRow = col.addStack();
  ringRow.layoutHorizontally();
  sp(ringRow);
  const img = ringRow.addImage(
    drawRingWithLabel(ringSize, service.usedPct, stroke, ringColor(service.usedPct, accent))
  );
  img.imageSize = new Size(ringSize, ringSize);
  sp(ringRow);

  sp(col, 8);

  // used / remaining
  if (showRemainingText) {
    const stats = col.addStack();
    stats.layoutHorizontally();
    stats.centerAlignContent();

    const usedCol = stats.addStack();
    usedCol.layoutVertically();
    usedCol.centerAlignContent();
    t(usedCol, "已用", { size: 9, color: THEME.dim, align: "center" });
    t(usedCol, pctLabel(service.usedPct), {
      size: 13,
      color: THEME.text,
      weight: "bold",
      align: "center",
    });

    sp(stats, 16);

    const remCol = stats.addStack();
    remCol.layoutVertically();
    remCol.centerAlignContent();
    t(remCol, "剩余", { size: 9, color: THEME.dim, align: "center" });
    t(remCol, pctLabel(service.remainingPct), {
      size: 13,
      color: colorByUsage(service.usedPct),
      weight: "bold",
      align: "center",
    });
  }

  if (service.resetHint) {
    sp(col, 6);
    t(col, `重置 ${service.resetHint}`, {
      size: 10,
      color: THEME.dim,
      align: "center",
      lines: 2,
    });
  }

  if (showAccount && service.account) {
    sp(col, 2);
    t(col, service.account, { size: 9, color: THEME.dim, align: "center", lines: 1 });
  }

  const bars = service.bars || [];
  if (bars.length) {
    sp(col, compactBars ? 6 : 10);
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      addBarRow(col, bar.name, bar.usedPct, bar.color, pctLabel(bar.usedPct), barWidth);
      if (i < bars.length - 1) sp(col, 5);
    }
  }

  return col;
}

function addVDivider(parent, h = 140) {
  const d = parent.addStack();
  d.backgroundColor = new Color("#3B2760", 0.8);
  d.size = new Size(1, h);
}

function buildErrorWidget(message) {
  const w = new ListWidget();
  applyGradient(w);
  w.setPadding(16, 16, 16, 16);
  setRefresh(w);
  t(w, "CPA Quota", { size: 14, color: THEME.purple, weight: "semibold" });
  sp(w, 10);
  t(w, message || "加载失败", { size: 12, color: THEME.red, lines: 6 });
  sp(w, 8);
  t(w, "App 内运行脚本可完成配置 / 检查网络与 CPA 地址", {
    size: 10,
    color: THEME.dim,
    lines: 3,
  });
  return w;
}

// ---------- Layouts ----------
function buildSmall(data) {
  const w = new ListWidget();
  applyGradient(w);
  w.setPadding(12, 12, 10, 12);
  setRefresh(w);

  addHeader(w, data, true);
  sp(w, 8);

  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const mk = (title, used, color) => {
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    t(col, title, { size: 10, color: THEME.muted, weight: "medium", align: "center" });
    sp(col, 4);
    const img = col.addImage(drawRingWithLabel(58, used, 7, ringColor(used, color)));
    img.imageSize = new Size(58, 58);
  };

  mk("AG", data.antigravity?.usedPct ?? null, AG_COLORS.main);
  sp(row, 12);
  mk("Grok", data.grok?.usedPct ?? null, GROK_COLORS.main);

  sp(w, 6);
  const parts = [];
  if (data.antigravity?.resetHint) parts.push(`AG ${data.antigravity.resetHint}`);
  if (data.grok?.resetHint) parts.push(`Grok ${data.grok.resetHint}`);
  if (parts.length) t(w, parts.join(" · "), { size: 9, color: THEME.dim, lines: 2 });

  return w;
}

function buildMedium(data) {
  const w = new ListWidget();
  applyGradient(w);
  w.setPadding(12, 14, 10, 14);
  setRefresh(w);

  addHeader(w, data);
  sp(w, 8);

  const body = w.addStack();
  body.layoutHorizontally();
  body.topAlignContent();

  // equal-ish columns via spacers inside each service column
  addServiceColumn(body, data.antigravity, AG_COLORS.main, {
    ringSize: 78,
    stroke: 8,
    barWidth: 86,
    compactBars: true,
  });

  sp(body, 8);
  addVDivider(body, 148);
  sp(body, 8);

  addServiceColumn(body, data.grok, GROK_COLORS.main, {
    ringSize: 78,
    stroke: 8,
    barWidth: 86,
    compactBars: true,
  });

  return w;
}

function buildLarge(data) {
  const w = new ListWidget();
  applyGradient(w);
  w.setPadding(16, 16, 14, 16);
  setRefresh(w);

  addHeader(w, data);
  sp(w, 12);

  const body = w.addStack();
  body.layoutHorizontally();
  body.topAlignContent();

  const leftCard = body.addStack();
  leftCard.layoutVertically();
  leftCard.backgroundColor = THEME.card;
  leftCard.cornerRadius = 18;
  leftCard.setPadding(14, 12, 14, 12);
  addServiceColumn(leftCard, data.antigravity, AG_COLORS.main, {
    ringSize: 104,
    stroke: 11,
    barWidth: 110,
    showAccount: true,
  });
  // per-bar reset under AG
  if (data.antigravity?.bars?.length) {
    sp(leftCard, 8);
    for (const bar of data.antigravity.bars) {
      if (!bar.resetHint) continue;
      t(leftCard, `${bar.name} · ${bar.resetHint}`, {
        size: 9,
        color: THEME.dim,
        align: "center",
      });
      sp(leftCard, 2);
    }
  }

  sp(body, 12);

  const rightCard = body.addStack();
  rightCard.layoutVertically();
  rightCard.backgroundColor = THEME.card;
  rightCard.cornerRadius = 18;
  rightCard.setPadding(14, 12, 14, 12);
  addServiceColumn(rightCard, data.grok, GROK_COLORS.main, {
    ringSize: 104,
    stroke: 11,
    barWidth: 110,
    showAccount: true,
  });

  sp(w, 12);

  // footer chips like the reference image
  const chips = [];
  for (const bar of data.antigravity?.bars || []) {
    chips.push({ name: bar.name, usedPct: bar.usedPct, color: bar.color });
  }
  if (data.grok) {
    chips.push({ name: "Grok", usedPct: data.grok.usedPct, color: GROK_COLORS.main });
    for (const bar of (data.grok.bars || []).slice(0, 2)) {
      chips.push({ name: bar.name, usedPct: bar.usedPct, color: bar.color });
    }
  }
  if (chips.length) addChipRow(w, chips.slice(0, 5));

  if (data.errors?.length) {
    sp(w, 8);
    t(w, data.errors.join(" · "), { size: 9, color: THEME.orange, lines: 2 });
  }

  return w;
}

function buildAccessory(data) {
  const w = new ListWidget();
  setRefresh(w);
  const line = `AG ${pctLabel(data?.antigravity?.usedPct)} · Grok ${pctLabel(data?.grok?.usedPct)}`;
  const el = w.addText(line);
  el.font = Font.mediumSystemFont(11);
  el.textColor = THEME.text;
  el.centerAlignText();
  return w;
}

function chooseBuilder() {
  const f = config.widgetFamily;
  if (f === "small") return buildSmall;
  if (f === "large" || f === "extraLarge") return buildLarge;
  if (
    f === "accessoryCircular" ||
    f === "accessoryRectangular" ||
    f === "accessoryInline"
  ) {
    return buildAccessory;
  }
  return buildMedium;
}

// ---------- Main ----------
async function main() {
  let cfg = readConfig();
  cfg = await ensureConfigInteractive(cfg);

  if (!cfg.apiKey) {
    const w = buildErrorWidget(
      "缺少 API Key。请在 App 内运行脚本配置，或在小组件参数中填写 apiKey。"
    );
    if (config.runsInWidget) Script.setWidget(w);
    else await w.presentMedium();
    return;
  }

  try {
    const { data, stale, error } = await getQuotaData(cfg);
    if (stale && error) {
      data.errors = [`缓存: ${error.message || error}`, ...(data.errors || [])];
    }

    if (!config.runsInWidget) {
      const alert = new Alert();
      alert.title = "CPA Quota";
      const ag = data.antigravity
        ? `Anti Gravity 已用 ${pctLabel(data.antigravity.usedPct)} / 剩余 ${pctLabel(data.antigravity.remainingPct)}`
        : "Anti Gravity —";
      const gk = data.grok
        ? `Grok 已用 ${pctLabel(data.grok.usedPct)} / 剩余 ${pctLabel(data.grok.remainingPct)}`
        : "Grok —";
      const extra = (data.errors || []).join("\n");
      alert.message = `${ag}\n${gk}\n更新: ${formatClock(data.fetchedAt) || "-"}${
        extra ? `\n\n${extra}` : ""
      }`;
      alert.addAction("预览 Small");
      alert.addAction("预览 Medium");
      alert.addAction("预览 Large");
      alert.addAction("重新配置");
      alert.addCancelAction("完成");
      const i = await alert.present();
      if (i === 0) await buildSmall(data).presentSmall();
      else if (i === 1) await buildMedium(data).presentMedium();
      else if (i === 2) await buildLarge(data).presentLarge();
      else if (i === 3) {
        if (Keychain.contains(KEYCHAIN_BASE)) Keychain.remove(KEYCHAIN_BASE);
        if (Keychain.contains(KEYCHAIN_KEY)) Keychain.remove(KEYCHAIN_KEY);
        cfg = await ensureConfigInteractive({ baseUrl: cfg.baseUrl, apiKey: "" });
        if (cfg.apiKey) {
          const fresh = await getQuotaData(cfg);
          await buildMedium(fresh.data).presentMedium();
        }
      }
      return;
    }

    Script.setWidget(chooseBuilder()(data));
  } catch (e) {
    console.error(e);
    const w = buildErrorWidget(String(e.message || e));
    if (config.runsInWidget) Script.setWidget(w);
    else await w.presentMedium();
  }
}

await main();
Script.complete();

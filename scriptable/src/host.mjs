// ---------- Scriptable host ----------
const CONFIG_KEY = "xp-toolkit.ai-quota.scriptable.config.v1";
const REFRESH_ACTION = "refresh-quota";
const FAMILIES = ["small", "medium", "large", "extraLarge", "extraLargePortrait",
  "accessoryRectangular", "accessoryInline", "accessoryCircular"];
const SERVICES = [["chatgpt", "ChatGPT"], ["gemini", "Gemini"]];
const SHORT_NAME = { chatgpt: "GPT", gemini: "Gemini" };
const REFRESH_MS = 15 * 60 * 1000;

async function loadJSON(url, opts = {}) {
  const request = new Request(url);
  request.method = opts.method || "GET";
  request.headers = { Accept: "application/json", "User-Agent": UA, ...opts.headers };
  if (opts.body != null) request.body = JSON.stringify(opts.body);
  request.timeoutInterval = 8;
  // Credentials belong to the configured management origin, not a redirect target.
  request.onRedirect = () => null;
  let text;
  try {
    text = await request.loadString();
  } catch (_) {
    if (!request.response?.statusCode) throw new Error("连接失败或超时");
  }
  const statusCode = request.response?.statusCode;
  if (!(statusCode >= 200 && statusCode < 300)) {
    const message = statusCode >= 300 && statusCode < 400 ? "CPA 管理地址发生重定向"
      : statusCode === 401 || statusCode === 403 ? "CPA 密钥无效或没有权限"
        : statusCode ? `CPA HTTP ${statusCode}` : "连接失败或超时";
    throw new Error(message);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("CPA 返回了无效 JSON");
  }
}

// The shared fetchers use this for user-facing errors. Never show upstream bodies,
// exception messages or account data returned as part of an error.
function friendlyHttpError(error) {
  if (error.statusCode === 401 || error.statusCode === 403) return "上游账号授权失败";
  if (error.statusCode === 429) return "上游请求太频繁";
  const message = String(error.message || "");
  if (["连接失败或超时", "CPA 密钥无效或没有权限", "CPA 管理地址发生重定向", "CPA 返回了无效 JSON"].includes(message)
    || /^CPA HTTP \d{3}$/.test(message)) return message;
  return "账号或额度暂不可用";
}

function readConfig() {
  if (!Keychain.contains(CONFIG_KEY)) return null;
  const cfg = JSON.parse(Keychain.get(CONFIG_KEY));
  if (!cfg || typeof cfg.cpaApiKey !== "string" || !cfg.cpaApiKey.trim()
    || !/^[\da-f-]{36}$/i.test(cfg.scope)) return null;
  const cpaBaseUrl = normalizeCpaBaseUrl(cfg.cpaBaseUrl);
  return cpaBaseUrl ? { ...cfg, cpaBaseUrl } : null;
}

function cachePath(fm, cfg) {
  return fm.joinPath(fm.libraryDirectory(), `xp-ai-quota-${cfg.scope}.json`);
}

function readCache(cfg) {
  try {
    const fm = FileManager.local();
    const path = cachePath(fm, cfg);
    if (!fm.fileExists(path)) return null;
    const entry = JSON.parse(fm.readString(path));
    return entry?.scope === cfg.scope && Number.isFinite(entry.checkedAt) && entry.services ? entry : null;
  } catch (_) {
    return null;
  }
}

function removeCache(cfg) {
  if (!cfg) return;
  const fm = FileManager.local();
  const path = cachePath(fm, cfg);
  if (fm.fileExists(path)) fm.remove(path);
}

async function loadQuota(cfg, force = false) {
  if (!cfg) return { state: "未配置", services: {} };
  const cached = readCache(cfg);
  const age = Date.now() - (cached?.checkedAt ?? 0);
  if (!force && cached && age >= 0 && age < CACHE_TTL_MS) return cached;

  const data = await fetchAll(cfg);
  if (readConfig()?.scope !== cfg.scope) return { state: "配置已变更", services: {} };
  const checkedAt = Date.now();
  const previous = readCache(cfg) ?? cached;
  const services = {};
  let freshCount = 0;
  let displayCount = 0;
  for (const [id] of SERVICES) {
    const result = data[id];
    if (result?.ok && Number.isFinite(result.remainingPct)) {
      const { warnings, ...quota } = result;
      services[id] = { ...quota, at: Date.parse(data.fetchedAt), partial: Boolean(warnings?.length) };
      freshCount++;
      displayCount++;
    } else if (previous?.services[id]?.ok) {
      services[id] = { ...previous.services[id], stale: true };
      displayCount++;
    }
  }
  const partial = Object.values(services).some((service) => service.partial);
  const state = freshCount === SERVICES.length && !partial ? "已更新" : freshCount ? "部分更新" : displayCount ? "缓存" : "暂不可用";
  const note = data.errors.find((message) => message.startsWith("CPA: "))?.slice(5);
  const snapshot = { scope: cfg.scope, checkedAt, state, services, freshCount, note };
  // Cache failed attempts too so the post-action render doesn't immediately fetch
  // again; the displayed timestamps above belong to each successful fetch only.
  try {
    const fm = FileManager.local();
    fm.writeString(cachePath(fm, cfg), JSON.stringify(snapshot));
  } catch (_) {
    return { ...snapshot, state: "缓存写入失败" };
  }
  return snapshot;
}

function ink() { return Color.dynamic(new Color("172034"), new Color("eef2ff")); }
function muted() { return Color.dynamic(new Color("556077"), new Color("a9b6cb")); }
function accent(id, pct) {
  if (pct <= 15) return Color.dynamic(new Color("b91c1c"), new Color("fda4af"));
  if (pct <= 35) return Color.dynamic(new Color("a04d04"), new Color("fcd34d"));
  const pairs = { chatgpt: ["047857", "6ee7b7"], gemini: ["254bc7", "93c5fd"] };
  const [light, dark] = pairs[id];
  return Color.dynamic(new Color(light), new Color(dark));
}

function text(parent, value, size, color = ink(), bold = false) {
  const node = parent.addText(value);
  node.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  node.textColor = color;
  node.lineLimit = 1;
  node.minimumScaleFactor = 0.75;
  return node;
}

function dateLabel(parent, ms, clock = false) {
  const node = parent.addDate(new Date(ms));
  if (clock) node.applyTimeStyle();
  else node.applyRelativeStyle();
  node.font = Font.systemFont(9);
  node.textColor = muted();
  node.lineLimit = 1;
  node.minimumScaleFactor = 0.75;
}

function bar(parent, id, pct, width, style = "linear") {
  if (!Number.isFinite(pct)) return;
  const color = accent(id, pct);
  const track = Color.dynamic(new Color("e1e8f2"), new Color("354157"));
  if (typeof parent.addProgress === "function") {
    const progress = parent.addProgress(pct, { style, progressColor: color, trackColor: track, thickness: 4 });
    progress.size = new Size(width, style === "linear" ? 4 : width);
    return progress;
  }
  // Older Scriptable: a linear stack still shows the actual fill, including 0%.
  if (style !== "linear") return null;
  const line = parent.addStack();
  line.size = new Size(width, 4);
  line.backgroundColor = track;
  line.cornerRadius = 2;
  if (pct > 0) {
    const fill = line.addStack();
    fill.size = new Size(width * pct / 100, 4);
    fill.backgroundColor = color;
    fill.cornerRadius = 2;
  }
  line.addSpacer();
}

function resetLine(parent, caption, at, hint) {
  const fallback = Number.isFinite(at) ? "待确认" : hint;
  const row = parent.addStack();
  row.centerAlignContent();
  row.spacing = 3;
  text(row, caption, 9, muted());
  if (at > Date.now()) dateLabel(row, at);
  else if (fallback) text(row, fallback, 9, muted());
}

function serviceLabel(name, quota) {
  return name + (quota?.stale ? " · 缓存" : quota?.partial ? " · 部分" : "");
}

function addColumn(parent, id, name, quota, accessory = false) {
  const col = parent.addStack();
  col.layoutVertically();
  col.spacing = accessory ? 1 : 4;
  text(col, accessory ? (SHORT_NAME[id] + (quota?.stale ? "*" : ""))
    : serviceLabel(name, quota), accessory ? 10 : 12, muted(), true);
  const pct = quota?.remainingPct;
  text(col, Number.isFinite(pct) ? `${pctLabel(pct)}%` : "—", accessory ? 15 : 25,
    Number.isFinite(pct) ? accent(id, pct) : muted(), true);
  bar(col, id, pct, accessory ? 52 : 92);
  if (!accessory) {
    if (!quota) text(col, "暂无数据", 9, muted());
    else resetLine(col, "重置", quota.resetAt, quota.resetHint);
    if (Number.isFinite(quota?.remaining5hPct)) {
      resetLine(col, `5h ${pctLabel(quota.remaining5hPct)}%`, quota.reset5hAt, quota.reset5hHint);
    }
  }
  return col;
}

function addSmallRow(parent, id, name, quota) {
  const row = parent.addStack();
  row.centerAlignContent();
  const left = row.addStack();
  left.layoutVertically();
  text(left, serviceLabel(name, quota), 11, ink(), true);
  const pct = quota?.remainingPct;
  if (Number.isFinite(quota?.remaining5hPct)) {
    resetLine(left, `5h ${pctLabel(quota.remaining5hPct)}%`, quota.reset5hAt, quota.reset5hHint);
  } else if (quota) resetLine(left, "重置", quota.resetAt, quota.resetHint);
  row.addSpacer(4);
  row.addSpacer();
  const right = row.addStack();
  right.layoutVertically();
  right.spacing = 2;
  const value = text(right, Number.isFinite(pct) ? `${pctLabel(pct)}%` : "—", 14,
    Number.isFinite(pct) ? accent(id, pct) : muted(), true);
  value.rightAlignText();
  bar(right, id, pct, 35);
}

function addAccounts(parent, snapshot, limit) {
  const groups = SERVICES.map(([id, name]) => (snapshot.services[id]?.accountDetails || []).map((detail) => ({ id, name, detail })));
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  if (!total) return;
  parent.addSpacer(3);
  text(parent, total > limit ? `账号明细（显示 ${limit}/${total}）` : "账号明细", 10, muted(), true);
  // Interleave providers so a long account list never pushes other providers out.
  const details = [];
  for (let i = 0; details.length < Math.min(total, limit); i++) {
    for (const group of groups) if (group[i] && details.length < limit) details.push(group[i]);
  }
  for (const { id, name, detail } of details) {
    const row = parent.addStack();
    row.centerAlignContent();
    row.spacing = 4;
    text(row, `${name} · ${detail.name}`, 10, muted());
    row.addSpacer();
    if (Number.isFinite(detail.remaining5hPct)) text(row, `5h ${pctLabel(detail.remaining5hPct)}%`, 9, muted());
    if (detail.resetAt > Date.now()) dateLabel(row, detail.resetAt);
    const pct = detail.remainingPct;
    text(row, `${pctLabel(pct)}%`, 11, accent(id, pct), true);
  }
}

function renderWidget(snapshot, family, parameter = "", configured = true) {
  const widget = new ListWidget();
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MS);
  const state = snapshot.state;
  const services = snapshot.services;
  if (family === "accessoryInline") {
    const summary = SERVICES.map(([id]) => {
      const service = services[id];
      const label = SHORT_NAME[id];
      return `${label}${service?.stale ? "*" : ""} ${Number.isFinite(service?.remainingPct) ? `${pctLabel(service.remainingPct)}%` : "—"}`;
    });
    widget.addText(configured ? summary.join(" · ") : "AI Quota · 未配置");
    return widget;
  }
  if (family === "accessoryCircular") {
    const selected = SERVICES.find(([id]) => id === String(parameter).trim().toLowerCase());
    const available = SERVICES.filter(([id]) => Number.isFinite(services[id]?.remainingPct));
    available.sort(([a], [b]) => services[a].remainingPct - services[b].remainingPct);
    const [id] = selected || available[0] || SERVICES[0];
    const service = services[id];
    if (Number.isFinite(service?.remainingPct)) {
      const ring = bar(widget, id, service.remainingPct, 36, "circular");
      if (ring) text(ring, `${pctLabel(service.remainingPct)}%${service.stale ? "*" : ""}`, 10, ink(), true);
      else text(widget, `${pctLabel(service.remainingPct)}%`, 15, ink(), true);
      text(widget, SHORT_NAME[id], 8, muted(), true);
    } else text(widget, "AI —", 12, muted(), true);
    return widget;
  }
  if (family === "accessoryRectangular") {
    const row = widget.addStack();
    SERVICES.forEach(([id, name], i) => {
      if (i > 0) row.addSpacer();
      addColumn(row, id, name, services[id], true);
    });
    text(widget, state, 9, muted());
    return widget;
  }

  const small = family === "small";
  widget.backgroundColor = Color.dynamic(new Color("f5f8ff"), new Color("141c2c"));
  widget.setPadding(small ? 10 : 12, small ? 10 : 13, small ? 10 : 12, small ? 10 : 13);
  const panel = widget.addStack();
  panel.layoutVertically();
  panel.spacing = small ? 4 : 5;
  const header = panel.addStack();
  header.centerAlignContent();
  header.spacing = 4;
  text(header, "AI Quota", small ? 12 : 14, ink(), true);
  header.addSpacer();
  text(header, state, 9, muted());
  const at = Math.max(...Object.values(services).map((s) => s.at), 0);
  if (at) dateLabel(header, at, small);
  if (!configured) {
    text(panel, "请在 Scriptable 中运行脚本填写 CPA", 11, muted());
    widget.url = URLScheme.forRunningScript();
    return widget;
  }
  // On current Scriptable the card itself is the in-place refresh target.
  if (typeof panel.setAction === "function") {
    panel.setAction("刷新 AI 余量", { id: REFRESH_ACTION });
    text(header, "↻", 12, muted(), true);
  } else if (typeof header.addButton === "function") {
    header.addButton("刷新", { id: REFRESH_ACTION });
  } else {
    widget.url = URLScheme.forRunningScript();
  }

  panel.addSpacer();
  if (small) {
    SERVICES.forEach(([id, name], i) => {
      if (i > 0) panel.addSpacer();
      addSmallRow(panel, id, name, services[id]);
    });
  } else {
    const row = panel.addStack();
    row.topAlignContent();
    SERVICES.forEach(([id, name], i) => {
      if (i > 0) row.addSpacer();
      addColumn(row, id, name, services[id]);
    });
    if (family === "large" || family.startsWith("extraLarge")) addAccounts(panel, snapshot, family === "large" ? 5 : 8);
  }
  panel.addSpacer();
  if (snapshot.note && !small) text(panel, snapshot.note, 9, muted());
  return widget;
}

async function message(title, body) {
  const alert = new Alert();
  alert.title = title;
  alert.message = body;
  alert.addAction("好");
  await alert.presentAlert();
}

async function editConfig(previous) {
  const alert = new Alert();
  alert.title = "配置 CPA";
  alert.message = "仅填管理协议、主机和端口。公网请使用 HTTPS。旧密钥不会显示；同一地址留空则保留原密钥。";
  alert.addTextField("https://cpa.example:50442", previous?.cpaBaseUrl || "");
  alert.addSecureTextField("CPA 管理 API Key");
  alert.addAction("保存");
  alert.addCancelAction("取消");
  if (await alert.presentAlert() !== 0) return;
  let cpaBaseUrl;
  try {
    cpaBaseUrl = normalizeCpaBaseUrl(alert.textFieldValue(0));
  } catch (error) {
    return message("地址未保存", error.message);
  }
  const cpaApiKey = alert.textFieldValue(1).trim() || (cpaBaseUrl === previous?.cpaBaseUrl ? previous.cpaApiKey : "");
  if (!cpaBaseUrl || !cpaApiKey) return message("配置未保存", "请输入 CPA 地址和管理 Key；修改地址时必须重新输入 Key。");
  if (cpaBaseUrl !== previous?.cpaBaseUrl || cpaApiKey !== previous?.cpaApiKey) {
    Keychain.set(CONFIG_KEY, JSON.stringify({ cpaBaseUrl, cpaApiKey, scope: UUID.string() }));
    removeCache(previous);
  }
  await message("配置已保存", "再运行脚本可测试连接或预览组件；桌面组件会使用新配置。旧组件快照可能会保留到系统重新渲染。");
}

async function runInApp(cfg) {
  if (!cfg) return editConfig(null);
  const menu = new Alert();
  menu.title = "AI Quota";
  menu.message = "检查 CPA 连接、预览小组件或修改配置。";
  const actions = ["测试连接并刷新", "预览小号", "预览中号", "预览大号", "修改 CPA 配置", "清除配置和缓存"];
  actions.forEach((label) => menu.addAction(label));
  menu.addCancelAction("取消");
  const action = await menu.presentAlert();
  if (action === 0) {
    const snapshot = await loadQuota(cfg, true);
    return message(snapshot.state, snapshot.note || `成功读取 ${snapshot.freshCount ?? 0}/${SERVICES.length} 个服务。`);
  }
  if (action >= 1 && action <= 3) {
    const family = FAMILIES[action - 1];
    const widget = renderWidget(await loadQuota(cfg), family);
    await widget[`present${family[0].toUpperCase()}${family.slice(1)}`]();
  }
  if (action === 4) return editConfig(cfg);
  if (action === 5) {
    const confirm = new Alert();
    confirm.title = "清除 CPA 配置和本机缓存？";
    confirm.addDestructiveAction("清除");
    confirm.addCancelAction("取消");
    if (await confirm.presentAlert() === 0) {
      removeCache(cfg);
      Keychain.remove(CONFIG_KEY);
    }
  }
}

async function main() {
  const cfg = readConfig();
  if (args.widgetAction?.id === REFRESH_ACTION) {
    // The action and the subsequent render are separate Scriptable runs.
    await loadQuota(cfg, true);
    return;
  }
  if (args.widgetAction) return;
  if (config.runsInWidget) {
    const family = FAMILIES.includes(config.widgetFamily) ? config.widgetFamily : "medium";
    Script.setWidget(renderWidget(await loadQuota(cfg), family, args.widgetParameter, Boolean(cfg)));
  } else if (config.runsInApp) {
    await runInApp(cfg);
  }
}

try {
  await main();
} catch (_) {
  if (args.widgetAction?.id === REFRESH_ACTION) throw new Error("AI Quota 刷新失败");
  if (config.runsInWidget) {
    const widget = new ListWidget();
    widget.addText("AI Quota 暂不可用");
    widget.refreshAfterDate = new Date(Date.now() + REFRESH_MS);
    Script.setWidget(widget);
  } else if (config.runsInApp) {
    await message("AI Quota 暂不可用", "请检查 Scriptable 本机存储权限后重试。");
  }
} finally {
  Script.complete();
}

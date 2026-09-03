// ==UserScript==
// @name         xptoolkit - Synapse usage log performance
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      1.4.2
// @description  Dual-column gpt-5.6-sol(Codex) / claude-opus-5(Claude) performance with per-card group switchers
// @author       xp9477
// @match        https://synapse-ai.uk/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=synapse-ai.uk
// @run-at       document-start
// @inject-into  page
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MODEL_CONFIGS = [
    { model: 'gpt-5.6-sol', tokenName: 'Codex' },
    { model: 'claude-opus-5', tokenName: 'Claude' }
  ];
  const MODELS = MODEL_CONFIGS.map((item) => item.model);
  const MODEL = MODELS[0];
  const TARGET_PATH = /^\/usage-logs\/common\/?$/;
  const PANEL_ID = 'xpt-synapse-model-performance';
  const FRAME_ID = 'xpt-synapse-pricing-frame';
  const STYLE_VERSION = '1.4.2';
  const STYLE_ID = 'xpt-synapse-performance-style';
  const COLLAPSE_KEY = 'xpt-synapse-perf-collapsed';
  const PAGE_RELOAD_MS = 2 * 60 * 1000;
  const TEXT = {
    title: '\u5404\u5206\u7ec4\u6027\u80fd',
    synced: MODEL_CONFIGS.map((item) => `${item.model} / ${item.tokenName}`).join(' \u00b7 '),
    refresh: '\u5237\u65b0',
    refreshing: '\u8bfb\u53d6\u4e2d\u2026',
    loading: '\u6b63\u5728\u8bfb\u53d6\u6027\u80fd\u6570\u636e\u2026',
    source: '\u6765\u6e90',
    pricing: '\u4ef7\u683c\u9875',
    api: '\u6027\u80fd\u63a5\u53e3',
    updated: '\u6700\u8fd1\u66f4\u65b0',
    failed: '\u8bfb\u53d6\u5931\u8d25',
    retry: '\u53ef\u70b9\u51fb\u201c\u5237\u65b0\u201d\u91cd\u8bd5',
    group: '\u5206\u7ec4',
    ratio: '\u500d\u7387',
    successRate: '\u6210\u529f\u7387',
    throughput: 'TPS',
    uptime: '30 \u5929\u53ef\u7528\u7387',
    collapse: '\u6298\u53e0',
    expand: '\u5c55\u5f00',
    tokenCurrent: '\u5f53\u524d\u5206\u7ec4',
    tokenLoading: '\u8bfb\u53d6\u4e2d\u2026',
    tokenMissing: '\u672a\u627e\u5230\u5bc6\u94a5',
    tokenSwitch: '\u5207\u6362',
    tokenSwitching: '\u5207\u6362\u4e2d\u2026',
    tokenSwitched: '\u5df2\u5207\u6362',
    tokenFailed: '\u5bc6\u94a5\u8bfb\u53d6\u5931\u8d25',
    tokenUpdateFailed: '\u5207\u6362\u5931\u8d25',
    selectGroup: '\u5206\u7ec4'
  };

  let pageReloadTimer = 0;
  let routeTimer = 0;
  let loadingPromise = null;
  /** @type {Record<string, any>} */
  const tokenCacheByModel = Object.create(null);
  /** @type {Record<string, boolean>} */
  const tokenSwitchingByModel = Object.create(null);
  /** @type {Record<string, { value: string, label: string, ratio: number|null }[]>} */
  const groupOptionsByModel = Object.create(null);

  function getModelConfig(model) {
    return MODEL_CONFIGS.find((item) => item.model === model) || null;
  }

  function stripAnnouncements(value) {
    if (!value || typeof value !== 'object') return value;
    const candidates = [value, value.data, value.status, value.data?.status]
      .filter((item) => item && typeof item === 'object');
    candidates.forEach((status) => {
      if (
        Object.prototype.hasOwnProperty.call(status, 'announcements') ||
        Object.prototype.hasOwnProperty.call(status, 'announcements_enabled')
      ) {
        status.announcements = [];
        status.announcements_enabled = false;
      }
    });
    return value;
  }

  const nativeJSONParse = JSON.parse.bind(JSON);
  // 只修改已捕获的 /api/status 响应；不要污染站点全局 JSON.parse。
  if (typeof window.fetch === 'function') {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function xptFetch(input, init) {
      const response = await nativeFetch(input, init);
      let pathname = '';
      try {
        pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      } catch (_) {
        return response;
      }
      if (pathname !== '/api/status') return response;

      try {
        const payload = stripAnnouncements(nativeJSONParse(await response.clone().text()));
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(JSON.stringify(payload), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      } catch (_) {
        return response;
      }
    };
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isAnnouncementTitle(value) {
    const title = cleanText(value).toLowerCase();
    return [
      'system announcement',
      'system announcements',
      'announcement',
      'announcements',
      '\u7cfb\u7edf\u516c\u544a',
      '\u7cfb\u7d71\u516c\u544a'
    ].includes(title);
  }

  // DOM fallback in case the announcement payload was parsed before the hook.
  function removeAnnouncementDialogs(root) {
    const headings = root.querySelectorAll?.(
      '[role="dialog"] h1,[role="dialog"] h2,[role="dialog"] h3,' +
      '[role="dialog"] [role="heading"],[role="dialog"] [data-slot="dialog-title"]'
    );
    if (!headings) return;

    headings.forEach((heading) => {
      if (!isAnnouncementTitle(heading.textContent)) return;
      const dialog = heading.closest('[role="dialog"]');
      if (!dialog) return;
      dialog.querySelector(
        'button[aria-label*="close" i],button[aria-label*="\u5173\u95ed"],' +
        'button[data-slot="dialog-close"]'
      )?.click();
      queueMicrotask(() => {
        if (!dialog.isConnected) return;
        const portal = dialog.closest('[data-radix-portal]');
        if (portal) portal.remove();
        else dialog.remove();
      });
    });
  }

  function isCollapsed() {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setCollapsed(collapsed) {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch (_) {}
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.toggle('is-collapsed', collapsed);
    const toggle = panel.querySelector('.xpt-collapse');
    if (toggle) toggle.textContent = collapsed ? TEXT.expand : TEXT.collapse;
  }

  function injectStyles() {
    const existing = document.getElementById(STYLE_ID);
    if (existing?.dataset.version === STYLE_VERSION) return;
    existing?.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.dataset.version = STYLE_VERSION;
    style.textContent = `
      html.xpt-usage-logs-page,html.xpt-usage-logs-page body{min-height:100%;overflow-y:auto!important}
      html.xpt-usage-logs-page body [data-sidebar-inset],
      html.xpt-usage-logs-page body [data-slot="sidebar-inset"]{height:auto!important;min-height:100dvh;overflow:visible!important}
      html.xpt-usage-logs-page main{height:auto!important;max-height:none!important;min-height:0!important;overflow:visible!important;flex:1 1 auto!important}
      html.xpt-usage-logs-page main > div{height:auto!important;max-height:none!important;min-height:0!important;overflow:visible!important}
      #${PANEL_ID}{position:relative;z-index:1;flex:0 0 auto;width:100%;max-height:min(46vh,460px);box-sizing:border-box;margin:0 0 12px;border:1px solid hsl(var(--border,214 32% 91%));border-radius:12px;background:hsl(var(--card,0 0% 100%));color:hsl(var(--card-foreground,222 47% 11%));box-shadow:0 1px 2px rgb(0 0 0/.05);display:flex;flex-direction:column;overflow:hidden}
      #${PANEL_ID}.is-collapsed{max-height:none}
      #${PANEL_ID} .xpt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;border-bottom:1px solid hsl(var(--border,214 32% 91%));flex:0 0 auto}
      #${PANEL_ID} .xpt-title{display:flex;align-items:baseline;gap:6px;min-width:0;flex-wrap:wrap}
      #${PANEL_ID} .xpt-title strong{font-size:14px;line-height:1.2}
      #${PANEL_ID} .xpt-title span,#${PANEL_ID} .xpt-meta,#${PANEL_ID} .xpt-status,#${PANEL_ID} .xpt-token-label,#${PANEL_ID} .xpt-token-msg,#${PANEL_ID} .xpt-card-error{color:hsl(var(--muted-foreground,215 16% 47%));font-size:11px}
      #${PANEL_ID} .xpt-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}
      #${PANEL_ID} .xpt-refresh,#${PANEL_ID} .xpt-collapse,#${PANEL_ID} .xpt-token-apply{height:24px;padding:0 9px;border:1px solid hsl(var(--border,214 32% 91%));border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:11px}
      #${PANEL_ID} .xpt-refresh:hover,#${PANEL_ID} .xpt-collapse:hover,#${PANEL_ID} .xpt-token-apply:hover{background:hsl(var(--accent,210 40% 96%))}
      #${PANEL_ID} .xpt-refresh:disabled,#${PANEL_ID} .xpt-collapse:disabled{cursor:wait;opacity:.55}
      #${PANEL_ID} .xpt-body{padding:8px 10px 6px;overflow:auto;min-height:0;flex:1 1 auto}
      #${PANEL_ID}.is-collapsed .xpt-body{display:none}
      #${PANEL_ID} .xpt-status{min-height:22px;display:flex;align-items:center}
      #${PANEL_ID} .xpt-meta{margin-top:6px;padding-top:4px;border-top:1px dashed hsl(var(--border,214 32% 91%));text-align:right;flex:0 0 auto}
      #${PANEL_ID} .xpt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:stretch}
      #${PANEL_ID} .xpt-card{min-width:0;border:1px solid hsl(var(--border,214 32% 84%));border-radius:10px;overflow:hidden;background:hsl(var(--background,0 0% 100%));display:flex;flex-direction:column}
      #${PANEL_ID} .xpt-card-head{padding:6px 8px;border-bottom:1px solid hsl(var(--border,214 32% 91%));background:hsl(var(--muted,210 40% 96%))}
      #${PANEL_ID} .xpt-card-title-row{display:flex;align-items:center;gap:10px;min-width:0}
      #${PANEL_ID} .xpt-card-title{font-size:12px;font-weight:700;line-height:1.25;flex:0 1 auto;min-width:0;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${PANEL_ID} .xpt-card-token{display:flex;align-items:center;gap:0;min-width:0;flex:1 1 auto;justify-content:flex-end}
      #${PANEL_ID} .xpt-card-token-current-block{display:flex;align-items:center;gap:4px;min-width:0;max-width:46%;margin-right:12px}
      #${PANEL_ID} .xpt-card-token-label{font-size:11px;color:hsl(var(--muted-foreground,215 16% 47%));white-space:nowrap;flex:0 0 auto}
      #${PANEL_ID} .xpt-card-token-current{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${PANEL_ID} .xpt-card-token-switch{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding-left:12px;border-left:1px solid hsl(var(--border,214 32% 84%))}
      #${PANEL_ID} .xpt-card-token-select{height:26px;width:148px;max-width:28vw;padding:0 6px;border:1px solid hsl(var(--border,214 32% 91%));border-radius:6px;background:hsl(var(--card,0 0% 100%));color:inherit;font-size:11px}
      #${PANEL_ID} .xpt-card-token-apply{height:26px;padding:0 9px;border:1px solid transparent;border-radius:6px;background:hsl(var(--primary,222 47% 11%));color:hsl(var(--primary-foreground,210 40% 98%));cursor:pointer;font-size:11px;white-space:nowrap}
      #${PANEL_ID} .xpt-card-token-apply:hover{opacity:.92}
      #${PANEL_ID} .xpt-card-token-apply:disabled,#${PANEL_ID} .xpt-card-token-select:disabled{cursor:wait;opacity:.55}
      #${PANEL_ID} .xpt-card-token-msg{display:none;font-size:10px;color:hsl(var(--muted-foreground,215 16% 47%));margin-left:8px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${PANEL_ID} .xpt-card-token-msg:not(:empty){display:inline}
      #${PANEL_ID} .xpt-card-token-msg.xpt-ok{color:#059669}
      #${PANEL_ID} .xpt-card-token-msg.xpt-err{color:#e11d48}
      #${PANEL_ID} .xpt-card-body{padding:0;overflow-x:auto;flex:1 1 auto}
      #${PANEL_ID} .xpt-card-error{padding:12px 10px;line-height:1.4}
      #${PANEL_ID} .xpt-clone{min-width:0;font-size:12px;line-height:1.15}
      #${PANEL_ID} .xpt-clone table,#${PANEL_ID} .xpt-table{width:100%!important;min-width:0;table-layout:fixed;border-collapse:collapse}
      #${PANEL_ID} .xpt-clone th,#${PANEL_ID} .xpt-clone td,#${PANEL_ID} .xpt-table th,#${PANEL_ID} .xpt-table td{height:auto!important;min-height:0!important;padding:4px 8px!important;line-height:1.25!important;font-size:12px!important;vertical-align:middle}
      #${PANEL_ID} .xpt-table th,#${PANEL_ID} .xpt-table td{border-bottom:1px solid hsl(var(--border,214 32% 91%));text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #${PANEL_ID} .xpt-table th{color:hsl(var(--muted-foreground,215 16% 47%));background:hsl(var(--muted,210 40% 96%));font-weight:600}
      #${PANEL_ID} .xpt-table th:nth-child(1),#${PANEL_ID} .xpt-table td:nth-child(1){width:30%}
      #${PANEL_ID} .xpt-table th:nth-child(2),#${PANEL_ID} .xpt-table td:nth-child(2){width:14%}
      #${PANEL_ID} .xpt-table th:nth-child(3),#${PANEL_ID} .xpt-table td:nth-child(3){width:18%}
      #${PANEL_ID} .xpt-table th:nth-child(4),#${PANEL_ID} .xpt-table td:nth-child(4){width:38%}
      #${PANEL_ID} .xpt-table tbody tr:hover{background:hsl(var(--accent,210 40% 96%))}
      #${PANEL_ID} .xpt-table td.xpt-cell-group{font-weight:500}
      #${PANEL_ID} .xpt-table td.xpt-cell-success{overflow:visible}
      #${PANEL_ID} .xpt-success{display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;min-width:0;max-width:100%;vertical-align:middle}
      #${PANEL_ID} .xpt-spark{display:inline-flex;align-items:flex-end;gap:1px;height:14px;flex:0 0 auto;width:max-content}
      #${PANEL_ID} .xpt-spark-slot{display:flex;align-items:flex-end;width:3px;height:14px;color:#f43f5e;flex:0 0 auto}
      #${PANEL_ID} .xpt-spark-slot.xpt-good{color:#10b981}
      #${PANEL_ID} .xpt-spark-slot.xpt-warn{color:#f59e0b}
      #${PANEL_ID} .xpt-spark-bar{width:100%;min-height:2px;border-radius:2px;background:currentColor}
      #${PANEL_ID} .xpt-spark-slot.xpt-latest .xpt-spark-bar{box-shadow:0 0 0 1px hsl(var(--card,0 0% 100%)),0 0 0 2px currentColor}
      #${PANEL_ID} .xpt-success-value{flex:0 0 auto;min-width:3em;font-variant-numeric:tabular-nums;font-weight:600;text-align:left}
      #${FRAME_ID}{position:fixed!important;left:-20000px!important;top:0!important;width:1600px!important;height:1200px!important;opacity:0!important;pointer-events:none!important;border:0!important;z-index:-2147483648!important}
      @media(max-width:1100px){
        #${PANEL_ID} .xpt-card-title{max-width:30%}
        #${PANEL_ID} .xpt-card-token-current-block{max-width:40%}
        #${PANEL_ID} .xpt-card-token-select{width:128px}
        #${PANEL_ID} .xpt-table th:nth-child(1),#${PANEL_ID} .xpt-table td:nth-child(1){width:28%}
        #${PANEL_ID} .xpt-table th:nth-child(2),#${PANEL_ID} .xpt-table td:nth-child(2){width:13%}
        #${PANEL_ID} .xpt-table th:nth-child(3),#${PANEL_ID} .xpt-table td:nth-child(3){width:17%}
        #${PANEL_ID} .xpt-table th:nth-child(4),#${PANEL_ID} .xpt-table td:nth-child(4){width:42%}
      }
      @media(max-width:960px){
        #${PANEL_ID}{max-height:min(58vh,560px)}
        #${PANEL_ID} .xpt-grid{grid-template-columns:1fr;gap:8px}
        #${PANEL_ID} .xpt-card-title{max-width:none;flex:1 1 auto}
        #${PANEL_ID} .xpt-card-title-row{flex-wrap:wrap}
        #${PANEL_ID} .xpt-card-token{flex:1 1 100%;justify-content:space-between}
        #${PANEL_ID} .xpt-card-token-current-block{max-width:none;flex:1 1 auto;margin-right:10px}
        #${PANEL_ID} .xpt-table th:nth-child(1),#${PANEL_ID} .xpt-table td:nth-child(1){width:30%}
        #${PANEL_ID} .xpt-table th:nth-child(2),#${PANEL_ID} .xpt-table td:nth-child(2){width:14%}
        #${PANEL_ID} .xpt-table th:nth-child(3),#${PANEL_ID} .xpt-table td:nth-child(3){width:16%}
        #${PANEL_ID} .xpt-table th:nth-child(4),#${PANEL_ID} .xpt-table td:nth-child(4){width:40%}
      }
      @media(max-width:720px){
        #${PANEL_ID} .xpt-head{align-items:flex-start}
        #${PANEL_ID} .xpt-body{padding:6px 8px 4px}
        #${PANEL_ID} .xpt-title span{display:none}
        #${PANEL_ID} .xpt-card-token{flex-wrap:wrap;gap:8px}
        #${PANEL_ID} .xpt-card-token-current-block{margin-right:0;max-width:100%;flex:1 1 100%}
        #${PANEL_ID} .xpt-card-token-switch{padding-left:0;border-left:0;width:100%}
        #${PANEL_ID} .xpt-card-token-select{flex:1 1 auto;width:auto;max-width:none}
        #${PANEL_ID} .xpt-clone th,#${PANEL_ID} .xpt-clone td,#${PANEL_ID} .xpt-table th,#${PANEL_ID} .xpt-table td{padding:4px 6px!important;font-size:11px!important}
        #${PANEL_ID} .xpt-table th:nth-child(1),#${PANEL_ID} .xpt-table td:nth-child(1){width:28%}
        #${PANEL_ID} .xpt-table th:nth-child(2),#${PANEL_ID} .xpt-table td:nth-child(2){width:12%}
        #${PANEL_ID} .xpt-table th:nth-child(3),#${PANEL_ID} .xpt-table td:nth-child(3){width:16%}
        #${PANEL_ID} .xpt-table th:nth-child(4),#${PANEL_ID} .xpt-table td:nth-child(4){width:44%}
        #${PANEL_ID} .xpt-spark-slot{width:2px}
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="xpt-head">
        <div class="xpt-title"><strong>${TEXT.title}</strong><span>${TEXT.synced}</span></div>
        <div class="xpt-actions">
          <button type="button" class="xpt-collapse">${isCollapsed() ? TEXT.expand : TEXT.collapse}</button>
          <button type="button" class="xpt-refresh">${TEXT.refresh}</button>
        </div>
      </div>
      <div class="xpt-body">
        <div class="xpt-status">${TEXT.loading}</div>
        <div class="xpt-content"></div>
        <div class="xpt-meta"></div>
      </div>`;
    panel.classList.toggle('is-collapsed', isCollapsed());
    panel.querySelector('.xpt-refresh').addEventListener('click', () => refreshPanel());
    panel.querySelector('.xpt-collapse').addEventListener('click', () => {
      setCollapsed(!panel.classList.contains('is-collapsed'));
    });
    return panel;
  }

  function findMountPoint() {
    const main = document.querySelector('main');
    if (!main) return null;
    const usageTitle = Array.from(main.querySelectorAll('h1,h2,h3,[role="heading"]')).find((node) => {
      const text = cleanText(node.textContent).toLowerCase();
      return text === 'usage logs' || text === 'usage log' || text === '\u4f7f\u7528\u65e5\u5fd7';
    });
    if (usageTitle) {
      let block = usageTitle;
      while (block.parentElement && block.parentElement !== main && block.parentElement.children.length === 1) {
        block = block.parentElement;
      }
      return { parent: block.parentElement || main, before: block };
    }
    const wrapper = main.firstElementChild;
    return wrapper
      ? { parent: wrapper, before: wrapper.firstElementChild }
      : { parent: main, before: main.firstElementChild };
  }

  function markUsageLogsPage(enabled) {
    document.documentElement.classList.toggle('xpt-usage-logs-page', enabled);
    document.body?.classList.toggle('xpt-usage-logs-page', enabled);
  }

  function positionPanel() {
    if (!TARGET_PATH.test(location.pathname)) return null;
    injectStyles();
    markUsageLogsPage(true);
    const mount = findMountPoint();
    if (!mount) return null;
    const panel = createPanel();
    if (mount.before !== panel && (panel.parentElement !== mount.parent || panel.nextSibling !== mount.before)) {
      mount.parent.insertBefore(panel, mount.before);
    }
    panel.classList.toggle('is-collapsed', isCollapsed());
    return panel;
  }

  function setPanelState(status, content, meta, loading) {
    const panel = positionPanel();
    if (!panel) return;
    const statusNode = panel.querySelector('.xpt-status');
    const contentNode = panel.querySelector('.xpt-content');
    const button = panel.querySelector('.xpt-refresh');
    statusNode.textContent = status || '';
    statusNode.hidden = !status;
    if (content !== undefined) contentNode.replaceChildren(content || document.createDocumentFragment());
    panel.querySelector('.xpt-meta').textContent = meta || '';
    button.disabled = Boolean(loading);
    button.textContent = loading ? TEXT.refreshing : TEXT.refresh;
  }

  function getCardTokenRoot(model) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    return Array.from(panel.querySelectorAll('.xpt-card-token'))
      .find((node) => node.dataset.model === model) || null;
  }

  function fillGroupSelect(select, options, preferred) {
    const previous = select.value;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = TEXT.selectGroup;
    select.appendChild(placeholder);
    (options || []).forEach((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      const ratioText = option.ratio == null ? '' : ` (${formatRatio(option.ratio)})`;
      node.textContent = `${option.label}${ratioText}`;
      select.appendChild(node);
    });
    const target = preferred || previous;
    if (target && (options || []).some((option) => option.value === target)) {
      select.value = target;
    }
  }

  function setCardTokenUI(model, {
    current,
    options,
    message,
    messageTone,
    loading,
    disabled
  }) {
    const root = getCardTokenRoot(model);
    if (!root) return;
    const currentNode = root.querySelector('.xpt-card-token-current');
    const msgNode = root.querySelector('.xpt-card-token-msg');
    const select = root.querySelector('.xpt-card-token-select');
    const apply = root.querySelector('.xpt-card-token-apply');
    const token = tokenCacheByModel[model];
    const switching = Boolean(tokenSwitchingByModel[model]);

    if (current !== undefined) {
      currentNode.textContent = current || '\u2014';
      currentNode.title = current || '';
    }
    if (message !== undefined) {
      msgNode.textContent = message || '';
      msgNode.classList.toggle('xpt-ok', messageTone === 'ok');
      msgNode.classList.toggle('xpt-err', messageTone === 'err');
      msgNode.title = message || '';
    }
    if (Array.isArray(options)) {
      fillGroupSelect(select, options, current);
    }

    const busy = Boolean(loading || switching);
    const selected = cleanText(select.value);
    const activeGroup = cleanText(current || token?.group || '');
    select.disabled = busy || disabled || select.options.length <= 1;
    apply.disabled = busy || disabled || !selected || selected === activeGroup;
    apply.textContent = switching ? TEXT.tokenSwitching : TEXT.tokenSwitch;
  }

  function isRendered(node) {
    if (!node?.isConnected) return false;
    const view = node.ownerDocument?.defaultView;
    if (!view) return true;
    const style = view.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  }

  function findExactTextElement(root, expected) {
    return Array.from(root.querySelectorAll('td,th,button,a,span,div,p,code,[role="cell"],[role="row"]'))
      .filter((node) => cleanText(node.textContent) === expected)
      .sort((a, b) => Number(isRendered(b)) - Number(isRendered(a)) || a.children.length - b.children.length)[0] || null;
  }

  function findPerformanceRegion(doc) {
    const hasHeaders = (node) => {
      const text = cleanText(node.textContent).toLowerCase();
      const legacyTable = text.includes('ttft p50') && text.includes('ttft p95') && text.includes('ttft p99') &&
        (text.includes('uptime') || text.includes('\u53ef\u7528\u7387') || text.includes('\u6b63\u5e38\u8fd0\u884c'));
      const currentTable = text.includes('tps') &&
        (text.includes('average ttft') || text.includes('average first token latency') ||
          text.includes('\u5e73\u5747\u9996 token \u5ef6\u8fdf') || text.includes('\u9996 token \u5ef6\u8fdf')) &&
        (text.includes('success rate') || text.includes('\u6210\u529f\u7387'));
      return legacyTable || currentTable;
    };
    const table = Array.from(doc.querySelectorAll('table,[role="table"],[role="grid"]'))
      .find((node) => isRendered(node) && hasHeaders(node));
    if (table) return table;

    const marker = Array.from(doc.querySelectorAll('th,td,div,span')).find((node) => {
      if (!isRendered(node)) return false;
      const text = cleanText(node.textContent).toLowerCase();
      return text === 'ttft p50' || text === 'tps' || text === 'success rate' || text === '\u6210\u529f\u7387';
    });
    let region = marker?.parentElement || null;
    while (region && region !== doc.body) {
      if (isRendered(region) && hasHeaders(region) && cleanText(region.textContent).length < 20000) return region;
      region = region.parentElement;
    }
    return null;
  }

  function regionSignature(region) {
    return region ? cleanText(region.textContent) : '';
  }

  function looksSelected(node) {
    const probes = [
      node,
      node?.closest('button,a,[role="button"]'),
      node?.closest('tr,[role="row"],[data-row-key],[data-index]')
    ].filter(Boolean);
    return probes.some((probe) => {
      const state = `${probe.getAttribute('data-state') || ''} ${probe.getAttribute('data-selected') || ''}`.toLowerCase();
      const className = typeof probe.className === 'string' ? probe.className : '';
      return probe.matches('[aria-selected="true"],[aria-current="true"],[aria-current="page"]') ||
        /(?:^|\s)(?:active|selected)(?:\s|$)/i.test(className) ||
        /(?:active|selected|open|true)/.test(state);
    });
  }

  function clickElement(element) {
    if (!element) return;
    element.scrollIntoView?.({ block: 'center', inline: 'center' });
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: element.ownerDocument.defaultView
      }));
    });
  }

  function openPerformanceTab(doc) {
    const dialogs = Array.from(doc.querySelectorAll('[role="dialog"]')).filter(isRendered);
    const scope = dialogs.find((dialog) => cleanText(dialog.textContent).includes(MODEL)) || dialogs[0] || doc;
    const label = Array.from(scope.querySelectorAll('button,a,span,div,[role="tab"],[role="button"]'))
      .filter((node) => {
        if (!isRendered(node)) return false;
        const text = cleanText(node.textContent).toLowerCase();
        return text === '\u6027\u80fd' || text === 'performance';
      })
      .sort((a, b) => a.children.length - b.children.length)[0];
    if (!label) return false;
    const tab = label.closest('button,a,[role="tab"],[role="button"]') || label;
    if (!looksSelected(tab)) clickElement(tab);
    return true;
  }

  function searchAndOpenModel(doc) {
    let modelNode = findExactTextElement(doc, MODEL);
    if (!modelNode || !isRendered(modelNode)) {
      const search = Array.from(doc.querySelectorAll('input')).find((input) => {
        const hint = `${input.placeholder || ''} ${input.getAttribute('aria-label') || ''}`.toLowerCase();
        return isRendered(input) && (/search|model/.test(hint) || hint.includes('\u641c\u7d22') || hint.includes('\u6a21\u578b'));
      });
      if (search) {
        const setter = Object.getOwnPropertyDescriptor(
          search.ownerDocument.defaultView.HTMLInputElement.prototype,
          'value'
        )?.set;
        setter?.call(search, MODEL);
        search.dispatchEvent(new Event('input', { bubbles: true }));
        search.dispatchEvent(new Event('change', { bubbles: true }));
      }
      modelNode = findExactTextElement(doc, MODEL);
    }
    if (!modelNode || !isRendered(modelNode)) return null;

    const previousRegion = findPerformanceRegion(doc);
    const row = modelNode.closest('tr,[role="row"],[data-row-key],[data-index]');
    const target = modelNode.closest('button,a,[role="button"]') || row || modelNode;
    const selectedBefore = looksSelected(modelNode);
    clickElement(target);
    if (row) {
      const expand = Array.from(row.querySelectorAll('button,[role="button"]')).find((button) => {
        const hint = `${button.getAttribute('aria-label') || ''} ${button.title || ''}`.toLowerCase();
        return /expand|detail|performance/.test(hint) ||
          hint.includes('\u5c55\u5f00') || hint.includes('\u8be6\u60c5') || hint.includes('\u6027\u80fd');
      });
      if (expand && expand !== target) clickElement(expand);
    }
    return {
      selectedBefore,
      previousSignature: regionSignature(previousRegion),
      openedAt: Date.now()
    };
  }

  function sanitizeClone(node) {
    const allowedTags = new Set([
      'B', 'CAPTION', 'COL', 'COLGROUP', 'DIV', 'EM', 'P', 'SECTION', 'SMALL',
      'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR'
    ]);
    const allowedAttributes = new Set([
      'aria-label', 'class', 'colspan', 'role', 'rowspan', 'scope'
    ]);
    const holder = document.createElement('div');
    holder.appendChild(node);
    Array.from(holder.querySelectorAll('*')).forEach((element) => {
      if (!allowedTags.has(element.tagName)) {
        element.replaceWith(document.createTextNode(element.textContent || ''));
        return;
      }
      Array.from(element.attributes).forEach((attribute) => {
        if (!allowedAttributes.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      });
    });
    return holder;
  }

  function waitForPricingTable(frame, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let selection = null;
      const tick = () => {
        if (!frame.isConnected) return reject(new Error('pricing frame was removed'));
        let doc;
        try {
          doc = frame.contentDocument;
        } catch (_) {
          return reject(new Error('pricing page is not accessible'));
        }
        if (doc?.body) {
          removeAnnouncementDialogs(doc);
          selection ||= searchAndOpenModel(doc);
          if (selection) {
            selection.performanceOpened ||= openPerformanceTab(doc);
            const region = findPerformanceRegion(doc);
            const elapsed = Date.now() - selection.openedAt;
            const changed = region && regionSignature(region) !== selection.previousSignature;
            if (region && elapsed >= 500 && (selection.selectedBefore || changed || elapsed >= 3000)) {
              return resolve(region);
            }
          }
        }
        if (Date.now() - started >= timeoutMs) return reject(new Error('pricing table load timed out'));
        setTimeout(tick, 350);
      };
      frame.addEventListener('load', tick, { once: true });
      setTimeout(tick, 500);
    });
  }

  async function cloneFromPricingPage() {
    document.getElementById(FRAME_ID)?.remove();
    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.src = `/pricing?xpt-performance=${Date.now()}`;
    document.documentElement.appendChild(frame);
    try {
      const source = await waitForPricingTable(frame, 12000);
      const clone = sanitizeClone(document.importNode(source, true));
      const wrapper = document.createElement('div');
      wrapper.className = 'xpt-clone';
      wrapper.appendChild(clone);
      return wrapper;
    } finally {
      frame.remove();
    }
  }

  function userHeaders(extra) {
    const headers = { Accept: 'application/json', ...(extra || {}) };
    try {
      const user = nativeJSONParse(localStorage.getItem('user') || 'null');
      if (user?.id != null) headers['New-Api-User'] = String(user.id);
    } catch (_) {}
    return headers;
  }

  async function apiJson(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
        ...options,
        headers: userHeaders(options?.headers)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload && payload.message) || `HTTP ${response.status}`);
      }
      if (payload?.success === false) {
        throw new Error(payload.message || 'request failed');
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  function extractTokenItems(payload) {
    const roots = [payload?.data, payload].filter(Boolean);
    for (const root of roots) {
      if (Array.isArray(root?.items)) return root.items;
      if (Array.isArray(root?.data)) return root.data;
      if (Array.isArray(root)) return root;
    }
    return [];
  }

  async function findNamedToken(tokenName) {
    const keyword = encodeURIComponent(tokenName);
    const searched = await apiJson(`/api/token/search?keyword=${keyword}&p=1&size=100`).catch(() => null);
    let items = extractTokenItems(searched);
    if (!items.length) {
      const listed = await apiJson('/api/token/?p=1&size=100');
      items = extractTokenItems(listed);
    }
    const exact = items.find((item) => cleanText(item?.name) === tokenName);
    if (exact) return exact;
    const loose = items.find((item) => cleanText(item?.name).toLowerCase() === tokenName.toLowerCase());
    if (loose) return loose;
    return null;
  }

  function extractGroupNamesFromPayload(payload) {
    const groups = [payload?.groups, payload?.data?.groups].find((value) => Array.isArray(value) && value.length);
    if (groups) {
      return groups
        .map((group) => cleanText(group?.group || group?.name || group?.label))
        .filter(Boolean);
    }
    try {
      const rows = pickRows(payload);
      const key = findKey(rows, ['group', 'groupname', 'name', 'label']);
      if (!key) return [];
      return rows.map((row) => cleanText(row[key])).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function buildPerformanceGroupOptions(names, ratioInfo) {
    const unique = [];
    const seen = new Set();
    names.forEach((name) => {
      const value = cleanText(name);
      if (!value) return;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(value);
    });
    return unique
      .map((value) => {
        const ratio = lookupGroupRatio(value, ratioInfo);
        return {
          value,
          label: value,
          ratio
        };
      })
      .sort((a, b) => a.value.localeCompare(b.value, 'zh-CN'));
  }

  async function updateTokenGroup(token, group) {
    const detailPayload = await apiJson(`/api/token/${token.id}`).catch(() => null);
    const detail = detailPayload?.data || token;
    const payload = {
      id: detail.id,
      name: detail.name,
      remain_quota: detail.remain_quota,
      expired_time: detail.expired_time,
      unlimited_quota: detail.unlimited_quota,
      model_limits_enabled: Boolean(detail.model_limits_enabled),
      model_limits: detail.model_limits || '',
      allow_ips: detail.allow_ips || '',
      group,
      cross_group_retry: group === 'auto' ? Boolean(detail.cross_group_retry) : false
    };
    const result = await apiJson('/api/token/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return result?.data || { ...detail, group };
  }

  function getOptionsForModel(model, currentGroup) {
    const options = (groupOptionsByModel[model] || []).slice();
    const current = cleanText(currentGroup);
    if (current && !options.some((option) => option.value === current)) {
      options.unshift({ value: current, label: current, ratio: null });
    }
    return options;
  }

  async function refreshTokenForModel(model) {
    const config = getModelConfig(model);
    if (!config) return;

    setCardTokenUI(model, {
      current: '\u2014',
      message: TEXT.tokenLoading,
      messageTone: '',
      loading: true,
      disabled: true
    });

    try {
      const token = await findNamedToken(config.tokenName);
      if (!token) {
        tokenCacheByModel[model] = null;
        setCardTokenUI(model, {
          current: '\u2014',
          options: getOptionsForModel(model),
          message: `${TEXT.tokenMissing}: ${config.tokenName}`,
          messageTone: 'err',
          loading: false,
          disabled: true
        });
        return;
      }

      tokenCacheByModel[model] = token;
      const current = cleanText(token.group) || 'default';
      const options = getOptionsForModel(model, current);
      setCardTokenUI(model, {
        current,
        options,
        message: '',
        messageTone: '',
        loading: false,
        disabled: !options.length
      });
    } catch (error) {
      console.debug(`[xptoolkit] token load failed for ${config.tokenName}`, error);
      tokenCacheByModel[model] = null;
      setCardTokenUI(model, {
        current: '\u2014',
        options: getOptionsForModel(model),
        message: `${TEXT.tokenFailed}: ${error.message || error}`,
        messageTone: 'err',
        loading: false,
        disabled: true
      });
    }
  }

  async function refreshAllTokens() {
    await Promise.all(MODELS.map((model) => refreshTokenForModel(model)));
  }

  async function applyTokenGroup(model) {
    if (tokenSwitchingByModel[model]) return;
    const root = getCardTokenRoot(model);
    if (!root) return;
    const select = root.querySelector('.xpt-card-token-select');
    const nextGroup = cleanText(select?.value);
    if (!nextGroup) return;

    if (!tokenCacheByModel[model]) {
      await refreshTokenForModel(model);
      if (!tokenCacheByModel[model]) return;
    }
    const token = tokenCacheByModel[model];
    if (nextGroup === cleanText(token.group || '')) return;

    tokenSwitchingByModel[model] = true;
    setCardTokenUI(model, {
      current: cleanText(token.group) || '\u2014',
      message: TEXT.tokenSwitching,
      messageTone: '',
      loading: true,
      disabled: false
    });

    try {
      const updated = await updateTokenGroup(token, nextGroup);
      tokenCacheByModel[model] = { ...token, ...updated, group: nextGroup };
      setCardTokenUI(model, {
        current: nextGroup,
        options: getOptionsForModel(model, nextGroup),
        message: `${TEXT.tokenSwitched}: ${nextGroup}`,
        messageTone: 'ok',
        loading: false,
        disabled: false
      });
    } catch (error) {
      console.error(`[xptoolkit] switch token group failed for ${model}`, error);
      setCardTokenUI(model, {
        current: cleanText(tokenCacheByModel[model]?.group) || '\u2014',
        options: getOptionsForModel(model, tokenCacheByModel[model]?.group),
        message: `${TEXT.tokenUpdateFailed}: ${error.message || error}`,
        messageTone: 'err',
        loading: false,
        disabled: false
      });
    } finally {
      tokenSwitchingByModel[model] = false;
      setCardTokenUI(model, {
        current: cleanText(tokenCacheByModel[model]?.group) || '\u2014',
        loading: false,
        disabled: !tokenCacheByModel[model]
      });
    }
  }

  function createCardTokenControls(model, tokenName) {
    const wrap = document.createElement('div');
    wrap.className = 'xpt-card-token';
    wrap.dataset.model = model;
    wrap.dataset.tokenName = tokenName;

    const currentBlock = document.createElement('div');
    currentBlock.className = 'xpt-card-token-current-block';

    const label = document.createElement('span');
    label.className = 'xpt-card-token-label';
    label.textContent = TEXT.tokenCurrent;

    const current = document.createElement('span');
    current.className = 'xpt-card-token-current';
    current.textContent = '\u2014';
    currentBlock.append(label, current);

    const switchBlock = document.createElement('div');
    switchBlock.className = 'xpt-card-token-switch';

    const select = document.createElement('select');
    select.className = 'xpt-card-token-select';
    select.setAttribute('aria-label', `${tokenName} ${TEXT.selectGroup}`);
    select.disabled = true;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = TEXT.selectGroup;
    select.appendChild(placeholder);

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'xpt-card-token-apply';
    apply.textContent = TEXT.tokenSwitch;
    apply.disabled = true;
    switchBlock.append(select, apply);

    const msg = document.createElement('span');
    msg.className = 'xpt-card-token-msg';

    apply.addEventListener('click', () => applyTokenGroup(model));
    select.addEventListener('change', () => {
      const token = tokenCacheByModel[model];
      apply.disabled = Boolean(tokenSwitchingByModel[model]) ||
        !select.value ||
        select.value === cleanText(token?.group || '');
    });

    wrap.append(currentBlock, switchBlock, msg);
    return wrap;
  }

  function flatten(value, prefix, output) {
    output = output || {};
    prefix = prefix || '';
    if (!value || typeof value !== 'object') return output;
    Object.entries(value).forEach(([key, child]) => {
      const name = prefix ? `${prefix}.${key}` : key;
      if (child == null || ['string', 'number', 'boolean'].includes(typeof child)) output[name] = child;
      else if (!Array.isArray(child) && prefix.split('.').length < 2) flatten(child, name, output);
    });
    return output;
  }

  function canonical(key) {
    return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function candidateScore(row) {
    const keys = Object.keys(flatten(row)).map(canonical);
    return ['group', 'firsttokenlatency', 'ttft', 'successrate', 'ttftp50', 'ttftp95', 'ttftp99', 'uptime', 'throughput', 'tps']
      .reduce((sum, signal) => sum + (keys.some((key) => key.includes(signal)) ? 2 : 0), 0);
  }

  function collectCandidates(value, output, depth) {
    output = output || [];
    depth = depth || 0;
    if (!value || typeof value !== 'object' || depth > 6) return output;
    if (Array.isArray(value)) {
      if (value.length && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) output.push(value);
      value.forEach((item) => collectCandidates(item, output, depth + 1));
      return output;
    }
    const entries = Object.entries(value);
    const objectEntries = entries.filter(([, item]) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectEntries.length >= 2 && objectEntries.length === entries.length) {
      output.push(objectEntries.map(([group, item]) => ({ group, ...item })));
    }
    entries.forEach(([, item]) => collectCandidates(item, output, depth + 1));
    return output;
  }

  function pickRows(payload) {
    const candidates = collectCandidates(payload);
    candidates.sort((a, b) => {
      const scoreA = a.reduce((sum, row) => sum + candidateScore(row), 0) / Math.max(a.length, 1);
      const scoreB = b.reduce((sum, row) => sum + candidateScore(row), 0) / Math.max(b.length, 1);
      return scoreB - scoreA || b.length - a.length;
    });
    return (candidates[0] || []).map((row) => flatten(row));
  }

  const COLUMN_DEFS = [
    { label: TEXT.group, aliases: ['group', 'groupname', 'name', 'label'] },
    { label: TEXT.successRate, aliases: ['successrate', 'requestsuccessrate', 'successratio'] },
    { label: TEXT.throughput, aliases: ['tokenspersecond', 'outputtps', 'throughput', 'tps'] },
    { label: TEXT.uptime, aliases: ['uptime30d', 'uptime', 'availability30d', 'availability'] }
  ];

  function findKey(rows, aliases) {
    const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    return keys.find((key) => aliases.includes(canonical(key))) ||
      keys.find((key) => aliases.some((alias) => canonical(key).includes(alias)));
  }

  function formatValue(value, key, label) {
    if (value == null || value === '') return '\u2014';
    if (typeof value !== 'number') return String(value);
    const normalized = canonical(key);
    if (/uptime|availability|successrate/.test(normalized)) {
      const percent = value <= 1 ? value * 100 : value;
      return `${percent.toFixed(percent >= 99 ? 3 : 2).replace(/\.?0+$/, '')}%`;
    }
    if (/ttft|latency/.test(normalized) || label.startsWith('TTFT')) return `${Number(value.toFixed(2))} ms`;
    if (/tps|throughput|tokenspersecond/.test(normalized) || label === TEXT.throughput) {
      return `${Number(value.toFixed(2))} tok/s`;
    }
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value);
  }

  function toFiniteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeSuccessRate(value) {
    const rate = toFiniteNumber(value);
    if (rate == null) return null;
    return Math.max(0, Math.min(100, rate <= 1 ? rate * 100 : rate));
  }

  function formatTps(value) {
    const tps = toFiniteNumber(value);
    return tps == null ? '\u2014' : `${tps.toFixed(1)} t/s`;
  }

  function formatRatio(value) {
    const ratio = toFiniteNumber(value);
    if (ratio == null) return '\u2014';
    const text = Number.isInteger(ratio)
      ? String(ratio)
      : String(Number(ratio.toFixed(4))).replace(/\.?0+$/, '');
    return `${text}x`;
  }

  function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function extractPricingMeta(payload) {
    const roots = [payload, payload?.data, payload?.data?.data].filter(Boolean);
    let groupRatio = null;
    let usableGroup = null;
    for (const root of roots) {
      groupRatio ||= asPlainObject(root.group_ratio) || asPlainObject(root.GroupRatio);
      usableGroup ||= asPlainObject(root.usable_group) || asPlainObject(root.UsableGroup);
    }
    return {
      groupRatio: groupRatio || {},
      usableGroup: usableGroup || {}
    };
  }

  function lookupGroupRatio(name, ratioInfo) {
    const groupRatio = asPlainObject(ratioInfo?.groupRatio) || {};
    const usableGroup = asPlainObject(ratioInfo?.usableGroup) || {};
    const label = cleanText(name);
    if (!label) return null;

    if (Object.prototype.hasOwnProperty.call(groupRatio, label)) {
      return toFiniteNumber(groupRatio[label]);
    }

    const directKey = Object.keys(groupRatio).find((key) => cleanText(key).toLowerCase() === label.toLowerCase());
    if (directKey != null) return toFiniteNumber(groupRatio[directKey]);

    const byDisplay = Object.entries(usableGroup).find(([, display]) => cleanText(display).toLowerCase() === label.toLowerCase());
    if (byDisplay) {
      const [groupKey] = byDisplay;
      if (Object.prototype.hasOwnProperty.call(groupRatio, groupKey)) {
        return toFiniteNumber(groupRatio[groupKey]);
      }
      const ratioKey = Object.keys(groupRatio).find((key) => cleanText(key).toLowerCase() === cleanText(groupKey).toLowerCase());
      if (ratioKey != null) return toFiniteNumber(groupRatio[ratioKey]);
    }

    return null;
  }

  async function loadGroupRatios() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/pricing', {
        credentials: 'include',
        headers: userHeaders(),
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`pricing API HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.success === false) throw new Error(payload.message || 'pricing API returned failure');
      return extractPricingMeta(payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  function successRateTone(rate) {
    if (rate >= 99) return 'xpt-good';
    if (rate >= 95) return 'xpt-warn';
    return 'xpt-bad';
  }

  function successRateHeight(rate) {
    if (rate >= 99.9) return 100;
    if (rate >= 99) return 88;
    if (rate >= 95) return 72;
    if (rate >= 90) return 55;
    return 40;
  }

  function formatSeriesTime(timestamp) {
    const value = toFiniteNumber(timestamp);
    if (value == null) return '\u65f6\u95f4\u672a\u77e5';
    const milliseconds = value > 1e12 ? value : value * 1000;
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(milliseconds));
  }

  function createSuccessRateCell(group) {
    const wrapper = document.createElement('div');
    wrapper.className = 'xpt-success';

    const points = (Array.isArray(group.series) ? group.series : [])
      .map((point) => ({
        ts: toFiniteNumber(point?.ts),
        rate: normalizeSuccessRate(point?.success_rate)
      }))
      .filter((point) => point.rate != null)
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
      .slice(-24);
    const fallbackRate = normalizeSuccessRate(group.success_rate);
    const latestRate = points.length ? points.at(-1).rate : fallbackRate;

    if (points.length) {
      const spark = document.createElement('div');
      spark.className = 'xpt-spark';
      spark.setAttribute('role', 'img');
      spark.setAttribute(
        'aria-label',
        `\u6700\u8fd1 24 \u5c0f\u65f6\u6210\u529f\u7387\uff0c\u6700\u65b0 ${points.at(-1).rate.toFixed(2)}%`
      );
      points.forEach((point, index) => {
        const slot = document.createElement('span');
        slot.className = `xpt-spark-slot ${successRateTone(point.rate)}${index === points.length - 1 ? ' xpt-latest' : ''}`;
        slot.title = `${formatSeriesTime(point.ts)} \u00b7 ${point.rate.toFixed(2)}%${index === points.length - 1 ? ' \u00b7 \u6700\u65b0' : ''}`;
        const bar = document.createElement('span');
        bar.className = 'xpt-spark-bar';
        bar.style.height = `${successRateHeight(point.rate)}%`;
        slot.appendChild(bar);
        spark.appendChild(slot);
      });
      wrapper.appendChild(spark);
    }

    const value = document.createElement('span');
    value.className = 'xpt-success-value';
    value.textContent = latestRate == null ? '\u2014' : `${latestRate.toFixed(1)}%`;
    if (latestRate != null) value.title = `\u6700\u65b0\u6210\u529f\u7387 ${latestRate.toFixed(2)}%`;
    wrapper.appendChild(value);
    return wrapper;
  }

  function renderPerformanceGroups(groups, ratioInfo) {
    const table = document.createElement('table');
    table.className = 'xpt-table';
    const headRow = table.createTHead().insertRow();
    [TEXT.group, TEXT.ratio, TEXT.throughput, TEXT.successRate].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });

    const tbody = table.createTBody();
    groups.forEach((group) => {
      const tr = tbody.insertRow();
      const groupName = cleanText(group.group || group.name || group.label) || '\u2014';
      const groupCell = tr.insertCell();
      groupCell.className = 'xpt-cell-group';
      groupCell.textContent = groupName;
      groupCell.title = groupName;
      const ratioCell = tr.insertCell();
      ratioCell.textContent = formatRatio(lookupGroupRatio(groupName, ratioInfo));
      const tpsCell = tr.insertCell();
      tpsCell.textContent = formatTps(group.avg_tps);
      const successCell = tr.insertCell();
      successCell.className = 'xpt-cell-success';
      successCell.appendChild(createSuccessRateCell(group));
    });
    return table;
  }

  function renderApiTable(payload, ratioInfo) {
    const groups = [payload?.groups, payload?.data?.groups].find((value) => Array.isArray(value) && value.length);
    if (groups) return renderPerformanceGroups(groups, ratioInfo);

    const rows = pickRows(payload);
    if (!rows.length) throw new Error('no group rows found in performance response');
    let columns = COLUMN_DEFS.map((column) => ({ ...column, key: findKey(rows, column.aliases) }))
      .filter((column) => column.key);
    if (columns.length < 2) {
      columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
        .slice(0, 4)
        .map((key) => ({ label: key, key }));
    }

    // Drop latency-like columns from generic fallback tables.
    columns = columns.filter((column) => {
      const key = canonical(column.key || '');
      const label = cleanText(column.label).toLowerCase();
      return !(/ttft|latency|firsttoken/.test(key) || /ttft|latency|延迟|延遲/.test(label));
    });

    const groupKey = findKey(rows, ['group', 'groupname', 'name', 'label']);
    const hasRatioColumn = columns.some((column) => column.label === TEXT.ratio);
    if (groupKey && !hasRatioColumn) {
      const groupIndex = columns.findIndex((column) => column.key === groupKey);
      columns.splice(groupIndex >= 0 ? groupIndex + 1 : 1, 0, { label: TEXT.ratio, key: '__group_ratio__' });
    }

    const table = document.createElement('table');
    table.className = 'xpt-table';
    const headRow = table.createTHead().insertRow();
    columns.forEach((column) => {
      const th = document.createElement('th');
      th.textContent = column.label;
      headRow.appendChild(th);
    });
    const tbody = table.createTBody();
    rows.forEach((row) => {
      const tr = tbody.insertRow();
      columns.forEach((column) => {
        if (column.key === '__group_ratio__') {
          tr.insertCell().textContent = formatRatio(lookupGroupRatio(row[groupKey], ratioInfo));
          return;
        }
        tr.insertCell().textContent = formatValue(row[column.key], column.key, column.label);
      });
    });
    return table;
  }

  function renderModelCard(result) {
    const { model, content, error } = result;
    const config = getModelConfig(model);
    const card = document.createElement('article');
    card.className = 'xpt-card';
    card.dataset.model = model;

    const head = document.createElement('div');
    head.className = 'xpt-card-head';
    const titleRow = document.createElement('div');
    titleRow.className = 'xpt-card-title-row';

    const title = document.createElement('div');
    title.className = 'xpt-card-title';
    title.textContent = model;
    titleRow.appendChild(title);

    if (config) {
      titleRow.appendChild(createCardTokenControls(model, config.tokenName));
    }
    head.appendChild(titleRow);
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'xpt-card-body';
    if (content) {
      body.appendChild(content);
    } else {
      const err = document.createElement('div');
      err.className = 'xpt-card-error';
      err.textContent = `${TEXT.failed}\uff1a${error?.message || error || 'unknown'}`;
      body.appendChild(err);
    }
    card.appendChild(body);
    return card;
  }

  function renderDualModelGrid(results) {
    const grid = document.createElement('div');
    grid.className = 'xpt-grid';
    results.forEach((result) => {
      grid.appendChild(renderModelCard(result));
    });
    return grid;
  }

  async function fetchPerfPayload(model, signal) {
    const response = await fetch(`/api/perf-metrics?model=${encodeURIComponent(model)}&hours=24`, {
      credentials: 'include',
      headers: userHeaders(),
      cache: 'no-store',
      signal
    });
    if (!response.ok) throw new Error(`performance API HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.success === false) throw new Error(payload.message || 'performance API returned failure');
    return payload;
  }

  async function loadFromApi() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const ratioInfo = await loadGroupRatios().catch((error) => {
        console.debug('[xptoolkit] group ratio load failed', error);
        return { groupRatio: {}, usableGroup: {} };
      });

      const results = await Promise.all(MODELS.map(async (model) => {
        try {
          const payload = await fetchPerfPayload(model, controller.signal);
          const groupNames = extractGroupNamesFromPayload(payload);
          groupOptionsByModel[model] = buildPerformanceGroupOptions(groupNames, ratioInfo);
          return {
            model,
            content: renderApiTable(payload, ratioInfo),
            error: null
          };
        } catch (error) {
          console.debug(`[xptoolkit] performance API failed for ${model}`, error);
          groupOptionsByModel[model] = [];
          return { model, content: null, error };
        }
      }));

      if (results.every((item) => !item.content)) {
        throw results[0]?.error || new Error('all performance APIs failed');
      }
      return {
        content: renderDualModelGrid(results),
        source: TEXT.api,
        partial: results.some((item) => !item.content)
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function refreshPanel() {
    if (!TARGET_PATH.test(location.pathname)) return;
    positionPanel();
    if (loadingPromise) return loadingPromise;
    setPanelState(TEXT.loading, null, '', true);

    loadingPromise = (async () => {
      let content;
      let source = TEXT.api;
      try {
        const loaded = await loadFromApi();
        content = loaded.content;
        source = loaded.source;
      } catch (error) {
        console.debug('[xptoolkit] performance API failed; using pricing table fallback', error);
        source = TEXT.pricing;
        MODELS.forEach((model) => {
          groupOptionsByModel[model] = [];
        });
        const fallback = await cloneFromPricingPage();
        content = renderDualModelGrid([
          { model: MODEL, content: fallback, error: null },
          { model: MODELS[1], content: null, error: new Error('pricing fallback only supports first model') }
        ]);
      }
      const time = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(new Date());
      setPanelState('', content, `${TEXT.source}\uff1a${source} \u00b7 ${TEXT.updated} ${time}`, false);
      // Token controls live inside cards — hydrate after content is mounted.
      await refreshAllTokens();
    })().catch((error) => {
      console.error('[xptoolkit] Synapse performance table failed', error);
      setPanelState(`${TEXT.failed}\uff1a${error.message || error}\u3002${TEXT.retry}\u3002`, null, '', false);
    }).finally(() => {
      loadingPromise = null;
    });
    return loadingPromise;
  }

  function clearPanel() {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(FRAME_ID)?.remove();
    markUsageLogsPage(false);
    MODELS.forEach((model) => {
      tokenCacheByModel[model] = null;
      tokenSwitchingByModel[model] = false;
      groupOptionsByModel[model] = [];
    });
    clearTimeout(pageReloadTimer);
    pageReloadTimer = 0;
  }

  function onRouteChange() {
    clearTimeout(routeTimer);
    routeTimer = setTimeout(() => {
      removeAnnouncementDialogs(document);
      if (!TARGET_PATH.test(location.pathname)) {
        clearPanel();
        return;
      }
      if (!positionPanel()) {
        setTimeout(onRouteChange, 300);
        return;
      }
      refreshPanel();
      if (!pageReloadTimer) {
        pageReloadTimer = setTimeout(() => {
          pageReloadTimer = 0;
          if (TARGET_PATH.test(location.pathname)) location.reload();
        }, PAGE_RELOAD_MS);
      }
    }, 50);
  }

  ['pushState', 'replaceState'].forEach((method) => {
    const nativeMethod = history[method];
    history[method] = function xptHistory(...args) {
      const result = nativeMethod.apply(this, args);
      dispatchEvent(new Event('xpt:synapse-route'));
      return result;
    };
  });

  addEventListener('popstate', onRouteChange);
  addEventListener('xpt:synapse-route', onRouteChange);

  function start() {
    injectStyles();
    removeAnnouncementDialogs(document);
    new MutationObserver(() => {
      removeAnnouncementDialogs(document);
      if (TARGET_PATH.test(location.pathname)) positionPanel();
    }).observe(document.documentElement, { childList: true, subtree: true });
    onRouteChange();
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

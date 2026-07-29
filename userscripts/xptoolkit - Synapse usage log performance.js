// ==UserScript==
// @name         xptoolkit - Synapse usage log performance
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      1.1.2
// @description  Show the gpt-5.6-sol group performance table above common usage logs and suppress system announcements
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

  const MODEL = 'gpt-5.6-sol';
  const TARGET_PATH = /^\/usage-logs\/common\/?$/;
  const PANEL_ID = 'xpt-synapse-model-performance';
  const FRAME_ID = 'xpt-synapse-pricing-frame';
  const STYLE_ID = 'xpt-synapse-performance-style';
  const PAGE_RELOAD_MS = 2 * 60 * 1000;
  const TEXT = {
    title: MODEL + ' \u5404\u5206\u7ec4\u6027\u80fd',
    synced: '\u540c\u6b65\u81ea\u4ef7\u683c\u9875',
    refresh: '\u5237\u65b0',
    refreshing: '\u8bfb\u53d6\u4e2d\u2026',
    loading: '\u6b63\u5728\u4ece\u4ef7\u683c\u9875\u8bfb\u53d6\u6027\u80fd\u6570\u636e\u2026',
    source: '\u6765\u6e90',
    pricing: '\u4ef7\u683c\u9875',
    api: '\u4ef7\u683c\u9875\u6027\u80fd\u63a5\u53e3',
    updated: '\u6700\u8fd1\u66f4\u65b0',
    failed: '\u8bfb\u53d6\u5931\u8d25',
    retry: '\u53ef\u70b9\u51fb\u201c\u5237\u65b0\u201d\u91cd\u8bd5',
    group: '\u5206\u7ec4',
    firstTokenLatency: '\u5e73\u5747\u9996 Token \u5ef6\u8fdf',
    averageLatency: '\u5e73\u5747\u5ef6\u8fdf',
    successRate: '\u6210\u529f\u7387',
    throughput: 'TPS',
    uptime: '30 \u5929\u53ef\u7528\u7387'
  };

  let pageReloadTimer = 0;
  let routeTimer = 0;
  let loadingPromise = null;

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

  // Axios/XHR responses are normally passed through JSON.parse.
  const nativeJSONParse = JSON.parse.bind(JSON);
  JSON.parse = function xptJSONParse(text, reviver) {
    return stripAnnouncements(nativeJSONParse(text, reviver));
  };

  // Also cover pages that use fetch for /api/status.
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

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{width:100%;box-sizing:border-box;margin:0 0 16px;border:1px solid hsl(var(--border,214 32% 91%));border-radius:12px;background:hsl(var(--card,0 0% 100%));color:hsl(var(--card-foreground,222 47% 11%));box-shadow:0 1px 2px rgb(0 0 0/.05);overflow:hidden}
      #${PANEL_ID} .xpt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;border-bottom:1px solid hsl(var(--border,214 32% 91%))}
      #${PANEL_ID} .xpt-title{display:flex;align-items:baseline;gap:6px;min-width:0;flex-wrap:wrap}
      #${PANEL_ID} .xpt-title strong{font-size:14px;line-height:1.2}
      #${PANEL_ID} .xpt-title span,#${PANEL_ID} .xpt-meta,#${PANEL_ID} .xpt-status{color:hsl(var(--muted-foreground,215 16% 47%));font-size:11px}
      #${PANEL_ID} .xpt-refresh{flex:0 0 auto;height:24px;padding:0 9px;border:1px solid hsl(var(--border,214 32% 91%));border-radius:6px;background:transparent;color:inherit;cursor:pointer;font-size:11px}
      #${PANEL_ID} .xpt-refresh:hover{background:hsl(var(--accent,210 40% 96%))}
      #${PANEL_ID} .xpt-refresh:disabled{cursor:wait;opacity:.55}
      #${PANEL_ID} .xpt-body{padding:7px 12px 8px;overflow-x:auto}
      #${PANEL_ID} .xpt-status{min-height:22px;display:flex;align-items:center}
      #${PANEL_ID} .xpt-meta{margin-top:4px;text-align:right}
      #${PANEL_ID} .xpt-clone{min-width:720px;font-size:12px;line-height:1.15}
      #${PANEL_ID} .xpt-clone table,#${PANEL_ID} .xpt-table{width:100%!important;min-width:720px;border-collapse:collapse}
      #${PANEL_ID} .xpt-clone th,#${PANEL_ID} .xpt-clone td,#${PANEL_ID} .xpt-table th,#${PANEL_ID} .xpt-table td{height:auto!important;min-height:0!important;padding:4px 10px!important;line-height:1.15!important;white-space:nowrap;font-size:12px!important}
      #${PANEL_ID} .xpt-table th,#${PANEL_ID} .xpt-table td{border-bottom:1px solid hsl(var(--border,214 32% 91%));text-align:left}
      #${PANEL_ID} .xpt-table th{color:hsl(var(--muted-foreground,215 16% 47%));background:hsl(var(--muted,210 40% 96%));font-weight:600}
      #${PANEL_ID} .xpt-table tbody tr:hover{background:hsl(var(--accent,210 40% 96%))}
      #${PANEL_ID} .xpt-success{display:flex;align-items:center;gap:8px;min-width:132px}
      #${PANEL_ID} .xpt-spark{display:flex;align-items:flex-end;gap:1px;height:14px;min-width:95px}
      #${PANEL_ID} .xpt-spark-slot{display:flex;align-items:flex-end;width:3px;height:14px;color:#f43f5e}
      #${PANEL_ID} .xpt-spark-slot.xpt-good{color:#10b981}
      #${PANEL_ID} .xpt-spark-slot.xpt-warn{color:#f59e0b}
      #${PANEL_ID} .xpt-spark-bar{width:100%;min-height:2px;border-radius:2px;background:currentColor}
      #${PANEL_ID} .xpt-spark-slot.xpt-latest .xpt-spark-bar{box-shadow:0 0 0 1px hsl(var(--card,0 0% 100%)),0 0 0 2px currentColor}
      #${PANEL_ID} .xpt-success-value{min-width:42px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-weight:600;text-align:right}
      #${FRAME_ID}{position:fixed!important;left:-20000px!important;top:0!important;width:1600px!important;height:1200px!important;opacity:0!important;pointer-events:none!important;border:0!important;z-index:-2147483648!important}
      @media(max-width:720px){#${PANEL_ID} .xpt-head{align-items:flex-start}#${PANEL_ID} .xpt-body{padding:5px 8px 7px}}
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
        <button type="button" class="xpt-refresh">${TEXT.refresh}</button>
      </div>
      <div class="xpt-body">
        <div class="xpt-status">${TEXT.loading}</div>
        <div class="xpt-content"></div>
        <div class="xpt-meta"></div>
      </div>`;
    panel.querySelector('.xpt-refresh').addEventListener('click', () => refreshPanel());
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

  function positionPanel() {
    if (!TARGET_PATH.test(location.pathname)) return null;
    injectStyles();
    const mount = findMountPoint();
    if (!mount) return null;
    const panel = createPanel();
    if (mount.before !== panel && (panel.parentElement !== mount.parent || panel.nextSibling !== mount.before)) {
      mount.parent.insertBefore(panel, mount.before);
    }
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
    node.removeAttribute?.('id');
    node.querySelectorAll?.('[id]').forEach((item) => item.removeAttribute('id'));
    node.querySelectorAll?.('script,iframe').forEach((item) => item.remove());
    node.querySelectorAll?.('button,a').forEach((item) => {
      item.removeAttribute('href');
      item.style.pointerEvents = 'none';
    });
    node.querySelectorAll?.('[aria-controls]').forEach((item) => item.removeAttribute('aria-controls'));
    return node;
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

  function userHeaders() {
    const headers = { Accept: 'application/json' };
    try {
      const user = nativeJSONParse(localStorage.getItem('user') || 'null');
      if (user?.id != null) headers['New-Api-User'] = String(user.id);
    } catch (_) {}
    return headers;
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
    { label: TEXT.firstTokenLatency, aliases: ['firsttokenlatency', 'firsttoken', 'latencyfirsttoken', 'avgttft', 'ttftavg', 'averagettft', 'meanttft'] },
    { label: TEXT.successRate, aliases: ['successrate', 'requestsuccessrate', 'successratio'] },
    { label: 'TTFT P50', aliases: ['ttftp50', 'p50ttft', 'p50'] },
    { label: 'TTFT P95', aliases: ['ttftp95', 'p95ttft', 'p95'] },
    { label: 'TTFT P99', aliases: ['ttftp99', 'p99ttft', 'p99'] },
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

  function formatLatency(value) {
    const milliseconds = toFiniteNumber(value);
    return milliseconds == null ? '\u2014' : `${(milliseconds / 1000).toFixed(2)}s`;
  }

  function formatTps(value) {
    const tps = toFiniteNumber(value);
    return tps == null ? '\u2014' : `${tps.toFixed(1)} t/s`;
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
    const averageRate = points.length
      ? points.reduce((sum, point) => sum + point.rate, 0) / points.length
      : fallbackRate;

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
    value.textContent = averageRate == null ? '\u2014' : `${averageRate.toFixed(1)}%`;
    wrapper.appendChild(value);
    return wrapper;
  }

  function renderPerformanceGroups(groups) {
    const table = document.createElement('table');
    table.className = 'xpt-table';
    const headRow = table.createTHead().insertRow();
    [TEXT.group, TEXT.throughput, TEXT.firstTokenLatency, TEXT.averageLatency, TEXT.successRate].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });

    const tbody = table.createTBody();
    groups.forEach((group) => {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = cleanText(group.group || group.name || group.label) || '\u2014';
      tr.insertCell().textContent = formatTps(group.avg_tps);
      tr.insertCell().textContent = formatLatency(group.avg_ttft_ms);
      tr.insertCell().textContent = formatLatency(group.avg_latency_ms);
      tr.insertCell().appendChild(createSuccessRateCell(group));
    });
    return table;
  }

  function renderApiTable(payload) {
    const groups = [payload?.groups, payload?.data?.groups].find((value) => Array.isArray(value) && value.length);
    if (groups) return renderPerformanceGroups(groups);

    const rows = pickRows(payload);
    if (!rows.length) throw new Error('no group rows found in performance response');
    let columns = COLUMN_DEFS.map((column) => ({ ...column, key: findKey(rows, column.aliases) }))
      .filter((column) => column.key);
    if (columns.length < 2) {
      columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
        .slice(0, 8)
        .map((key) => ({ label: key, key }));
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
        tr.insertCell().textContent = formatValue(row[column.key], column.key, column.label);
      });
    });
    return table;
  }

  async function loadFromApi() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/api/perf-metrics?model=${encodeURIComponent(MODEL)}&hours=24`, {
        credentials: 'include',
        headers: userHeaders(),
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`performance API HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.success === false) throw new Error(payload.message || 'performance API returned failure');
      return renderApiTable(payload);
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
        content = await loadFromApi();
      } catch (error) {
        console.debug('[xptoolkit] performance API failed; using pricing table fallback', error);
        source = TEXT.pricing;
        content = await cloneFromPricingPage();
      }
      const time = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).format(new Date());
      setPanelState('', content, `${TEXT.source}\uff1a${source} \u00b7 ${TEXT.updated} ${time}`, false);
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

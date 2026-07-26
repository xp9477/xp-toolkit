// ==UserScript==
// @name         xptoolkit - A股擂台最近成交置顶
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      1.1.0
// @description  将 asharecompetition.fun 的「最近成交」置顶，并排显示持仓；默认只看 Kimi-K3
// @author       xp9477
// @match        https://asharecompetition.fun/*
// @match        https://www.asharecompetition.fun/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=asharecompetition.fun
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'xptoolkit-ashare-trade-filter';
  const DEFAULT_FILTER = 'Kimi-K3';
  const PLAYERS = ['全部', 'Kimi-K3', 'Kimi', 'DeepSeek', 'GLM', 'Qwen', '豆包'];
  const NAME_TO_ID = {
    'Kimi-K3': 'kimi3',
    Kimi: 'kimi',
    DeepSeek: 'deepseek',
    GLM: 'glm',
    Qwen: 'qwen',
    豆包: 'doubao'
  };
  const COLORS = {
    kimi: '#2a78d6',
    deepseek: '#1baf7a',
    glm: '#eda100',
    qwen: '#008300',
    doubao: '#4a3aa7',
    kimi3: '#eb6834'
  };

  let bootstrapped = false;
  let posObserver = null;
  let tileObserver = null;

  const style = document.createElement('style');
  style.textContent = `
    #xpt-top-dashboard {
      display: grid;
      grid-template-columns: minmax(300px, 0.92fr) minmax(0, 1.35fr);
      gap: 12px;
      margin-bottom: 14px;
      align-items: stretch;
    }
    @media (max-width: 980px) {
      #xpt-top-dashboard {
        grid-template-columns: 1fr;
      }
    }
    #xpt-top-dashboard > .panel {
      margin-bottom: 0;
      min-width: 0;
    }
    #xpt-pos-panel,
    #xpt-trades-panel {
      position: relative;
      z-index: 5;
      box-shadow: 0 0 0 1px rgba(235, 104, 52, .22);
    }
    #xpt-pos-panel h2,
    #xpt-trades-panel h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    #xpt-top-dashboard .xpt-count,
    #xpt-top-dashboard .xpt-sub {
      color: var(--muted, #898781);
      font-size: 12px;
      font-weight: 400;
    }
    #xpt-pos-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin: 0 0 10px;
      font-size: 13px;
      color: var(--ink2, #c3c2b7);
    }
    #xpt-pos-summary .xpt-metric b {
      color: var(--ink, #fff);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    #xpt-pos-summary .xpt-badges {
      color: var(--ink2, #c3c2b7);
      font-size: 12px;
    }
    #xpt-pos-panel .xpt-view {
      font-size: 12.5px;
      line-height: 1.55;
      color: var(--ink2, #c3c2b7);
      margin: 0 0 10px;
      max-height: 4.8em;
      overflow: auto;
      padding-right: 4px;
    }
    #xpt-pos-panel .xpt-view .vdate {
      display: block;
      color: var(--muted, #898781);
      font-size: 11px;
      margin-bottom: 3px;
    }
    #xpt-trade-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 10px;
    }
    #xpt-trade-filters button {
      appearance: none;
      border: 1px solid var(--border, rgba(255,255,255,.10));
      background: var(--page, #0d0d0d);
      color: var(--ink2, #c3c2b7);
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
      line-height: 1.4;
    }
    #xpt-trade-filters button:hover {
      border-color: rgba(235, 104, 52, .55);
      color: var(--ink, #fff);
    }
    #xpt-trade-filters button.active {
      background: rgba(235, 104, 52, .18);
      border-color: #eb6834;
      color: #ffb08a;
      font-weight: 600;
    }
    #xpt-pos-panel .xpt-tablewrap,
    #xpt-trades-panel .tablewrap {
      max-height: min(46vh, 460px);
      overflow: auto;
    }
    #xpt-pos-panel table,
    #xpt-trades-panel table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    #xpt-trades-panel tr.xpt-hidden {
      display: none !important;
    }
    #xpt-trades-panel .xpt-empty {
      display: none;
      padding: 12px 6px;
      color: var(--muted, #898781);
      font-size: 13px;
    }
    #xpt-trades-panel.xpt-no-match .xpt-empty {
      display: block;
    }
    #xpt-pos-panel .dot,
    #xpt-trades-panel .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
  `;
  document.documentElement.appendChild(style);

  function loadFilter() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && PLAYERS.includes(v)) return v;
    } catch (_) {}
    return DEFAULT_FILTER;
  }

  function saveFilter(v) {
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch (_) {}
  }

  function posPlayerName(filter) {
    return filter === '全部' ? DEFAULT_FILTER : filter;
  }

  function posPlayerId(filter) {
    return NAME_TO_ID[posPlayerName(filter)] || 'kimi3';
  }

  function findTradesPanel() {
    const panels = document.querySelectorAll('.panel');
    for (const panel of panels) {
      if (panel.id === 'xpt-pos-panel') continue;
      const h2 = panel.querySelector(':scope > h2');
      if (!h2) continue;
      const text = h2.childNodes[0]
        ? h2.childNodes[0].textContent
        : h2.textContent;
      if ((text || '').replace(/\s+/g, '').includes('最近成交')) return panel;
      if (h2.textContent.replace(/\s+/g, '').includes('最近成交')) return panel;
    }
    const tb = document.getElementById('tradesbody');
    return tb ? tb.closest('.panel') : null;
  }

  function playerOfRow(tr) {
    const cell = tr.children[1];
    if (!cell) return '';
    return (cell.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function applyTradeFilter(panel, filter) {
    const tb = panel.querySelector('#tradesbody') || document.getElementById('tradesbody');
    if (!tb) return;

    let shown = 0;
    let total = 0;
    tb.querySelectorAll('tr').forEach((tr) => {
      total += 1;
      const name = playerOfRow(tr);
      const ok = filter === '全部' || name === filter;
      tr.classList.toggle('xpt-hidden', !ok);
      if (ok) shown += 1;
    });

    panel.classList.toggle('xpt-no-match', shown === 0 && total > 0);

    const countEl = panel.querySelector('.xpt-count');
    if (countEl) {
      countEl.textContent =
        filter === '全部'
          ? `共 ${total} 笔`
          : `显示 ${shown} / ${total} · ${filter}`;
    }
  }

  function ensureFilterBar(panel, currentFilter) {
    let bar = panel.querySelector('#xpt-trade-filters');
    if (bar) return bar;

    bar = document.createElement('div');
    bar.id = 'xpt-trade-filters';

    PLAYERS.forEach((name) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.filter = name;
      btn.textContent = name;
      if (name === currentFilter) btn.classList.add('active');
      btn.addEventListener('click', () => {
        bar.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        saveFilter(name);
        refreshAll(name);
      });
      bar.appendChild(btn);
    });

    const h2 = panel.querySelector('h2');
    if (h2) h2.insertAdjacentElement('afterend', bar);
    else panel.prepend(bar);
    return bar;
  }

  function ensureTradeExtras(panel) {
    const h2 = panel.querySelector('h2');
    if (h2 && !h2.querySelector('.xpt-count')) {
      // 只保留标题「最近成交」文本节点，计数放后面
      const count = document.createElement('span');
      count.className = 'xpt-count';
      h2.appendChild(count);
    }

    if (!panel.querySelector('.xpt-empty')) {
      const empty = document.createElement('div');
      empty.className = 'xpt-empty';
      empty.textContent = '当前筛选下暂无成交记录';
      const wrap = panel.querySelector('.tablewrap') || panel;
      wrap.appendChild(empty);
    }
  }

  function findSourceCard(playerId) {
    const tb = document.querySelector(`[data-pos="${playerId}"]`);
    return tb ? tb.closest('.card') : null;
  }

  function findSourceTile(playerId) {
    const nav = document.querySelector(`[data-tnav="${playerId}"]`);
    return nav ? nav.closest('.tile') : null;
  }

  function ensureDashboard(tradesPanel) {
    let dash = document.getElementById('xpt-top-dashboard');
    if (!dash) {
      dash = document.createElement('div');
      dash.id = 'xpt-top-dashboard';
    }

    let posPanel = document.getElementById('xpt-pos-panel');
    if (!posPanel) {
      posPanel = document.createElement('div');
      posPanel.id = 'xpt-pos-panel';
      posPanel.className = 'panel';
      posPanel.innerHTML = `
        <h2><span class="dot" style="background:${COLORS.kimi3}"></span><span class="xpt-pos-title">持仓</span><span class="xpt-sub"></span></h2>
        <div id="xpt-pos-summary"></div>
        <div class="xpt-view" hidden></div>
        <div class="xpt-tablewrap">
          <table>
            <thead>
              <tr>
                <th>股票</th><th>股数</th><th>成本</th><th>现价</th><th>仓位</th><th>盈亏</th>
              </tr>
            </thead>
            <tbody id="xpt-pos-body"></tbody>
          </table>
        </div>
      `;
    }

    tradesPanel.id = 'xpt-trades-panel';

    // 组装顺序：持仓 | 成交
    if (dash.parentNode) {
      // already in DOM
    }

    if (posPanel.parentNode !== dash) dash.appendChild(posPanel);
    if (tradesPanel.parentNode !== dash) dash.appendChild(tradesPanel);

    // 放到页面顶部（标题区后、主 layout 前）
    const wrap = document.querySelector('.wrap');
    if (wrap) {
      const layout = wrap.querySelector('.layout');
      if (layout) layout.before(dash);
      else {
        const ticker = wrap.querySelector('#ticker');
        if (ticker) ticker.after(dash);
        else wrap.prepend(dash);
      }
    } else if (!dash.parentNode) {
      document.body.prepend(dash);
    }

    return { dash, posPanel, tradesPanel };
  }

  function renderPosPanel(filter) {
    const posPanel = document.getElementById('xpt-pos-panel');
    if (!posPanel) return;

    const name = posPlayerName(filter);
    const id = posPlayerId(filter);
    const color = COLORS[id] || '#eb6834';

    const titleDot = posPanel.querySelector('h2 .dot');
    if (titleDot) titleDot.style.background = color;

    const title = posPanel.querySelector('.xpt-pos-title');
    if (title) title.textContent = `${name} 持仓`;

    const sub = posPanel.querySelector('.xpt-sub');
    if (sub) {
      sub.textContent =
        filter === '全部' ? '（成交显示全部，持仓默认 Kimi-K3）' : '';
    }

    // 摘要：净值 / 累计 / 当日 / 徽章
    const summary = posPanel.querySelector('#xpt-pos-summary');
    const tile = findSourceTile(id);
    if (summary) {
      const nav = document.querySelector(`[data-tnav="${id}"]`)?.textContent || '—';
      const retEl = document.querySelector(`[data-tret="${id}"]`);
      const dayEl = document.querySelector(`[data-tday="${id}"]`);
      const ret = retEl ? retEl.textContent : '—';
      const day = dayEl ? dayEl.textContent : '—';
      const retCls = retEl && retEl.classList.contains('down') ? 'down' : 'up';
      const dayCls =
        dayEl && /-\d/.test(dayEl.textContent || '') ? 'down' : 'up';
      const badges = tile?.querySelector('.tbadges')?.textContent || '';
      summary.innerHTML = `
        <span class="xpt-metric">净值 <b>${escapeHtml(nav)}</b></span>
        <span class="xpt-metric">累计 <b class="${retCls}">${escapeHtml(ret)}</b></span>
        <span class="xpt-metric"><b class="${dayCls}">${escapeHtml(day)}</b></span>
        ${badges ? `<span class="xpt-badges">${escapeHtml(badges)}</span>` : ''}
      `;
    }

    // 观点
    const viewBox = posPanel.querySelector('.xpt-view');
    const card = findSourceCard(id);
    const view = card?.querySelector('.view');
    if (viewBox) {
      if (view && view.textContent.trim()) {
        viewBox.hidden = false;
        viewBox.innerHTML = view.innerHTML;
      } else {
        viewBox.hidden = true;
        viewBox.innerHTML = '';
      }
    }

    // 持仓表：克隆源 tbody 行
    const dest = posPanel.querySelector('#xpt-pos-body');
    const src = document.querySelector(`[data-pos="${id}"]`);
    if (dest) {
      if (src) dest.innerHTML = src.innerHTML;
      else dest.innerHTML = '<tr><td colspan="6" class="muted">暂无持仓数据</td></tr>';
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function refreshAll(filter) {
    const f = filter || loadFilter();
    const tradesPanel = document.getElementById('xpt-trades-panel') || findTradesPanel();
    if (tradesPanel) applyTradeFilter(tradesPanel, f);
    renderPosPanel(f);
    observeSources(f);
  }

  function observeSources(filter) {
    const id = posPlayerId(filter);
    const srcPos = document.querySelector(`[data-pos="${id}"]`);
    const srcTileNav = document.querySelector(`[data-tnav="${id}"]`);
    const srcCard = findSourceCard(id);

    if (posObserver) posObserver.disconnect();
    posObserver = new MutationObserver(() => renderPosPanel(loadFilter()));

    if (srcPos) posObserver.observe(srcPos, { childList: true, subtree: true, characterData: true });
    if (srcCard) {
      const view = srcCard.querySelector('.view');
      if (view) posObserver.observe(view, { childList: true, subtree: true, characterData: true });
    }

    if (tileObserver) tileObserver.disconnect();
    tileObserver = new MutationObserver(() => renderPosPanel(loadFilter()));
    if (srcTileNav) {
      const tile = srcTileNav.closest('.tile') || srcTileNav;
      tileObserver.observe(tile, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
    }
  }

  function patchPageRenderers() {
    const reapply = () => queueMicrotask(() => refreshAll(loadFilter()));

    const wrap = (name) => {
      const fn = window[name];
      if (typeof fn !== 'function' || fn.__xptPatched) return false;
      window[name] = function patched() {
        const ret = fn.apply(this, arguments);
        reapply();
        return ret;
      };
      window[name].__xptPatched = true;
      return true;
    };

    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const a = wrap('renderTrades');
      const b = wrap('renderPositions');
      const c = wrap('updateTiles');
      if ((a && b && c) || tries > 40) clearInterval(timer);
    }, 250);

    const tb = document.getElementById('tradesbody');
    if (tb && !tb.__xptObserved) {
      tb.__xptObserved = true;
      new MutationObserver(reapply).observe(tb, { childList: true });
    }
  }

  function init() {
    const tradesPanel = findTradesPanel();
    if (!tradesPanel) return false;
    if (bootstrapped && document.getElementById('xpt-top-dashboard')) {
      refreshAll(loadFilter());
      return true;
    }

    ensureDashboard(tradesPanel);
    ensureTradeExtras(tradesPanel);

    const filter = loadFilter();
    ensureFilterBar(tradesPanel, filter);
    refreshAll(filter);
    patchPageRenderers();

    bootstrapped = true;
    return true;
  }

  if (init()) return;

  const boot = new MutationObserver(() => {
    if (init()) boot.disconnect();
  });
  boot.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => boot.disconnect(), 15000);
})();

// ==UserScript==
// @name         xptoolkit - 曲谱下载PDF
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      2.0.0
// @description  通用曲谱图片转 A4 PDF：支持 EveryonePiano / 弹琴吧（无外部依赖）
// @author       xp9477
// @license      MIT
// @match        *://www.everyonepiano.cn/Number-*.html*
// @match        *://everyonepiano.cn/Number-*.html*
// @match        *://www.everyonepiano.cn/Stave-*.html*
// @match        *://everyonepiano.cn/Stave-*.html*
// @match        *://www.tan8.com/yuepu*
// @match        *://tan8.com/yuepu*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=everyonepiano.cn
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 通用常量
  // ---------------------------------------------------------------------------
  const STYLE_ID = 'xptoolkit-score-pdf-style';
  const PANEL_ID = 'xptoolkit-score-pdf-panel';
  const TOAST_ID = 'xptoolkit-score-pdf-toast';

  // A4 纵向（PDF 点）
  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;
  const A4_MARGIN = 16;
  const JPEG_QUALITY = 0.92;
  const MAX_PAGE_PROBE = 200;

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        bottom: 88px;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 168px;
        font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        user-select: none;
      }
      #${PANEL_ID}[data-site="tan8"] {
        left: 18px;
        right: auto;
        bottom: 18px;
      }
      #${PANEL_ID} button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        min-height: 42px;
        padding: 10px 12px;
        border: 0;
        border-radius: 999px;
        color: #fff;
        cursor: pointer;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
        transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease, filter .15s ease;
        background: linear-gradient(135deg, #16a34a 0%, #0f766e 100%);
      }
      #${PANEL_ID} button:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 14px 30px rgba(15, 23, 42, 0.24);
      }
      #${PANEL_ID} button:disabled {
        cursor: wait;
        opacity: 0.9;
        filter: saturate(0.85);
      }
      #${PANEL_ID} button.is-error {
        background: linear-gradient(135deg, #dc2626 0%, #b45309 100%) !important;
      }
      #${PANEL_ID} .xp-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(255,255,255,.95);
        box-shadow: 0 0 0 3px rgba(255,255,255,.18);
        flex: 0 0 auto;
      }
      #${PANEL_ID} .xp-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .btn-primary {
        background: linear-gradient(135deg, #16a34a 0%, #0f766e 100%);
      }
      #${PANEL_ID} .btn-xian {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      }
      #${PANEL_ID} .btn-jian {
        background: linear-gradient(135deg, #16a34a 0%, #0f766e 100%);
      }
      #${PANEL_ID} .btn-audio {
        background: linear-gradient(135deg, #9333ea 0%, #6b21a8 100%);
      }
      #${TOAST_ID} {
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        max-width: min(92vw, 420px);
        padding: 12px 16px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.92);
        color: #fff;
        font: 500 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28);
        opacity: 0;
        pointer-events: none;
        transition: opacity .18s ease;
      }
      #${TOAST_ID}.is-show { opacity: 1; }
    `;
    document.documentElement.appendChild(style);
  }

  let toastTimer = null;
  function toast(msg, ms = 2800) {
    injectStyle();
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), ms);
  }

  function setButtonState(btn, { text, disabled = false, error = false }) {
    btn.disabled = !!disabled;
    btn.classList.toggle('is-error', !!error);
    const label = btn.querySelector('.xp-label');
    if (label) label.textContent = text;
    else btn.innerHTML = `<span class="xp-dot"></span><span class="xp-label">${text}</span>`;
  }

  function createButton(className, text, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.title = title;
    btn.innerHTML = `<span class="xp-dot"></span><span class="xp-label">${text}</span>`;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      onClick(btn);
    });
    return btn;
  }

  // ---------------------------------------------------------------------------
  // 通用工具
  // ---------------------------------------------------------------------------
  function absUrl(src, base = location.href) {
    try {
      return new URL(src, base).href;
    } catch {
      return null;
    }
  }

  function sanitizeFilename(name) {
    return String(name || 'score')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'score';
  }

  function downloadBytes(bytes, filename, mime = 'application/pdf') {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function revokeBlobUrls(items) {
    for (const item of items || []) {
      if (item?.blobUrl) {
        try {
          URL.revokeObjectURL(item.blobUrl);
        } catch {
          /* ignore */
        }
      }
    }
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
  }

  function dataUrlToUint8Array(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function imageToJpegBytes(img, quality = JPEG_QUALITY) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error('图片尺寸无效');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);

    return {
      width,
      height,
      jpeg: dataUrlToUint8Array(canvas.toDataURL('image/jpeg', quality)),
    };
  }

  /**
   * 将远程图片拉取为 blob URL，避免 canvas 跨域污染。
   * @returns {{ remoteUrl: string, blobUrl: string, blob: Blob }}
   */
  async function fetchImageAsBlobItem(remoteUrl, { credentials = 'omit' } = {}) {
    const res = await fetch(remoteUrl, { credentials, cache: 'no-store' });
    if (!res.ok) throw new Error(`图片请求失败 HTTP ${res.status}`);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream')) {
      throw new Error('响应不是图片');
    }
    const blob = await res.blob();
    if (!blob || blob.size < 100) throw new Error('图片内容为空');
    return {
      remoteUrl,
      blobUrl: URL.createObjectURL(blob),
      blob,
    };
  }

  async function urlExists(url, { credentials = 'same-origin' } = {}) {
    try {
      const head = await fetch(url, { method: 'HEAD', credentials });
      if (head.ok) {
        const ct = (head.headers.get('content-type') || '').toLowerCase();
        if (!ct || ct.startsWith('image/') || ct.includes('octet-stream')) return true;
      }
      if (head.status === 405 || head.status === 501 || head.status === 403) {
        const get = await fetch(url, {
          method: 'GET',
          credentials,
          headers: { Range: 'bytes=0-0' },
        });
        return get.ok || get.status === 206;
      }
      return false;
    } catch {
      return false;
    }
  }

  function fitRect(srcW, srcH, maxW, maxH) {
    const scale = Math.min(maxW / srcW, maxH / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    return {
      w,
      h,
      x: (A4_WIDTH - w) / 2,
      y: (A4_HEIGHT - h) / 2,
    };
  }

  // 纯本地 JPEG 多页 A4 PDF
  function buildA4PdfFromJpegs(pages) {
    if (!pages.length) throw new Error('没有可导出的谱子图片');

    const encoder = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const offsets = [0];

    const pushBytes = (bytes) => {
      const arr = bytes instanceof Uint8Array ? bytes : encoder.encode(String(bytes));
      chunks.push(arr);
      offset += arr.length;
    };
    const pushText = (text) => pushBytes(encoder.encode(text));
    const startObj = (id) => {
      offsets[id] = offset;
      pushText(`${id} 0 obj\n`);
    };
    const endObj = () => pushText('\nendobj\n');

    pushText('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

    const pageCount = pages.length;
    const pageIds = [];
    for (let i = 0; i < pageCount; i++) pageIds.push(3 + i * 3);

    startObj(1);
    pushText('<< /Type /Catalog /Pages 2 0 R >>');
    endObj();

    startObj(2);
    pushText(`<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
    endObj();

    const maxW = A4_WIDTH - A4_MARGIN * 2;
    const maxH = A4_HEIGHT - A4_MARGIN * 2;

    for (let i = 0; i < pageCount; i++) {
      const page = pages[i];
      const pageId = 3 + i * 3;
      const contentId = pageId + 1;
      const imageId = pageId + 2;
      const box = fitRect(page.width, page.height, maxW, maxH);

      startObj(pageId);
      pushText(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH} ${A4_HEIGHT}] ` +
          `/Resources << /XObject << /Im${i} ${imageId} 0 R >> >> ` +
          `/Contents ${contentId} 0 R >>`
      );
      endObj();

      const contentStream =
        'q\n' +
        '1 1 1 rg\n' +
        `0 0 ${A4_WIDTH} ${A4_HEIGHT} re f\n` +
        'Q\n' +
        'q\n' +
        `${box.w.toFixed(4)} 0 0 ${box.h.toFixed(4)} ${box.x.toFixed(4)} ${box.y.toFixed(4)} cm\n` +
        `/Im${i} Do\n` +
        'Q\n';
      const contentBytes = encoder.encode(contentStream);

      startObj(contentId);
      pushText(`<< /Length ${contentBytes.length} >>\nstream\n`);
      pushBytes(contentBytes);
      pushText('\nendstream');
      endObj();

      startObj(imageId);
      pushText(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
          `/Length ${page.jpeg.length} >>\nstream\n`
      );
      pushBytes(page.jpeg);
      pushText('\nendstream');
      endObj();
    }

    const xrefOffset = offset;
    const objCount = 2 + pageCount * 3;
    pushText(`xref\n0 ${objCount + 1}\n`);
    pushText('0000000000 65535 f \n');
    for (let id = 1; id <= objCount; id++) {
      pushText(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    }
    pushText(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) {
      out.set(chunk, pos);
      pos += chunk.length;
    }
    return out;
  }

  /**
   * @param {Array<{remoteUrl?: string, blobUrl?: string}>} items
   * @param {(cur:number,total:number,stage:string)=>void} onProgress
   * @param {{credentials?: RequestCredentials}} options
   */
  async function buildPdfFromItems(items, onProgress, options = {}) {
    const credentials = options.credentials || 'omit';
    const pages = [];
    const owned = [];

    try {
      for (let i = 0; i < items.length; i++) {
        onProgress?.(i + 1, items.length, '处理');
        let blobUrl = items[i].blobUrl;
        if (!blobUrl) {
          if (!items[i].remoteUrl) throw new Error('缺少图片地址');
          // eslint-disable-next-line no-await-in-loop
          const fetched = await fetchImageAsBlobItem(items[i].remoteUrl, { credentials });
          blobUrl = fetched.blobUrl;
          owned.push(fetched);
        }
        // eslint-disable-next-line no-await-in-loop
        const img = await loadImageFromUrl(blobUrl);
        // eslint-disable-next-line no-await-in-loop
        const page = await imageToJpegBytes(img);
        pages.push(page);
      }
      onProgress?.(items.length, items.length, '打包');
      return buildA4PdfFromJpegs(pages);
    } finally {
      revokeBlobUrls(owned);
    }
  }

  async function runPdfExport({
    btn,
    defaultText,
    collect,
    filenameBase,
    credentials = 'omit',
  }) {
    let collected = [];
    try {
      setButtonState(btn, { text: '收集图片中...', disabled: true });
      collected = await collect((msg) => setButtonState(btn, { text: msg, disabled: true }));
      if (!collected.length) throw new Error('未找到谱子图片');

      const pdfBytes = await buildPdfFromItems(
        collected,
        (cur, total, stage) => {
          if (stage === '打包') setButtonState(btn, { text: '正在打包 PDF...', disabled: true });
          else setButtonState(btn, { text: `处理 ${cur}/${total}`, disabled: true });
        },
        { credentials }
      );

      const filename = `${sanitizeFilename(filenameBase)}.pdf`;
      setButtonState(btn, { text: '正在保存...', disabled: true });
      downloadBytes(pdfBytes, filename, 'application/pdf');
      toast(`已导出 ${collected.length} 页 A4 PDF`);
      setButtonState(btn, { text: `已下载 ${collected.length} 页`, disabled: false });
      setTimeout(() => {
        if (!btn.disabled) setButtonState(btn, { text: defaultText });
      }, 2600);
    } catch (err) {
      console.error('[xptoolkit-score-pdf]', err);
      const msg = err?.message ? String(err.message) : '下载失败';
      toast(msg, 3600);
      setButtonState(btn, {
        text: msg.length > 16 ? '导出失败' : msg,
        disabled: false,
        error: true,
      });
      setTimeout(() => {
        if (!btn.disabled) setButtonState(btn, { text: defaultText });
      }, 3200);
    } finally {
      revokeBlobUrls(collected);
    }
  }

  // ---------------------------------------------------------------------------
  // 站点适配：EveryonePiano
  // ---------------------------------------------------------------------------
  const EOP = {
    id: 'eop',
    match() {
      return /(?:^|\.)everyonepiano\.cn$/i.test(location.hostname);
    },

    isScoreImageUrl(url) {
      if (!url) return false;
      const u = url.toLowerCase();
      if (!u.includes('/pianomusic/')) return false;
      if (u.includes('-small.') || u.includes('/public/') || u.includes('video.jpg')) return false;
      if (/-[jw]-s-\d+\.(png|jpe?g|webp)(?:\?|$)/i.test(u)) return false;
      return /\.(png|jpe?g|webp)(?:\?|$)/i.test(u);
    },

    pageNoFromUrl(url) {
      const m = String(url).match(/-(\d+)\.(?:png|jpe?g|webp)(?:\?|$)/i);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    },

    uniqSort(urls) {
      const map = new Map();
      for (const url of urls) {
        if (!url || map.has(url)) continue;
        map.set(url, this.pageNoFromUrl(url));
      }
      return [...map.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([url]) => url);
    },

    extractFromDoc(doc, base = location.href) {
      const selectors = [
        'img.DownMusicPNG',
        '#ul1 img.DownMusicPNG',
        '#DownloadDiv .PngDiv img',
        '#DownloadDiv img',
      ];
      const urls = [];
      for (const sel of selectors) {
        doc.querySelectorAll(sel).forEach((img) => {
          const raw = img.getAttribute('src') || img.getAttribute('data-src') || '';
          const url = absUrl(raw, base);
          if (this.isScoreImageUrl(url)) urls.push(url);
        });
      }
      return this.uniqSort(urls);
    },

    normalizeKind(kind) {
      return /^stave$/i.test(kind) ? 'Stave' : 'Number';
    },

    getScoreMeta() {
      const m = location.pathname.match(/\/(Number|Stave)-(\d+)/i);
      return m ? { kind: this.normalizeKind(m[1]), id: m[2] } : null;
    },

    async expandImageSequence(urls) {
      if (!urls.length) return urls;
      const sorted = this.uniqSort(urls);
      const first = sorted[0];
      const m = first.match(/^(.*-)(\d+)(\.(?:png|jpe?g|webp))(?:\?.*)?$/i);
      if (!m) return sorted;

      const prefix = m[1];
      const ext = m[3];
      let max = 0;
      for (const url of sorted) max = Math.max(max, this.pageNoFromUrl(url));

      const out = [...sorted];
      for (let i = max + 1; i <= max + 40; i++) {
        const next = absUrl(`${prefix}${i}${ext}`, location.origin);
        // eslint-disable-next-line no-await-in-loop
        const ok = await urlExists(next, { credentials: 'same-origin' });
        if (!ok) break;
        out.push(next);
      }
      return this.uniqSort(out);
    },

    async collectImageUrls(onStatus) {
      onStatus?.('扫描页面图片...');
      let urls = this.extractFromDoc(document);
      const meta = this.getScoreMeta();

      if (meta) {
        const mainPath = `/${meta.kind}-${meta.id}.html`;
        const onMain = location.pathname.replace(/\/+$/, '').toLowerCase().endsWith(mainPath.toLowerCase());
        if (!onMain || urls.length <= 1) {
          try {
            onStatus?.('读取主预览页...');
            const res = await fetch(mainPath, { credentials: 'same-origin', cache: 'no-cache' });
            if (res.ok) {
              const html = await res.text();
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const mainUrls = this.extractFromDoc(doc, new URL(mainPath, location.origin).href);
              if (mainUrls.length > urls.length) urls = mainUrls;
            }
          } catch (err) {
            console.warn('[xptoolkit-score-pdf] eop main viewer', err);
          }
        }
      }

      onStatus?.('扩展连续页...');
      urls = await this.expandImageSequence(urls);
      return this.uniqSort(urls).map((remoteUrl) => ({ remoteUrl }));
    },

    getTitle() {
      const musicTitle = document.querySelector('#musicTitle')?.textContent?.trim();
      if (musicTitle) return musicTitle;

      const alt = document.querySelector('img.DownMusicPNG')?.getAttribute('alt')?.trim();
      if (alt) return alt.replace(/预览\d*$/, '').trim();

      const title = document.title || '';
      return (
        title
          .replace(/-EOP.*$/i, '')
          .replace(/双手简谱预览.*$/i, '')
          .replace(/五线谱预览.*$/i, '')
          .replace(/钢琴谱文件.*$/i, '')
          .trim() || 'everyonepiano-score'
      );
    },

    getKindLabel() {
      return /\/stave-/i.test(location.pathname) ? '五线谱' : '简谱';
    },

    mount() {
      injectStyle();
      if (document.getElementById(PANEL_ID)) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.dataset.site = this.id;

      const defaultText = '一键下载 PDF';
      const btn = createButton(
        'btn-primary',
        defaultText,
        '按顺序合并当前谱子图片并下载 A4 PDF',
        (button) => {
          runPdfExport({
            btn: button,
            defaultText,
            credentials: 'same-origin',
            collect: (onStatus) => this.collectImageUrls(onStatus),
            filenameBase: `${this.getTitle()}-${this.getKindLabel()}-A4`,
          });
        }
      );

      panel.appendChild(btn);
      document.body.appendChild(panel);
    },
  };

  // ---------------------------------------------------------------------------
  // 站点适配：弹琴吧
  // ---------------------------------------------------------------------------
  const TAN8 = {
    id: 'tan8',
    match() {
      return /(?:^|\.)tan8\.com$/i.test(location.hostname);
    },

    getTitle() {
      const selectors = [
        '.yuepu-text-info li:nth-child(2) p',
        '.yuepu-text-info p',
        'h1',
        '.song-name',
        '.title',
      ];
      for (const sel of selectors) {
        const text = document.querySelector(sel)?.textContent?.trim();
        if (text) return text;
      }
      const title = (document.title || '')
        .replace(/[-_|].*弹琴吧.*$/i, '')
        .replace(/曲谱.*$/i, '')
        .trim();
      return title || 'tan8-score';
    },

    getYpid() {
      if (typeof window.ypid !== 'undefined' && window.ypid != null && String(window.ypid).trim()) {
        return String(window.ypid).trim();
      }
      const m =
        location.href.match(/[?&](?:id|ypid|yuepu_id)=(\d+)/i) ||
        location.pathname.match(/yuepu[_-]?(\d+)/i) ||
        location.pathname.match(/\/(\d+)\.html?/i);
      return m ? m[1] : null;
    },

    getScoreArray(kind) {
      const candidates =
        kind === 'xian'
          ? ['yuepuArrXian', 'yuepuArrStandard', 'yuepu_arr_xian']
          : ['yuepuArrJian', 'yuepuArrSimple', 'yuepu_arr_jian'];
      for (const key of candidates) {
        const val = window[key];
        if (Array.isArray(val) && val.length) return val;
      }
      return null;
    },

    extractImageBase(arr, ypid) {
      if (!Array.isArray(arr) || !arr.length) {
        throw new Error('未找到曲谱图片数据（可能未登录/无 VIP 权限）');
      }

      let firstUrl = null;
      for (const item of arr) {
        const img = item?.img;
        if (Array.isArray(img) && img[0]) {
          firstUrl = String(img[0]);
          break;
        }
        if (typeof img === 'string' && img) {
          firstUrl = img;
          break;
        }
        if (item?.src) {
          firstUrl = String(item.src);
          break;
        }
        if (typeof item === 'string' && /\.(png|jpe?g|webp)/i.test(item)) {
          firstUrl = item;
          break;
        }
      }
      if (!firstUrl) throw new Error('曲谱图片 URL 为空');

      const match = firstUrl.match(
        /(https?:\/\/oss\.tan8\.com\/yuepuku\/\d+\/\d+\/)\d+_([a-z0-9]+)_([a-z0-9]+)\/+[^/?#]+/i
      );
      if (match) {
        const pre = match[1];
        const cid = match[2];
        const typ = match[3];
        const id = ypid || this.getYpid() || firstUrl.match(/\/(\d+)_[a-z0-9]+_[a-z0-9]+\//i)?.[1];
        if (!id) throw new Error('无法解析曲谱 ID (ypid)');
        return {
          base: `${pre}${id}_${cid}_${typ}/${id}_${cid}.ypad.`,
          typ,
          cid,
          ypid: id,
          sampleUrl: firstUrl,
          ext: '.png',
        };
      }

      const loose = firstUrl.match(/^(https?:\/\/.+?)(\d+)(\.(?:png|jpe?g|webp))(?:\?.*)?$/i);
      if (loose) {
        return {
          base: loose[1],
          typ: 'unknown',
          cid: '',
          ypid: ypid || this.getYpid() || '',
          sampleUrl: firstUrl,
          ext: loose[3],
        };
      }

      throw new Error('URL 解析失败，页面结构可能已变化');
    },

    async collectImageUrls(baseInfo, onStatus) {
      const urls = [];
      const ext = baseInfo.ext || '.png';
      for (let page = 0; page < MAX_PAGE_PROBE; page++) {
        const remoteUrl = `${baseInfo.base}${page}${ext}`;
        onStatus?.(`收集第 ${page + 1} 页...`);
        try {
          // eslint-disable-next-line no-await-in-loop
          const item = await fetchImageAsBlobItem(remoteUrl, { credentials: 'omit' });
          urls.push(item);
        } catch (err) {
          if (urls.length) break;
          // 首张就失败才抛出
          if (String(err?.message || '').includes('HTTP 404') || String(err?.message || '').includes('HTTP 403')) {
            break;
          }
          throw err;
        }
      }
      if (!urls.length) throw new Error('未获取到任何曲谱图片');
      return urls;
    },

    async downloadScorePdf(kind, btn) {
      const defaultText = kind === 'xian' ? '线谱 PDF (A4)' : '简谱 PDF (A4)';
      const kindLabel = kind === 'xian' ? '线谱' : '简谱';

      await runPdfExport({
        btn,
        defaultText,
        credentials: 'omit',
        filenameBase: `${this.getTitle()}-${kindLabel}-A4`,
        collect: async (onStatus) => {
          onStatus('读取页面数据...');
          const arr = this.getScoreArray(kind);
          if (!arr) {
            throw new Error(`未找到${kindLabel}数据（yuepuArr${kind === 'xian' ? 'Xian' : 'Jian'}）`);
          }
          const baseInfo = this.extractImageBase(arr, this.getYpid());
          return this.collectImageUrls(baseInfo, onStatus);
        },
      });
    },

    async downloadAudio(btn) {
      const defaultText = '下载预览音频';
      try {
        setButtonState(btn, { text: '查找音频...', disabled: true });
        const audioElement = document.getElementById('myAudio');
        const source = audioElement?.querySelector?.('source');
        const audioUrl =
          source?.src ||
          audioElement?.src ||
          document.querySelector('audio source')?.src ||
          document.querySelector('audio')?.src;

        if (!audioUrl) throw new Error('未找到音频元素');

        setButtonState(btn, { text: '下载中...', disabled: true });
        const res = await fetch(audioUrl, { credentials: 'omit', cache: 'no-store' });
        if (!res.ok) throw new Error(`音频请求失败 HTTP ${res.status}`);
        const blob = await res.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const filename = `${sanitizeFilename(`${this.getTitle()}-preview`)}.mp3`;
        downloadBytes(bytes, filename, blob.type || 'audio/mpeg');
        toast(`已下载预览音频：${filename}`);
        setButtonState(btn, { text: '音频已下载', disabled: false });
        setTimeout(() => {
          if (!btn.disabled) setButtonState(btn, { text: defaultText });
        }, 2400);
      } catch (err) {
        console.error('[xptoolkit-score-pdf]', err);
        const msg = err?.message ? String(err.message) : '音频下载失败';
        toast(msg, 3600);
        setButtonState(btn, { text: '音频失败', disabled: false, error: true });
        setTimeout(() => {
          if (!btn.disabled) setButtonState(btn, { text: defaultText });
        }, 3000);
      }
    },

    mount() {
      injectStyle();
      if (document.getElementById(PANEL_ID)) return;

      const panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.dataset.site = this.id;

      panel.appendChild(
        createButton('btn-xian', '线谱 PDF (A4)', '按页收集线谱图片并合并为 A4 PDF', (btn) =>
          this.downloadScorePdf('xian', btn)
        )
      );
      panel.appendChild(
        createButton('btn-jian', '简谱 PDF (A4)', '按页收集简谱图片并合并为 A4 PDF', (btn) =>
          this.downloadScorePdf('jian', btn)
        )
      );
      panel.appendChild(
        createButton('btn-audio', '下载预览音频', '下载页面预览音频', (btn) => this.downloadAudio(btn))
      );

      document.body.appendChild(panel);
    },
  };

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------
  const adapters = [EOP, TAN8];

  function boot() {
    const site = adapters.find((a) => a.match());
    if (!site) return;
    site.mount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

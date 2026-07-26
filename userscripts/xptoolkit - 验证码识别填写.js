// ==UserScript==
// @name         xptoolkit - 验证码识别填写
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      0.1.0
// @description  使用 OpenAI 兼容的视觉模型识别并填写验证码字段。
// @author       xp9477
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'captcha-filler-config-v1';
  const SYNC_STORAGE_KEY = 'captcha-filler-webdav-v1';
  const UI_ATTR = 'data-captcha-filler-ui';
  const DEFAULT_PROMPT = [
    'Read the captcha in this image.',
    'Return only the exact characters shown in the captcha.',
    'Do not add explanations, punctuation, spaces, or Markdown.'
  ].join(' ');

  const state = {
    config: loadConfig(),
    sync: loadSyncSettings(),
    syncTimer: null,
    syncInFlight: null,
    activeSite: null,
    buttonHost: null,
    input: null,
    observer: null,
    positioningBound: false
  };

  registerMenus();
  activateMatchingSite();
  startWebDavSync();

  function defaultConfig() {
    return {
      version: 1,
      backend: {
        baseUrl: '',
        apiKey: '',
        model: '',
        prompt: DEFAULT_PROMPT
      },
      sites: [],
      updatedAt: ''
    };
  }

  function loadConfig() {
    const fallback = defaultConfig();
    try {
      const saved = GM_getValue(STORAGE_KEY, null);
      if (!saved) return fallback;
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      return {
        ...fallback,
        ...parsed,
        backend: { ...fallback.backend, ...(parsed.backend || {}) },
        sites: Array.isArray(parsed.sites) ? parsed.sites : []
      };
    } catch (error) {
      console.error('[Captcha Filler] Failed to load configuration:', error);
      return fallback;
    }
  }

  function saveConfig({ touch = true, sync = true } = {}) {
    if (touch) state.config.updatedAt = new Date().toISOString();
    GM_setValue(STORAGE_KEY, JSON.stringify(state.config));
    if (sync) scheduleWebDavUpload();
  }

  function defaultSyncSettings() {
    return {
      enabled: false,
      fileUrl: '',
      username: '',
      password: '',
      syncApiKey: false,
      deviceId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      lastSyncedAt: '',
      lastError: ''
    };
  }

  function loadSyncSettings() {
    const fallback = defaultSyncSettings();
    try {
      const saved = GM_getValue(SYNC_STORAGE_KEY, null);
      if (!saved) return fallback;
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      return { ...fallback, ...parsed };
    } catch (error) {
      console.error('[Captcha Filler] Failed to load WebDAV settings:', error);
      return fallback;
    }
  }

  function saveSyncSettings() {
    GM_setValue(SYNC_STORAGE_KEY, JSON.stringify(state.sync));
  }

  function registerMenus() {
    GM_registerMenuCommand('Captcha Filler：打开设置', openMainMenu);
  }

  function openMainMenu() {
    const host = openModal({
      title: 'Captcha Filler',
      content: `
        <div class="action-list">
          <button type="button" class="action-item" data-panel="sync">
            <strong>自动同步</strong>
            <small>${escapeHtml(syncStatusText())}</small>
          </button>
          <button type="button" class="action-item" data-panel="backend">
            <strong>AI 后端设置</strong>
            <small>配置接口地址、API Key、模型和提示词</small>
          </button>
          <button type="button" class="action-item" data-panel="setup">
            <strong>配置当前网页</strong>
            <small>选择验证码图片、输入框和生效范围</small>
          </button>
          <button type="button" class="action-item" data-panel="sites">
            <strong>管理站点配置</strong>
            <small>查看或删除已经保存的网页规则</small>
          </button>
          <button type="button" class="action-item" data-panel="export">
            <strong>导出全部配置</strong>
            <small>复制包含后端和站点规则的 JSON</small>
          </button>
          <button type="button" class="action-item" data-panel="import">
            <strong>导入配置</strong>
            <small>从另一台设备恢复配置 JSON</small>
          </button>
        </div>
      `,
      confirmText: '关闭',
      hideCancel: true,
      onConfirm() { }
    });

    const actions = {
      sync: openSyncSettings,
      backend: openBackendSettings,
      setup: startPageSetup,
      sites: openSiteManager,
      export: exportConfig,
      import: importConfig
    };
    host.shadowRoot.querySelectorAll('[data-panel]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = actions[button.dataset.panel];
        host.remove();
        action?.();
      });
    });
  }

  function syncStatusText() {
    if (!state.sync.enabled) return '使用 WebDAV 在设备之间同步配置';
    if (state.sync.lastError) return `同步异常：${state.sync.lastError}`;
    if (state.sync.lastSyncedAt) {
      return `已启用，上次同步 ${new Date(state.sync.lastSyncedAt).toLocaleString()}`;
    }
    return '已启用，等待首次同步';
  }

  function openSyncSettings() {
    openModal({
      title: 'WebDAV 自动同步',
      content: `
        <label class="check-row">
          <input name="enabled" type="checkbox">
          <span>启用自动同步</span>
        </label>
        <label>配置文件 URL
          <input name="fileUrl" type="url" autocomplete="off" placeholder="https://dav.example.com/path/captcha-filler.json">
          <small>填写最终文件地址，不是目录地址。父目录必须已经存在。</small>
        </label>
        <label>用户名
          <input name="username" type="text" autocomplete="username">
        </label>
        <label>密码或应用密码
          <input name="password" type="password" autocomplete="current-password">
        </label>
        <label class="check-row">
          <input name="syncApiKey" type="checkbox">
          <span>同时同步 OpenAI API Key</span>
        </label>
        <p class="notice warning">WebDAV 凭据始终只保存在当前设备。同步文件目前是 JSON 明文，建议不要同步 OpenAI API Key，并且必须使用 HTTPS。</p>
        <p class="notice">${escapeHtml(syncStatusText())}</p>
      `,
      values: state.sync,
      confirmText: '保存并同步',
      async onConfirm(values) {
        const enabled = values.enabled === 'on';
        const fileUrl = values.fileUrl.trim();
        const username = values.username.trim();
        const password = values.password;
        if (enabled && (!fileUrl || !username || !password)) {
          throw new Error('启用同步时必须填写文件 URL、用户名和密码');
        }
        if (enabled) validateWebDavUrl(fileUrl);

        state.sync = {
          ...state.sync,
          enabled,
          fileUrl,
          username,
          password,
          syncApiKey: values.syncApiKey === 'on',
          lastError: ''
        };
        saveSyncSettings();
        clearTimeout(state.syncTimer);
        if (enabled) await synchronizeWebDav();
        showToast(enabled ? 'WebDAV 设置已保存并完成同步' : 'WebDAV 自动同步已关闭');
      }
    });
  }

  function validateWebDavUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      throw new Error('WebDAV 文件 URL 无效');
    }
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
      throw new Error('WebDAV 必须使用 HTTPS（本机地址除外）');
    }
  }

  function startWebDavSync() {
    if (!state.sync.enabled) return;
    setTimeout(() => {
      synchronizeWebDav().catch((error) => {
        console.error('[Captcha Filler] Initial WebDAV sync failed:', error);
      });
    }, 0);
  }

  function scheduleWebDavUpload() {
    if (!state.sync.enabled) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(() => {
      uploadWebDavConfig().catch((error) => {
        recordSyncError(error);
        console.error('[Captcha Filler] WebDAV upload failed:', error);
      });
    }, 1200);
  }

  function synchronizeWebDav() {
    if (!state.sync.enabled) return Promise.resolve();
    if (state.syncInFlight) return state.syncInFlight;
    state.syncInFlight = performWebDavSync()
      .finally(() => { state.syncInFlight = null; });
    return state.syncInFlight;
  }

  async function performWebDavSync() {
    const response = await webDavRequest('GET');
    if (response.status === 404 || response.status === 410) {
      await uploadWebDavConfig();
      return;
    }
    if (response.status === 401 || response.status === 403) {
      throw recordSyncError(new Error('WebDAV 认证失败或没有文件权限'));
    }
    if (response.status < 200 || response.status >= 300) {
      throw recordSyncError(new Error(`WebDAV 下载失败（HTTP ${response.status}）`));
    }

    let envelope;
    try {
      envelope = JSON.parse(response.responseText);
    } catch (error) {
      throw recordSyncError(new Error('远程同步文件不是有效 JSON'));
    }
    if (envelope.format !== 'captcha-filler-webdav' || !envelope.config) {
      throw recordSyncError(new Error('远程文件不是 Captcha Filler 同步配置'));
    }

    const remoteTime = Date.parse(envelope.updatedAt || envelope.config.updatedAt || '') || 0;
    const localTime = Date.parse(state.config.updatedAt || '') || 0;
    if (remoteTime > localTime) {
      applyRemoteConfig(envelope.config);
      markSyncSuccess();
    } else if (localTime > remoteTime) {
      await uploadWebDavConfig();
    } else {
      markSyncSuccess();
    }
  }

  async function uploadWebDavConfig() {
    if (!state.sync.enabled) return;
    if (!state.config.updatedAt) {
      state.config.updatedAt = new Date().toISOString();
      saveConfig({ touch: false, sync: false });
    }
    const remoteConfig = {
      version: state.config.version,
      backend: {
        baseUrl: state.config.backend.baseUrl,
        model: state.config.backend.model,
        prompt: state.config.backend.prompt,
        ...(state.sync.syncApiKey ? { apiKey: state.config.backend.apiKey } : {})
      },
      sites: state.config.sites,
      updatedAt: state.config.updatedAt
    };
    const payload = JSON.stringify({
      format: 'captcha-filler-webdav',
      version: 1,
      updatedAt: state.config.updatedAt,
      deviceId: state.sync.deviceId,
      config: remoteConfig
    }, null, 2);
    const response = await webDavRequest('PUT', payload);
    if (![200, 201, 204].includes(response.status)) {
      throw recordSyncError(new Error(`WebDAV 上传失败（HTTP ${response.status}）`));
    }
    markSyncSuccess();
  }

  function applyRemoteConfig(remote) {
    const localApiKey = state.config.backend.apiKey;
    const fallback = defaultConfig();
    state.config = {
      ...fallback,
      ...remote,
      backend: {
        ...fallback.backend,
        ...(remote.backend || {}),
        apiKey: state.sync.syncApiKey && remote.backend?.apiKey
          ? remote.backend.apiKey
          : localApiKey
      },
      sites: Array.isArray(remote.sites) ? remote.sites : []
    };
    saveConfig({ touch: false, sync: false });
    refreshMatchingSite();
  }

  function webDavRequest(method, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: state.sync.fileUrl,
        headers: {
          'Authorization': basicAuthorization(state.sync.username, state.sync.password),
          ...(data ? { 'Content-Type': 'application/json; charset=utf-8' } : {})
        },
        data,
        timeout: 30000,
        onload: resolve,
        onerror: () => reject(recordSyncError(new Error('连接 WebDAV 失败'))),
        ontimeout: () => reject(recordSyncError(new Error('WebDAV 请求超时')))
      });
    });
  }

  function basicAuthorization(username, password) {
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return `Basic ${btoa(binary)}`;
  }

  function markSyncSuccess() {
    state.sync.lastSyncedAt = new Date().toISOString();
    state.sync.lastError = '';
    saveSyncSettings();
  }

  function recordSyncError(error) {
    state.sync.lastError = error.message || String(error);
    saveSyncSettings();
    return error;
  }

  function activateMatchingSite() {
    refreshMatchingSite();
  }

  function refreshMatchingSite() {
    state.observer?.disconnect();
    state.observer = null;
    state.input = null;
    state.buttonHost?.remove();
    state.buttonHost = null;
    state.activeSite = findMatchingSite();
    if (!state.activeSite) return;

    mountForActiveSite();
    state.observer = new MutationObserver(debounce(mountForActiveSite, 120));
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function findMatchingSite() {
    const matches = state.config.sites.filter((site) => {
      if (site.origin !== location.origin) return false;
      if (site.scope === 'origin') return true;
      if (site.scope === 'prefix') return location.pathname.startsWith(site.path);
      return location.pathname === site.path;
    });

    return matches.sort((a, b) => {
      const scopeScore = { exact: 3, prefix: 2, origin: 1 };
      return (scopeScore[b.scope] - scopeScore[a.scope]) ||
        ((b.path || '').length - (a.path || '').length);
    })[0] || null;
  }

  function mountForActiveSite() {
    if (!state.activeSite) return;
    const input = safeQuery(state.activeSite.inputSelector);
    if (!input || !isEditable(input)) {
      state.input = null;
      state.buttonHost?.remove();
      state.buttonHost = null;
      return;
    }

    if (state.input === input && state.buttonHost?.isConnected) {
      positionRecognitionButton();
      return;
    }

    state.input = input;
    createRecognitionButton();
  }

  function createRecognitionButton() {
    state.buttonHost?.remove();
    const host = document.createElement('div');
    host.setAttribute(UI_ATTR, 'recognition-button');
    Object.assign(host.style, {
      position: 'fixed',
      zIndex: '2147483646',
      width: '58px',
      height: '30px'
    });

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        button {
          box-sizing: border-box;
          width: 58px;
          height: 30px;
          border: 1px solid #0f766e;
          border-radius: 5px;
          background: #0f766e;
          color: #fff;
          font: 600 12px/1 system-ui, sans-serif;
          letter-spacing: 0;
          cursor: pointer;
          box-shadow: 0 1px 3px rgb(0 0 0 / 22%);
        }
        button:hover { background: #115e59; }
        button:focus-visible { outline: 2px solid #14b8a6; outline-offset: 2px; }
        button:disabled { cursor: wait; opacity: .72; }
        button[data-state="error"] { border-color: #b91c1c; background: #b91c1c; }
        button[data-state="done"] { border-color: #166534; background: #166534; }
      </style>
      <button type="button" title="识别验证码并填入">识别</button>
    `;
    const button = root.querySelector('button');
    button.addEventListener('click', () => recognizeAndFill(button));
    document.documentElement.appendChild(host);
    state.buttonHost = host;
    positionRecognitionButton();

    if (!state.positioningBound) {
      window.addEventListener('scroll', positionRecognitionButton, true);
      window.addEventListener('resize', positionRecognitionButton);
      state.positioningBound = true;
    }
  }

  function positionRecognitionButton() {
    if (!state.buttonHost || !state.input?.isConnected) return;
    const rect = state.input.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight) {
      state.buttonHost.style.display = 'none';
      return;
    }

    state.buttonHost.style.display = 'block';
    const width = 58;
    const height = 30;
    const gap = 6;
    const fitsRight = rect.right + gap + width <= innerWidth - 4;
    const left = fitsRight ? rect.right + gap : Math.max(4, rect.right - width);
    const top = fitsRight
      ? Math.max(4, Math.min(innerHeight - height - 4, rect.top + (rect.height - height) / 2))
      : Math.max(4, rect.top - height - 4);
    state.buttonHost.style.left = `${Math.round(left)}px`;
    state.buttonHost.style.top = `${Math.round(top)}px`;
  }

  async function recognizeAndFill(button) {
    const backend = state.config.backend;
    if (!backend.baseUrl || !backend.apiKey || !backend.model) {
      setButtonState(button, 'error', '未设置');
      openBackendSettings();
      return;
    }

    const imageElement = safeQuery(state.activeSite.imageSelector);
    if (!imageElement) {
      setButtonState(button, 'error', '找不到图');
      return;
    }

    button.disabled = true;
    setButtonState(button, 'loading', '识别中');
    try {
      const dataUrl = await elementToDataUrl(imageElement);
      const answer = await requestVisionModel(dataUrl, backend);
      if (!answer) throw new Error('模型没有返回可填入的内容');
      setEditableValue(state.input, answer);
      setButtonState(button, 'done', '已填入');
    } catch (error) {
      console.error('[Captcha Filler] Recognition failed:', error);
      setButtonState(button, 'error', '失败');
      showToast(`识别失败：${error.message || error}`, 'error');
    } finally {
      button.disabled = false;
      setTimeout(() => setButtonState(button, '', '识别'), 1800);
    }
  }

  function setButtonState(button, status, label) {
    button.dataset.state = status;
    button.textContent = label;
  }

  async function elementToDataUrl(element) {
    if (element instanceof HTMLCanvasElement) {
      try {
        return element.toDataURL('image/png');
      } catch (error) {
        throw new Error('无法读取 Canvas，可能受到跨域限制');
      }
    }

    if (element instanceof SVGElement) {
      const xml = new XMLSerializer().serializeToString(element);
      return blobToDataUrl(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    }

    let source = '';
    if (element instanceof HTMLImageElement) {
      source = element.currentSrc || element.src;
    } else {
      const background = getComputedStyle(element).backgroundImage;
      const match = background.match(/^url\(["']?(.*?)["']?\)$/);
      source = match?.[1] || '';
    }

    if (!source) throw new Error('选中的元素没有可读取的图片');
    if (source.startsWith('data:')) return source;
    if (source.startsWith('blob:')) {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`读取图片失败（HTTP ${response.status}）`);
      return blobToDataUrl(await response.blob());
    }
    return requestImageAsDataUrl(new URL(source, location.href).href);
  }

  function requestImageAsDataUrl(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`读取验证码图片失败（HTTP ${response.status}）`));
            return;
          }
          const contentType = headerValue(response.responseHeaders, 'content-type') || 'image/png';
          blobToDataUrl(new Blob([response.response], { type: contentType })).then(resolve, reject);
        },
        onerror: () => reject(new Error('读取验证码图片时发生网络错误')),
        ontimeout: () => reject(new Error('读取验证码图片超时')),
        timeout: 20000
      });
    });
  }

  function requestVisionModel(dataUrl, backend) {
    const url = completionUrl(backend.baseUrl);
    const body = {
      model: backend.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: backend.prompt || DEFAULT_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
        ]
      }],
      temperature: 0,
      max_tokens: 64
    };

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {
          'Authorization': `Bearer ${backend.apiKey}`,
          'Content-Type': 'application/json'
        },
        data: JSON.stringify(body),
        timeout: 45000,
        onload(response) {
          let payload;
          try {
            payload = JSON.parse(response.responseText);
          } catch (error) {
            reject(new Error(`AI 后端返回了非 JSON 内容（HTTP ${response.status}）`));
            return;
          }
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(payload.error?.message || `AI 请求失败（HTTP ${response.status}）`));
            return;
          }
          const content = payload.choices?.[0]?.message?.content;
          const text = Array.isArray(content)
            ? content.map((part) => part.text || '').join('')
            : content;
          resolve(cleanModelAnswer(text));
        },
        onerror: () => reject(new Error('连接 AI 后端失败')),
        ontimeout: () => reject(new Error('AI 请求超时'))
      });
    });
  }

  function completionUrl(baseUrl) {
    const trimmed = String(baseUrl).trim().replace(/\/+$/, '');
    return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
  }

  function cleanModelAnswer(content) {
    if (typeof content !== 'string') return '';
    let value = content.trim()
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/\s*```$/, '')
      .split(/\r?\n/)[0]
      .trim();
    value = value.replace(/^(?:captcha|验证码|答案|answer)\s*[:：]\s*/i, '');
    value = value.replace(/^["'`]+|["'`]+$/g, '');
    return value.replace(/\s+/g, '');
  }

  function setEditableValue(element, value) {
    element.focus();
    if (element.isContentEditable) {
      element.textContent = value;
    } else {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    }
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: value
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function openBackendSettings() {
    const current = state.config.backend;
    openModal({
      title: 'AI 后端设置',
      content: `
        <label>接口地址
          <input name="baseUrl" type="url" autocomplete="off" placeholder="https://api.openai.com/v1">
          <small>填写 OpenAI 兼容 API 的基础地址或完整 /chat/completions 地址。</small>
        </label>
        <label>API Key
          <input name="apiKey" type="password" autocomplete="new-password" placeholder="sk-...">
        </label>
        <label>模型名称
          <input name="model" type="text" autocomplete="off" placeholder="gpt-4.1-mini">
          <small>模型必须支持图片输入。</small>
        </label>
        <label>识别提示词
          <textarea name="prompt" rows="4"></textarea>
        </label>
        <p class="notice">Key 保存在 Tampermonkey 本机存储中。验证码图片会发送到你填写的后端。</p>
      `,
      values: current,
      confirmText: '保存',
      onConfirm(values) {
        if (!values.baseUrl || !values.apiKey || !values.model) {
          throw new Error('接口地址、API Key 和模型名称都必须填写');
        }
        state.config.backend = {
          baseUrl: values.baseUrl.trim(),
          apiKey: values.apiKey.trim(),
          model: values.model.trim(),
          prompt: values.prompt.trim() || DEFAULT_PROMPT
        };
        saveConfig();
        showToast('AI 后端设置已保存');
      }
    });
  }

  async function startPageSetup() {
    closeAllUi();
    try {
      const image = await pickElement({
        message: '第 1 步：点击验证码图片',
        validate: normalizeImageElement,
        invalidMessage: '请选择图片、Canvas、SVG 或有背景图的元素'
      });
      const input = await pickElement({
        message: '第 2 步：点击验证码输入框',
        validate: normalizeInputElement,
        invalidMessage: '请选择输入框、文本域或可编辑元素'
      });
      openScopeDialog(image, input);
    } catch (error) {
      if (error.message !== 'cancelled') showToast(error.message, 'error');
    }
  }

  function openScopeDialog(image, input) {
    openModal({
      title: '保存当前网页配置',
      content: `
        <label>生效范围
          <select name="scope">
            <option value="exact">仅当前路径</option>
            <option value="prefix">当前路径及子路径</option>
            <option value="origin">当前网站全部页面</option>
          </select>
        </label>
        <label>配置名称
          <input name="name" type="text" placeholder="例如：登录页">
        </label>
        <p class="notice">图片：<code>${escapeHtml(buildSelector(image))}</code><br>输入框：<code>${escapeHtml(buildSelector(input))}</code></p>
      `,
      values: { scope: 'exact', name: document.title || location.hostname },
      confirmText: '保存并启用',
      onConfirm(values) {
        const site = {
          id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: values.name.trim() || location.hostname,
          origin: location.origin,
          path: location.pathname,
          scope: values.scope,
          imageSelector: buildSelector(image),
          inputSelector: buildSelector(input),
          updatedAt: new Date().toISOString()
        };
        state.config.sites = state.config.sites.filter((existing) => !(
          existing.origin === site.origin &&
          existing.path === site.path &&
          existing.scope === site.scope
        ));
        state.config.sites.push(site);
        saveConfig();
        state.activeSite = site;
        mountForActiveSite();
        showToast('网页配置已保存');
      }
    });
  }

  function pickElement({ message, validate, invalidMessage }) {
    return new Promise((resolve, reject) => {
      const banner = document.createElement('div');
      banner.setAttribute(UI_ATTR, 'picker');
      Object.assign(banner.style, {
        position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483647', padding: '10px 14px', border: '1px solid #0f766e',
        borderRadius: '6px', background: '#fff', color: '#111827',
        boxShadow: '0 6px 24px rgb(0 0 0 / 25%)', font: '600 14px/1.4 system-ui, sans-serif',
        letterSpacing: '0'
      });
      banner.textContent = `${message}（按 Esc 取消）`;
      document.documentElement.appendChild(banner);

      let highlighted = null;
      let oldOutline = '';
      let oldOutlineOffset = '';

      function cleanup() {
        restoreHighlight();
        banner.remove();
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeydown, true);
      }

      function restoreHighlight() {
        if (!highlighted) return;
        highlighted.style.outline = oldOutline;
        highlighted.style.outlineOffset = oldOutlineOffset;
        highlighted = null;
      }

      function onMove(event) {
        const candidate = validate(event.target);
        if (!candidate || candidate.closest?.(`[${UI_ATTR}]`) || candidate === highlighted) return;
        restoreHighlight();
        highlighted = candidate;
        oldOutline = candidate.style.outline;
        oldOutlineOffset = candidate.style.outlineOffset;
        candidate.style.outline = '3px solid #14b8a6';
        candidate.style.outlineOffset = '2px';
      }

      function onClick(event) {
        if (event.target.closest?.(`[${UI_ATTR}]`)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const candidate = validate(event.target);
        if (!candidate) {
          banner.textContent = `${invalidMessage}（按 Esc 取消）`;
          banner.style.borderColor = '#b91c1c';
          return;
        }
        cleanup();
        resolve(candidate);
      }

      function onKeydown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        cleanup();
        reject(new Error('cancelled'));
      }

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeydown, true);
    });
  }

  function normalizeImageElement(target) {
    if (!(target instanceof Element)) return null;
    const direct = target.closest('img, canvas, svg');
    if (direct) return direct;
    return getComputedStyle(target).backgroundImage !== 'none' ? target : null;
  }

  function normalizeInputElement(target) {
    if (!(target instanceof Element)) return null;
    const input = target.closest('input, textarea, [contenteditable="true"]');
    return input && isEditable(input) ? input : null;
  }

  function isEditable(element) {
    if (element?.isContentEditable) return true;
    if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
    if (!(element instanceof HTMLInputElement)) return false;
    return !element.disabled && !element.readOnly && ![
      'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'
    ].includes(element.type);
  }

  function buildSelector(element) {
    if (element.id) {
      const selector = `#${cssEscape(element.id)}`;
      if (safeQueryAll(selector).length === 1) return selector;
    }

    for (const attribute of ['data-testid', 'data-test', 'data-cy', 'name', 'aria-label']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const selector = `${element.localName}[${attribute}="${cssAttributeEscape(value)}"]`;
      if (safeQueryAll(selector).length === 1) return selector;
    }

    const parts = [];
    let current = element;
    while (current && current !== document.documentElement) {
      let part = current.localName;
      if (!part) break;
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter((child) => child.localName === current.localName)
        : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      const selector = parts.join(' > ');
      if (safeQueryAll(selector).length === 1) return selector;
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function openSiteManager() {
    const sites = state.config.sites;
    const list = sites.length
      ? sites.map((site) => `
          <div class="site-row" data-site-id="${escapeHtml(site.id)}">
            <div><strong>${escapeHtml(site.name)}</strong><small>${escapeHtml(describeSite(site))}</small></div>
            <button type="button" class="danger" data-delete="${escapeHtml(site.id)}">删除</button>
          </div>
        `).join('')
      : '<p class="empty">尚未配置任何网页。</p>';

    const modal = openModal({
      title: '站点配置',
      content: `<div class="site-list">${list}</div>`,
      confirmText: '关闭',
      hideCancel: true,
      onConfirm() { }
    });

    modal.shadowRoot.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.delete;
        state.config.sites = state.config.sites.filter((site) => site.id !== id);
        saveConfig();
        button.closest('.site-row').remove();
        if (state.activeSite?.id === id) {
          state.activeSite = null;
          state.buttonHost?.remove();
        }
        showToast('站点配置已删除');
      });
    });
  }

  function describeSite(site) {
    if (site.scope === 'origin') return `${site.origin}（全站）`;
    if (site.scope === 'prefix') return `${site.origin}${site.path}*`;
    return `${site.origin}${site.path}`;
  }

  function exportConfig() {
    const payload = JSON.stringify({
      format: 'captcha-filler-config',
      exportedAt: new Date().toISOString(),
      config: state.config
    }, null, 2);
    GM_setClipboard(payload, 'text');
    showToast('全部配置已复制到剪贴板（包含 API Key）');
  }

  async function importConfig() {
    openModal({
      title: '导入配置',
      content: `
        <label>配置 JSON
          <textarea name="payload" rows="12" placeholder="粘贴另一台设备导出的配置"></textarea>
        </label>
        <p class="notice warning">导入会覆盖当前后端设置和全部站点配置。</p>
      `,
      values: { payload: '' },
      confirmText: '导入并覆盖',
      onConfirm(values) {
        let parsed;
        try {
          parsed = JSON.parse(values.payload);
        } catch (error) {
          throw new Error('JSON 格式无效');
        }
        if (parsed.format !== 'captcha-filler-config' || !parsed.config) {
          throw new Error('这不是 Captcha Filler 导出的配置');
        }
        const incoming = parsed.config;
        if (!incoming.backend || !Array.isArray(incoming.sites)) {
          throw new Error('配置内容不完整');
        }
        state.config = {
          ...defaultConfig(),
          ...incoming,
          backend: { ...defaultConfig().backend, ...incoming.backend },
          sites: incoming.sites
        };
        saveConfig();
        showToast('配置已导入，刷新页面后生效');
      }
    });
  }

  function openModal({ title, content, values = {}, confirmText = '确定', hideCancel = false, onConfirm }) {
    closeAllUi();
    const host = document.createElement('div');
    host.setAttribute(UI_ATTR, 'modal');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647' });
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop {
          position: fixed; inset: 0; display: grid; place-items: center; padding: 16px;
          background: rgb(17 24 39 / 55%); font: 14px/1.45 system-ui, sans-serif;
          color: #111827; letter-spacing: 0;
        }
        .dialog {
          box-sizing: border-box; width: min(520px, 100%); max-height: min(720px, calc(100vh - 32px));
          overflow: auto; border: 1px solid #d1d5db; border-radius: 7px; background: #fff;
          box-shadow: 0 18px 48px rgb(0 0 0 / 28%);
        }
        header { padding: 16px 18px 12px; border-bottom: 1px solid #e5e7eb; }
        h2 { margin: 0; font-size: 17px; line-height: 1.25; letter-spacing: 0; }
        form { padding: 16px 18px 18px; }
        label { display: grid; gap: 6px; margin-bottom: 14px; font-weight: 600; }
        input, textarea, select {
          box-sizing: border-box; width: 100%; border: 1px solid #9ca3af; border-radius: 5px;
          background: #fff; color: #111827; padding: 8px 10px; font: 14px/1.4 system-ui, sans-serif;
          letter-spacing: 0;
        }
        input[type="checkbox"] { width: 16px; height: 16px; padding: 0; accent-color: #0f766e; }
        label.check-row { display: flex; align-items: center; gap: 9px; }
        textarea { resize: vertical; }
        input:focus, textarea:focus, select:focus { outline: 2px solid #14b8a6; border-color: #0f766e; }
        small { display: block; color: #6b7280; font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }
        code { font: 12px/1.5 ui-monospace, monospace; overflow-wrap: anywhere; }
        .notice { margin: 10px 0 0; padding: 10px; border-left: 3px solid #0f766e; background: #f0fdfa; color: #374151; }
        .warning { border-color: #b45309; background: #fffbeb; }
        .error { min-height: 20px; margin: 8px 0 0; color: #b91c1c; font-size: 13px; }
        footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        button {
          min-height: 34px; border: 1px solid #9ca3af; border-radius: 5px; padding: 7px 13px;
          background: #fff; color: #111827; font: 600 13px/1 system-ui, sans-serif; letter-spacing: 0; cursor: pointer;
        }
        button:hover { background: #f3f4f6; }
        button.primary { border-color: #0f766e; background: #0f766e; color: #fff; }
        button.primary:hover { background: #115e59; }
        button.danger { border-color: #dc2626; color: #b91c1c; }
        .action-list { display: grid; gap: 8px; }
        button.action-item {
          display: grid; gap: 3px; width: 100%; min-height: 58px; padding: 10px 12px;
          border-color: #d1d5db; text-align: left;
        }
        button.action-item:hover { border-color: #0f766e; background: #f0fdfa; }
        button.action-item strong { font-size: 14px; }
        button.action-item small { color: #6b7280; }
        .site-list { display: grid; gap: 8px; }
        .site-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
        .site-row > div { min-width: 0; }
        .empty { color: #6b7280; }
      </style>
      <div class="backdrop">
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="cf-title">
          <header><h2 id="cf-title">${escapeHtml(title)}</h2></header>
          <form>
            ${content}
            <div class="error" role="alert"></div>
            <footer>
              ${hideCancel ? '' : '<button type="button" data-action="cancel">取消</button>'}
              <button type="submit" class="primary">${escapeHtml(confirmText)}</button>
            </footer>
          </form>
        </section>
      </div>
    `;
    document.documentElement.appendChild(host);

    const form = root.querySelector('form');
    for (const [name, value] of Object.entries(values)) {
      const field = form.elements.namedItem(name);
      if (!field) continue;
      if (field instanceof HTMLInputElement && field.type === 'checkbox') {
        field.checked = Boolean(value);
      } else {
        field.value = value ?? '';
      }
    }

    const close = () => host.remove();
    root.querySelector('[data-action="cancel"]')?.addEventListener('click', close);
    root.querySelector('.backdrop').addEventListener('mousedown', (event) => {
      if (event.target.classList.contains('backdrop')) close();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorElement = root.querySelector('.error');
      errorElement.textContent = '';
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        await onConfirm(data);
        close();
      } catch (error) {
        errorElement.textContent = error.message || String(error);
      }
    });
    root.querySelector('input, textarea, select, button')?.focus();
    return host;
  }

  function showToast(message, type = 'success') {
    document.querySelectorAll(`[${UI_ATTR}="toast"]`).forEach((element) => element.remove());
    const toast = document.createElement('div');
    toast.setAttribute(UI_ATTR, 'toast');
    Object.assign(toast.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
      maxWidth: 'min(420px, calc(100vw - 32px))', padding: '10px 13px',
      borderRadius: '5px', background: type === 'error' ? '#991b1b' : '#166534',
      color: '#fff', boxShadow: '0 6px 20px rgb(0 0 0 / 25%)',
      font: '600 13px/1.4 system-ui, sans-serif', letterSpacing: '0'
    });
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function closeAllUi() {
    document.querySelectorAll(`[${UI_ATTR}="modal"], [${UI_ATTR}="picker"]`).forEach((element) => element.remove());
  }

  function safeQuery(selector) {
    try { return document.querySelector(selector); } catch (error) { return null; }
  }

  function safeQueryAll(selector) {
    try { return document.querySelectorAll(selector); } catch (error) { return []; }
  }

  function headerValue(headers, name) {
    const match = String(headers || '').match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
    return match?.[1]?.trim() || '';
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('图片编码失败'));
      reader.readAsDataURL(blob);
    });
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function cssAttributeEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }
})();

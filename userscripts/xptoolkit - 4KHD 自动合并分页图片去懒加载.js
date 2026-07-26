// ==UserScript==
// @name         xptoolkit - 4KHD 自动合并分页图片去懒加载
// @namespace    https://github.com/xp9477/xp-toolkit
// @version      2.0.9
// @description  合并分页图片、去懒加载；桌面端可标记 album / 图片为喜欢，并与 EasySearch iOS 云端同步
// @author       xp9477
// @match        https://www.4khd.com/content/*/*.html*
// @match        https://*.uuss.uk/content/*/*.html*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=4khd.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      wcklmuftxzdtcpaercno.supabase.co
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants (aligned with easysearch-ios HiddenSpace / HiddenSupabase)
  // ---------------------------------------------------------------------------
  const SUPABASE_URL = 'https://wcklmuftxzdtcpaercno.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_SHQkdZjCWTeDkdivNWmU6w_QblilEUG';
  const SUPABASE_SCHEMA = 'easysearch';

  const STORAGE = {
    session: 'xptoolkit.4khd.session.v1',
    albums: 'xptoolkit.4khd.favorite_albums.v1',
    images: 'xptoolkit.4khd.favorite_images.v1',
    email: 'xptoolkit.4khd.email.v1'
  };

  const UI = {
    rootId: 'xptoolkit-4khd-fav-root',
    styleId: 'xptoolkit-4khd-fav-style',
    toastId: 'xptoolkit-4khd-fav-toast'
  };

  // Cache the gallery root. findGalleryContainer() is expensive on large merged pages.
  let galleryContainerCache = null;
  function rememberGalleryContainer(node) {
    if (node && node.isConnected !== false) galleryContainerCache = node;
    return node;
  }

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------
  function gmGet(key, fallback = null) {
    try {
      const value = GM_getValue(key, fallback);
      return value === undefined ? fallback : value;
    } catch (_) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    }
  }

  function gmSet(key, value) {
    try {
      GM_setValue(key, value);
    } catch (_) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }

  function gmDelete(key) {
    try {
      GM_deleteValue(key);
    } catch (_) {
      localStorage.removeItem(key);
    }
  }

  function requestJSON({ url, method = 'GET', headers = {}, body = null, timeout = 25000 }) {
    return new Promise((resolve, reject) => {
      const doXHR = typeof GM_xmlhttpRequest === 'function';
      if (doXHR) {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data: body,
          responseType: 'text',
          timeout,
          onload(res) {
            const text = res.responseText || '';
            let data = null;
            if (text) {
              try {
                data = JSON.parse(text);
              } catch {
                data = text;
              }
            }
            if (res.status >= 200 && res.status < 300) {
              resolve({ status: res.status, data });
            } else {
              const message =
                (data && (data.message || data.msg || data.error_description || data.error)) ||
                `HTTP ${res.status}`;
              const error = new Error(message);
              error.status = res.status;
              error.code = data && (data.error_code || data.code || data.error);
              reject(error);
            }
          },
          onerror() {
            reject(new Error('网络请求失败'));
          },
          ontimeout() {
            reject(new Error('网络请求超时'));
          }
        });
        return;
      }

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (controller) controller.abort();
        else reject(new Error('网络请求超时'));
      }, timeout);

      fetch(url, { method, headers, body, signal: controller ? controller.signal : undefined })
        .then(async (res) => {
          const text = await res.text();
          let data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = text;
            }
          }
          if (!res.ok) {
            const message =
              (data && (data.message || data.msg || data.error_description || data.error)) ||
              `HTTP ${res.status}`;
            const error = new Error(message);
            error.status = res.status;
            error.code = data && (data.error_code || data.code || data.error);
            throw error;
          }
          return { status: res.status, data };
        })
        .then(resolve)
        .catch((err) => {
          if (err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')))) {
            reject(new Error('网络请求超时'));
            return;
          }
          reject(err);
        })
        .finally(() => clearTimeout(timer));
    });
  }

  function toast(message, ms = 2200) {
    let el = document.getElementById(UI.toastId);
    if (!el) {
      el = document.createElement('div');
      el.id = UI.toastId;
      document.documentElement.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function decodeEntities(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(text || '');
    return ta.value;
  }

  function cleanTitle(text) {
    return decodeEntities(String(text || ''))
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // URL normalization (mirror iOS HiddenSpaceAPI / Hidden4KHDURLNormalizer)
  // ---------------------------------------------------------------------------
  function normalizeImageURL(raw) {
    let href = String(raw || '').trim();
    if (!href) return '';
    href = decodeEntities(href).replace(/&#038;/g, '&').replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = 'https:' + href;
    if (href.startsWith('/')) href = 'https://www.4khd.com' + href;

    let url;
    try {
      url = new URL(href);
    } catch {
      return href;
    }

    const host = (url.host || '').toLowerCase();
    if (host === 'i0.wp.com' && url.pathname.startsWith('/pic.4khd.com/')) {
      url.host = 'img.4khd.com';
      url.pathname = url.pathname.replace(/^\/pic\.4khd\.com/, '');
      return url.toString();
    }
    if (host === 'pic.4khd.com') {
      url.host = 'img.4khd.com';
      return url.toString();
    }
    return url.toString();
  }

  function normalizeAlbumURL(raw) {
    let href = String(raw || '').trim();
    if (!href) return '';
    href = decodeEntities(href).replace(/&#038;/g, '&').replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = 'https:' + href;
    if (href.startsWith('/')) href = 'https://www.4khd.com' + href;

    let url;
    try {
      url = new URL(href);
    } catch {
      return href;
    }

    // Content pages on mirrors still map to the canonical album id used by iOS.
    if (/4khd\.com$/i.test(url.host) || /uuss\.uk$/i.test(url.host)) {
      url.protocol = 'https:';
      url.host = 'www.4khd.com';
    }

    // Strip pagination suffixes: ...html/2, ...html/page/2
    url.pathname = url.pathname
      .replace(/\.html\/\d+\/?$/i, '.html')
      .replace(/\.html\/page\/\d+\/?$/i, '.html');
    url.hash = '';
    // Keep query empty for stable album_id.
    url.search = '';
    return url.toString();
  }

  function imageSrcFromElement(img) {
    if (!img) return '';
    const candidates = [
      img.currentSrc,
      img.src,
      img.getAttribute('data-src'),
      img.getAttribute('data-lazy-src'),
      img.getAttribute('data-original')
    ];
    for (const c of candidates) {
      if (c && !c.startsWith('data:')) return normalizeImageURL(c);
    }
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    if (srcset) {
      const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
      if (first) return normalizeImageURL(first);
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Local favorites store
  // ---------------------------------------------------------------------------
  function loadAlbums() {
    const raw = gmGet(STORAGE.albums, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || !item.url) return null;
        return {
          url: normalizeAlbumURL(item.url),
          title: cleanTitle(item.title || item.url),
          coverURL: normalizeImageURL(item.coverURL || item.cover_url || '')
        };
      })
      .filter(Boolean);
  }

  function saveAlbums(albums) {
    gmSet(STORAGE.albums, albums);
  }

  function loadImages() {
    const raw = gmGet(STORAGE.images, []);
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const item of raw) {
      const url = normalizeImageURL(typeof item === 'string' ? item : item?.url || item?.image_url || '');
      if (url && !seen.has(url)) {
        seen.add(url);
        out.push(url);
      }
    }
    return out;
  }

  let saveImagesTimer = null;
  let saveImagesRevision = 0;
  function saveImages(images) {
    const snapshot = Array.isArray(images) ? images.slice() : [];
    const revision = ++saveImagesRevision;
    if (saveImagesTimer) clearTimeout(saveImagesTimer);
    saveImagesTimer = setTimeout(() => {
      saveImagesTimer = null;
      if (revision === saveImagesRevision) gmSet(STORAGE.images, snapshot);
    }, 0);
  }

  function loadSession() {
    const session = gmGet(STORAGE.session, null);
    if (!session || !session.accessToken || !session.refreshToken) return null;
    return session;
  }

  function saveSession(session) {
    if (!session) {
      gmDelete(STORAGE.session);
      return;
    }
    gmSet(STORAGE.session, session);
  }

  // ---------------------------------------------------------------------------
  // Supabase client
  // ---------------------------------------------------------------------------
  const cloud = {
    session: loadSession(),

    headers(rest, method, prefer) {
      const headers = {
        apikey: SUPABASE_KEY,
        Accept: 'application/json'
      };
      if (this.session?.accessToken) {
        headers.Authorization = `Bearer ${this.session.accessToken}`;
      }
      if (rest) {
        if (String(method).toUpperCase() === 'GET' || String(method).toUpperCase() === 'HEAD') {
          headers['Accept-Profile'] = SUPABASE_SCHEMA;
        } else {
          headers['Content-Profile'] = SUPABASE_SCHEMA;
        }
      }
      if (prefer) headers.Prefer = prefer;
      return headers;
    },

    async ensureSession() {
      if (!this.session) throw new Error('未登录云端，请先登录 EasySearch 账号');
      const expiresAt = Number(this.session.expiresAt || 0);
      if (expiresAt && expiresAt - Date.now() / 1000 > 120) {
        return this.session;
      }
      return this.refresh();
    },

    async signIn(email, password) {
      const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
      const { data } = await requestJSON({
        url,
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ email: email.trim(), password })
      });
      this.session = parseAuthSession(data);
      saveSession(this.session);
      gmSet(STORAGE.email, email.trim());
      return this.session;
    },

    async signUp(email, password) {
      const cleanEmail = email.trim();
      const url = `${SUPABASE_URL}/auth/v1/signup`;
      const { data } = await requestJSON({
        url,
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ email: cleanEmail, password })
      });
      gmSet(STORAGE.email, cleanEmail);
      if (data?.access_token && data?.refresh_token) {
        this.session = parseAuthSession(data);
        saveSession(this.session);
        return { authenticated: true, session: this.session };
      }
      return {
        authenticated: false,
        message: '注册请求已提交。请检查邮箱确认邮件；确认后再点登录。'
      };
    },

    async refresh() {
      if (!this.session?.refreshToken) {
        this.signOut();
        throw new Error('云端会话失效，请重新登录');
      }
      const url = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
      try {
        const { data } = await requestJSON({
          url,
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ refresh_token: this.session.refreshToken })
        });
        this.session = parseAuthSession(data);
        saveSession(this.session);
        return this.session;
      } catch (err) {
        this.signOut();
        throw err;
      }
    },

    signOut() {
      this.session = null;
      saveSession(null);
    },

    async rest(path, { method = 'GET', query = '', body = null, prefer = null } = {}) {
      await this.ensureSession();
      const url = `${SUPABASE_URL}${path}${query ? `?${query}` : ''}`;
      const headers = this.headers(true, method, prefer);
      if (body != null) headers['Content-Type'] = 'application/json';
      try {
        return await requestJSON({
          url,
          method,
          headers,
          body: body == null ? null : JSON.stringify(body)
        });
      } catch (err) {
        // One retry after forced refresh for auth failures.
        if (/JWT|token|auth|401|403|invalid/i.test(String(err.message || ''))) {
          await this.refresh();
          const headers2 = this.headers(true, method, prefer);
          if (body != null) headers2['Content-Type'] = 'application/json';
          return requestJSON({
            url,
            method,
            headers: headers2,
            body: body == null ? null : JSON.stringify(body)
          });
        }
        throw err;
      }
    },

    async fetchAlbums() {
      const { data } = await this.rest('/rest/v1/fourkhd_favorite_albums', {
        method: 'GET',
        query: 'select=*&order=created_at.desc'
      });
      return (Array.isArray(data) ? data : [])
        .map((row) => ({
          url: normalizeAlbumURL(row.album_url || row.album_id),
          title: cleanTitle(row.title || ''),
          coverURL: normalizeImageURL(row.cover_url || '')
        }))
        .filter((a) => a.url);
    },

    async fetchImages() {
      const { data } = await this.rest('/rest/v1/fourkhd_favorite_images', {
        method: 'GET',
        query: 'select=*&order=created_at.desc'
      });
      return (Array.isArray(data) ? data : [])
        .map((row) => normalizeImageURL(row.image_url || row.image_id))
        .filter(Boolean);
    },

    async upsertAlbum(album) {
      const payload = [{
        album_id: album.url,
        album_url: album.url,
        title: album.title || album.url,
        cover_url: album.coverURL || album.url
      }];
      await this.rest('/rest/v1/fourkhd_favorite_albums', {
        method: 'POST',
        query: 'on_conflict=user_id,album_id',
        body: payload,
        prefer: 'resolution=merge-duplicates,missing=default,return=minimal'
      });
    },

    async deleteAlbum(albumId) {
      const q = `album_id=eq.${encodeURIComponent(albumId)}`;
      await this.rest('/rest/v1/fourkhd_favorite_albums', {
        method: 'DELETE',
        query: q
      });
    },

    async upsertImage(imageURL) {
      const payload = [{
        image_id: imageURL,
        image_url: imageURL
      }];
      await this.rest('/rest/v1/fourkhd_favorite_images', {
        method: 'POST',
        query: 'on_conflict=user_id,image_id',
        body: payload,
        prefer: 'resolution=merge-duplicates,missing=default,return=minimal'
      });
    },

    async deleteImage(imageId) {
      const q = `image_id=eq.${encodeURIComponent(imageId)}`;
      await this.rest('/rest/v1/fourkhd_favorite_images', {
        method: 'DELETE',
        query: q
      });
    },

    async upsertAlbums(albums) {
      if (!albums.length) return;
      const payload = albums.map((album) => ({
        album_id: album.url,
        album_url: album.url,
        title: album.title || album.url,
        cover_url: album.coverURL || album.url
      }));
      await this.rest('/rest/v1/fourkhd_favorite_albums', {
        method: 'POST',
        query: 'on_conflict=user_id,album_id',
        body: payload,
        prefer: 'resolution=merge-duplicates,missing=default,return=minimal'
      });
    },

    async upsertImages(images) {
      if (!images.length) return;
      const payload = images.map((imageURL) => ({
        image_id: imageURL,
        image_url: imageURL
      }));
      await this.rest('/rest/v1/fourkhd_favorite_images', {
        method: 'POST',
        query: 'on_conflict=user_id,image_id',
        body: payload,
        prefer: 'resolution=merge-duplicates,missing=default,return=minimal'
      });
    }
  };

  function parseAuthSession(data) {
    if (!data || !data.access_token || !data.refresh_token) {
      throw new Error('登录成功，但没有拿到会话');
    }
    const expiresAt =
      typeof data.expires_at === 'number'
        ? data.expires_at
        : Math.floor(Date.now() / 1000) + (Number(data.expires_in) || 3600);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      email: data.user?.email || gmGet(STORAGE.email, '') || '',
      userID: data.user?.id || null
    };
  }

  function mergeAlbums(primary, secondary) {
    const map = new Map();
    for (const album of [...primary, ...secondary]) {
      if (!album?.url) continue;
      if (!map.has(album.url)) map.set(album.url, album);
    }
    return Array.from(map.values());
  }

  function mergeImages(primary, secondary) {
    const out = [];
    const seen = new Set();
    for (const url of [...primary, ...secondary]) {
      const n = normalizeImageURL(url);
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Page cleanup + pagination merge (original behavior)
  // ---------------------------------------------------------------------------
  function hideNoise() {
    document.querySelectorAll('.heateor_sss_sharing_container').forEach((el) => {
      el.style.display = 'none';
    });
    document
      .querySelectorAll('.is-content-justification-center.is-nowrap.is-layout-flex.wp-container-14.wp-block-group')
      .forEach((el) => {
        el.style.display = 'none';
      });
    document.querySelectorAll('p').forEach((p) => {
      if (p.textContent.includes('Extracting passwords')) p.style.display = 'none';
    });
    document.querySelectorAll('p.has-large-font-size').forEach((el) => {
      el.style.display = 'none';
    });
    document.querySelectorAll('div.wp-container-16').forEach((el) => {
      el.style.display = 'none';
    });
  }

  // ---------------------------------------------------------------------------
  // Gallery discovery (new entry-content layout + legacy #basicExample)
  // ---------------------------------------------------------------------------
  function isMirrorHost(host = location.hostname) {
    return /uuss\.uk$/i.test(String(host || ''));
  }

  function rewriteToCurrentOrigin(rawHref) {
    const href = String(rawHref || '').trim();
    if (!href) return href;
    try {
      const url = new URL(href, location.href);
      const host = (url.host || '').toLowerCase();
      const isSiteHost = /4khd\.com$/i.test(host) || /uuss\.uk$/i.test(host);
      if (!isSiteHost) return url.href;
      // On uuss mirrors, keep /content/ navigation & pagination on the same origin
      // so clicks/fetch do not bounce to www.4khd.com.
      if (isMirrorHost() && /\/content\//i.test(url.pathname)) {
        url.protocol = location.protocol;
        url.host = location.host;
      }
      return url.href;
    } catch {
      return href;
    }
  }

  function stayOnMirrorLinks(root = document) {
    if (!isMirrorHost()) return;
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('a[href]').forEach((a) => {
      const raw = a.getAttribute('href');
      if (!raw) return;
      if (!/4khd\.com/i.test(raw) && !raw.startsWith('/content/')) return;
      try {
        const abs = new URL(raw, location.href);
        if (!/\/content\//i.test(abs.pathname)) return;
        const next = rewriteToCurrentOrigin(abs.href);
        if (next && next !== a.getAttribute('href')) a.setAttribute('href', next);
      } catch (_) {
        // ignore bad hrefs
      }
    });
  }

  function isLikelyGalleryImageURL(url) {
    const raw = String(url || '');
    if (!raw || raw.startsWith('data:')) return false;
    try {
      const u = new URL(raw, location.href);
      const host = (u.host || '').toLowerCase();
      const path = (u.pathname || '').toLowerCase();
      if (host === 'img.4khd.com' || host === 'pic.4khd.com') return true;
      if (host.endsWith('.wp.com') && path.includes('/pic.4khd.com/')) return true;
      return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(path + u.search);
    } catch {
      return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(raw);
    }
  }

  function isExcludedGalleryNode(node) {
    if (!node || !node.closest) return true;
    return Boolean(
      node.closest(
        '.page-link-box, header, nav, footer, aside, #' +
          UI.rootId +
          ', .heateor_sss_sharing_container, .wp-block-query, .related, .xptoolkit-img-fav'
      )
    );
  }

  function getEntryContent(doc = document) {
    return (
      doc.querySelector('.entry-content.wp-block-post-content') ||
      doc.querySelector('.entry-content') ||
      null
    );
  }

  function findGalleryContainer(doc = document) {
    const useCache = !doc || doc === document;
    if (useCache && galleryContainerCache) {
      if (galleryContainerCache.isConnected) return galleryContainerCache;
      galleryContainerCache = null;
    }

    const legacy = doc.querySelector('#basicExample');
    if (legacy && legacy.querySelector('img')) {
      return useCache ? rememberGalleryContainer(legacy) : legacy;
    }

    const existing = doc.querySelector('.xptoolkit-4khd-gallery');
    if (existing) {
      return useCache ? rememberGalleryContainer(existing) : existing;
    }

    const entry = getEntryContent(doc);
    if (!entry) return null;

    const pageLink = entry.querySelector('.page-link-box');
    // Only scan top-level entry children (cheap) instead of every nested p/div.
    const candidates = [];
    for (const child of Array.from(entry.children)) {
      if (child.classList && child.classList.contains('page-link-box')) break;
      if (pageLink && (child === pageLink || child.contains(pageLink))) break;
      candidates.push(child);
    }
    if (!candidates.length) {
      entry.querySelectorAll(':scope > p, :scope > div').forEach((el) => {
        if (el.classList.contains('page-link-box')) return;
        if (pageLink && (el === pageLink || pageLink.contains(el))) return;
        if (pageLink && (pageLink.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
        candidates.push(el);
      });
    }

    let best = null;
    let bestCount = 0;
    for (const el of candidates) {
      let count = 0;
      el.querySelectorAll('a[href] img').forEach((img) => {
        if (isExcludedGalleryNode(img)) return;
        const src = imageSrcFromElement(img);
        if (src && isLikelyGalleryImageURL(src)) count += 1;
      });
      if (count > bestCount) {
        bestCount = count;
        best = el;
      }
    }
    if (best && bestCount > 0) {
      return useCache ? rememberGalleryContainer(best) : best;
    }

    // Fallback host so pagination can still append images.
    const host = doc.createElement('div');
    host.className = 'xptoolkit-4khd-gallery';
    if (pageLink && pageLink.parentElement) {
      pageLink.parentElement.insertBefore(host, pageLink);
    } else if (entry) {
      entry.appendChild(host);
    } else {
      doc.body.appendChild(host);
    }
    return useCache ? rememberGalleryContainer(host) : host;
  }

  function extractGalleryNodesFromDoc(doc) {
    const legacy = doc.querySelector('#basicExample');
    if (legacy) {
      const legacyNodes = legacy.querySelectorAll(':scope > a.imageLink, :scope > a, :scope > br');
      if (legacyNodes.length) return Array.from(legacyNodes);
    }

    const entry = getEntryContent(doc);
    if (!entry) return [];

    const pageLink = entry.querySelector('.page-link-box');
    const blocks = [];
    for (const child of Array.from(entry.children)) {
      if (child.classList && child.classList.contains('page-link-box')) break;
      if (pageLink && (child === pageLink || child.contains(pageLink))) break;
      if (child.id === 'basicE') continue;
      blocks.push(child);
    }

    // If structure is flatter, scan paragraphs before page-link-box.
    if (!blocks.some((b) => b.querySelector && b.querySelector('a img'))) {
      entry.querySelectorAll('p').forEach((p) => {
        if (pageLink && (pageLink.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
        if (p.querySelector('a img')) blocks.push(p);
      });
    }

    const out = [];
    const seen = new Set();
    for (const block of blocks) {
      const kids = Array.from(block.childNodes);
      let usedChildWalk = false;
      for (const node of kids) {
        if (node.nodeType !== 1) continue;
        const el = node;
        if (el.matches && el.matches('a') && el.querySelector('img')) {
          const img = el.querySelector('img');
          const src = imageSrcFromElement(img);
          if (!src || !isLikelyGalleryImageURL(src) || seen.has(src)) continue;
          seen.add(src);
          out.push(el);
          usedChildWalk = true;
        } else if (el.matches && el.matches('br') && usedChildWalk) {
          out.push(el);
        }
      }
      if (!usedChildWalk) {
        block.querySelectorAll?.('a[href] img').forEach((img) => {
          if (isExcludedGalleryNode(img)) return;
          const a = img.closest('a');
          if (!a) return;
          const src = imageSrcFromElement(img);
          if (!src || !isLikelyGalleryImageURL(src) || seen.has(src)) return;
          seen.add(src);
          out.push(a);
        });
      }
    }
    return out;
  }

  function collectPageLinkHrefs() {
    const links = Array.from(document.querySelectorAll('.page-link-box a.page-numbers'));
    const hrefs = [];
    const seen = new Set();
    const currentPath = location.pathname.replace(/\/$/, '');
    for (const a of links) {
      const raw = a.getAttribute('href') || a.href;
      if (!raw) continue;
      const href = rewriteToCurrentOrigin(raw);
      // Skip page 1 absolute links if present.
      if (/\.html\/1\/?$/i.test(href) || /\/page\/1\/?$/i.test(href)) continue;
      try {
        const u = new URL(href, location.href);
        if (u.pathname.replace(/\/$/, '') === currentPath) continue;
      } catch (_) {}
      if (seen.has(href)) continue;
      seen.add(href);
      hrefs.push(href);
    }
    return hrefs;
  }

  function installMirrorNavGuard() {
    if (!isMirrorHost() || window.__xptoolkit4khdMirrorGuard) return;
    window.__xptoolkit4khdMirrorGuard = true;
    document.addEventListener(
      'click',
      (e) => {
        if (e.target && e.target.closest && e.target.closest('.xptoolkit-img-fav, #' + UI.rootId)) return;
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        const raw = a.getAttribute('href');
        if (!raw) return;
        if (!/4khd\.com/i.test(raw) && !raw.startsWith('/content/')) return;
        try {
          const abs = new URL(raw, location.href);
          if (!/\/content\//i.test(abs.pathname)) return;
          if (!/4khd\.com$/i.test(abs.host) && !/uuss\.uk$/i.test(abs.host)) return;
          const next = rewriteToCurrentOrigin(abs.href);
          if (!next || next === abs.href) return;
          // Same-tab navigations only; keep new-tab behavior intact.
          if (a.target && a.target !== '_self') {
            a.setAttribute('href', next);
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          location.assign(next);
        } catch (_) {
          // ignore
        }
      },
      true
    );
  }
  function undelayImages(root) {
    if (!root) return;
    root.querySelectorAll('img').forEach((img) => {
      if (isExcludedGalleryNode(img) && !root.classList?.contains('xptoolkit-4khd-gallery') && root.id !== 'basicExample') {
        // Still undelay inside explicit gallery roots.
      }
      img.removeAttribute('loading');
      img.removeAttribute('decoding');
      img.removeAttribute('id');
      const src = imageSrcFromElement(img);
      if (src) img.src = src;
    });
  }

  async function mergePagination(container) {
    if (!container) return;
    const pageLinks = collectPageLinkHrefs();
    for (const url of pageLinks) {
      try {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok) continue;
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const nodes = extractGalleryNodesFromDoc(doc);
        nodes.forEach((node) => {
          const clone = node.cloneNode(true);
          if (clone.tagName && clone.tagName.toLowerCase() === 'a') {
            const img = clone.querySelector('img');
            if (img) {
              img.removeAttribute('loading');
              img.removeAttribute('decoding');
              img.removeAttribute('id');
              const src = imageSrcFromElement(img);
              if (src) {
                img.src = src;
                try {
                  if (clone.getAttribute('href') && isLikelyGalleryImageURL(normalizeImageURL(clone.getAttribute('href')))) {
                    clone.setAttribute('href', src);
                  }
                } catch (_) {}
              }
            }
          }
          container.appendChild(clone);
        });
      } catch (err) {
        console.error('加载分页失败:', url, err);
      }
    }

    undelayImages(container);
    stayOnMirrorLinks(document);
    const pageNav = document.querySelector('.page-link-box');
    if (pageNav) pageNav.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Current album metadata
  // ---------------------------------------------------------------------------
  function getCurrentAlbum() {
    const url = normalizeAlbumURL(location.href);
    const title =
      cleanTitle(document.querySelector('h1.wp-block-post-title, h1.entry-title, h1')?.textContent) ||
      cleanTitle(document.title.replace(/\s*[|\-–].*$/, '')) ||
      url;

    let coverURL = '';
    const gallery = findGalleryContainer();
    const firstImg =
      (gallery && gallery.querySelector('a[href] img, img')) ||
      document.querySelector('.entry-content.wp-block-post-content a[href*="pic.4khd.com"] img') ||
      document.querySelector('.entry-content a[href*="img.4khd.com"] img') ||
      document.querySelector('.entry-content img');
    if (firstImg && !isExcludedGalleryNode(firstImg)) coverURL = imageSrcFromElement(firstImg);
    else if (firstImg) coverURL = imageSrcFromElement(firstImg);
    if (!coverURL) coverURL = url;

    return { url, title, coverURL };
  }

  // ---------------------------------------------------------------------------
  // Favorites state + actions
  // ---------------------------------------------------------------------------
  let favoriteAlbums = loadAlbums();
  let favoriteImages = loadImages();
  const busy = { album: false, images: new Set(), sync: false, auth: false };
  const uiState = { statusText: '' };

  function authErrorMessage(err) {
    const raw = String(err?.message || err || '').trim();
    const code = String(err?.code || '').toLowerCase();
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) {
      return '邮箱或密码不正确；这里使用 EasySearch「设置 → 云端同步」的邮箱密码。';
    }
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) {
      return '邮箱还没确认，请先打开注册确认邮件。';
    }
    if (code === 'user_already_exists' || /already registered|already exists/i.test(raw)) {
      return '该邮箱已经注册，请直接登录。';
    }
    if (/timeout|超时/i.test(raw)) {
      return '请求超时；请检查网络后在油猴菜单里重试同步。';
    }
    if (/network|failed to fetch|网络请求失败/i.test(raw)) {
      return '认证服务器连接失败；请确认 Tampermonkey 已允许在隐私模式运行。';
    }
    return raw || '未知错误';
  }

  function isAlbumFavorite(albumURL) {
    const id = normalizeAlbumURL(albumURL);
    return favoriteAlbums.some((a) => a.url === id);
  }

  function isImageFavorite(imageURL) {
    const id = normalizeImageURL(imageURL);
    return favoriteImages.includes(id);
  }

  function updatePanelMeta() {
    const root = document.getElementById(UI.rootId);
    if (!root) {
      renderUI();
      return;
    }
    const loggedIn = Boolean(cloud.session?.accessToken);
    const email = cloud.session?.email || gmGet(STORAGE.email, '') || '';
    const status =
      uiState.statusText ||
      (busy.sync
        ? '正在同步…'
        : loggedIn
          ? `已登录 ${email || ''}`.trim()
          : '仅本地 · 登录请用油猴菜单');
    const counts = root.querySelector('.counts');
    if (counts) {
      counts.innerHTML =
        '<span class="pill">' +
        (loggedIn ? '云端' : '本地') +
        '</span>' +
        '<span class="pill">album ' +
        favoriteAlbums.length +
        '</span>' +
        '<span class="pill">图片 ' +
        favoriteImages.length +
        '</span>';
    }
    const statusEl = root.querySelector('.status');
    if (statusEl) statusEl.textContent = status;
    const albumBtn = root.querySelector('#xpt-album-fav');
    if (albumBtn) {
      const albumURL = albumBtn.dataset.albumUrl || normalizeAlbumURL(location.href);
      const albumLiked = isAlbumFavorite(albumURL);
      albumBtn.classList.toggle('liked', albumLiked);
      albumBtn.disabled = Boolean(busy.album);
      albumBtn.textContent = albumLiked ? '♥ 已喜欢 album' : '♡ 喜欢 album';
    }
  }

  async function toggleAlbumFavorite() {
    if (busy.album) return;
    const album = getCurrentAlbum();
    const wasLiked = isAlbumFavorite(album.url);
    busy.album = true;
    updatePanelMeta();
    try {
      if (wasLiked) {
        favoriteAlbums = favoriteAlbums.filter((a) => a.url !== album.url);
        saveAlbums(favoriteAlbums);
        toast('已取消 album 喜欢');
      } else {
        favoriteAlbums = [album, ...favoriteAlbums.filter((a) => a.url !== album.url)];
        saveAlbums(favoriteAlbums);
        toast(cloud.session ? '已喜欢 album（云端同步中…）' : '已喜欢 album（仅本地，登录后可同步）');
      }
      busy.album = false;
      updatePanelMeta();

      if (cloud.session) {
        // Fire-and-forget cloud write; never block UI on network.
        void (async () => {
          try {
            if (wasLiked) await cloud.deleteAlbum(album.url);
            else await cloud.upsertAlbum(album);
            if (!wasLiked) toast('已喜欢 album（已同步云端）');
          } catch (err) {
            if (wasLiked) {
              favoriteAlbums = [album, ...favoriteAlbums.filter((a) => a.url !== album.url)];
            } else {
              favoriteAlbums = favoriteAlbums.filter((a) => a.url !== album.url);
            }
            saveAlbums(favoriteAlbums);
            updatePanelMeta();
            toast('album 云端同步失败：' + authErrorMessage(err), 5200);
            console.error(err);
          }
        })();
      }
    } catch (err) {
      busy.album = false;
      updatePanelMeta();
      toast('album 操作失败：' + (err.message || err));
      console.error(err);
    }
  }

  function toggleImageFavorite(imageURL, button = null) {
    const id = normalizeImageURL(imageURL);
    if (!id || busy.images.has(id)) return;
    const wasLiked = isImageFavorite(id);
    busy.images.add(id);
    try {
      // Optimistic local update only. Never await network on the click path.
      if (wasLiked) {
        favoriteImages = favoriteImages.filter((u) => u !== id);
        saveImages(favoriteImages);
        toast('已取消图片喜欢');
      } else {
        favoriteImages = [id, ...favoriteImages.filter((u) => u !== id)];
        saveImages(favoriteImages);
        toast(cloud.session ? '已喜欢图片（云端同步中…）' : '已喜欢图片（仅本地，登录后可同步）');
      }
      // Release click lock immediately; cloud write is background-only.
      busy.images.delete(id);
      updateImageButtonState(id, button);
      updatePanelMeta();

      if (cloud.session) {
        void (async () => {
          try {
            if (wasLiked) await cloud.deleteImage(id);
            else await cloud.upsertImage(id);
            if (!wasLiked) toast('已喜欢图片（已同步云端）');
          } catch (err) {
            if (wasLiked) {
              favoriteImages = [id, ...favoriteImages.filter((u) => u !== id)];
            } else {
              favoriteImages = favoriteImages.filter((u) => u !== id);
            }
            saveImages(favoriteImages);
            updateImageButtonState(id, button);
            updatePanelMeta();
            toast('图片云端同步失败：' + authErrorMessage(err), 5200);
            console.error(err);
          }
        })();
      }
    } catch (err) {
      busy.images.delete(id);
      updateImageButtonState(id, button);
      toast('图片操作失败：' + (err.message || err));
      console.error(err);
    }
  }

  function setStatus(text = '') {
    uiState.statusText = text || '';
    updatePanelMeta();
  }

  function promptCredentials() {
    const defaultEmail = cloud.session?.email || gmGet(STORAGE.email, '') || '';
    const email = window.prompt('EasySearch 云端邮箱（与 iOS「设置 → 云端同步」相同）', defaultEmail);
    if (email == null) return null;
    const cleanEmail = String(email).trim();
    if (!cleanEmail) {
      toast('请输入邮箱');
      return null;
    }
    const password = window.prompt('EasySearch 云端密码');
    if (password == null) return null;
    if (!String(password)) {
      toast('请输入密码');
      return null;
    }
    const modeRaw = window.prompt('1 = 登录（默认）\n2 = 注册新账号', '1');
    if (modeRaw == null) return null;
    const mode = String(modeRaw).trim();
    const isSignUp = mode === '2' || mode === '注册';
    return { email: cleanEmail, password: String(password), isSignUp };
  }

  async function syncWithCloud({ quiet = false } = {}) {
    if (!cloud.session) throw new Error('未登录云端');
    if (busy.sync) throw new Error('同步进行中，请稍候');
    busy.sync = true;
    if (!quiet) {
      setStatus('正在同步…');
      toast('正在同步云端喜欢…');
    }
    try {
      const remoteAlbums = await cloud.fetchAlbums();
      const remoteImages = await cloud.fetchImages();
      favoriteAlbums = mergeAlbums(remoteAlbums, favoriteAlbums);
      favoriteImages = mergeImages(remoteImages, favoriteImages);
      saveAlbums(favoriteAlbums);
      saveImages(favoriteImages);
      await cloud.upsertAlbums(favoriteAlbums);
      await cloud.upsertImages(favoriteImages);
      return {
        albums: favoriteAlbums.length,
        images: favoriteImages.length
      };
    } finally {
      busy.sync = false;
      if (uiState.statusText === '正在同步…') uiState.statusText = '';
      renderUI();
    }
  }

  async function finishAuthenticatedLogin(email) {
    const account = cloud.session?.email || email;
    setStatus(`已登录 ${account}`);
    toast(`已登录 ${account}，开始同步…`);
    try {
      const result = await syncWithCloud({ quiet: true });
      setStatus(`已登录 ${account}`);
      toast(`已登录 ${account}，同步完成（album ${result.albums} / 图片 ${result.images}）`, 3600);
    } catch (err) {
      const detail = authErrorMessage(err);
      setStatus(`已登录 ${account}（同步失败）`);
      toast(`账号已登录，但同步失败：${detail}`, 5200);
      console.error('4KHD 首次同步失败:', err);
    }
    refreshImageButtons();
  }

  async function login(email, password) {
    if (busy.auth) return;
    busy.auth = true;
    try {
      toast('正在验证 EasySearch 云端账号…');
      setStatus('正在登录…');
      await cloud.signIn(email, password);
      await finishAuthenticatedLogin(email.trim());
    } finally {
      busy.auth = false;
    }
  }

  async function signUp(email, password) {
    if (busy.auth) return;
    busy.auth = true;
    try {
      toast('正在注册 EasySearch 云端账号…');
      setStatus('正在注册…');
      const result = await cloud.signUp(email, password);
      if (result.authenticated) {
        await finishAuthenticatedLogin(email.trim());
        return;
      }
      setStatus('');
      toast(result.message, 5200);
      renderUI();
    } finally {
      busy.auth = false;
    }
  }

  async function menuLoginOrSignUp() {
    const creds = promptCredentials();
    if (!creds) return;
    try {
      if (creds.isSignUp) {
        if (creds.password.length < 6) {
          toast('注册密码至少需要 6 位');
          return;
        }
        await signUp(creds.email, creds.password);
      } else {
        await login(creds.email, creds.password);
      }
    } catch (err) {
      const detail = authErrorMessage(err);
      const kind = creds.isSignUp ? '注册' : '登录';
      setStatus(`${kind}失败`);
      toast(`${kind}失败：${detail}`, 5200);
      console.error('4KHD 云端账号操作失败:', err);
    }
  }

  function logout() {
    cloud.signOut();
    setStatus('');
    toast('已退出云端登录（本地喜欢仍保留）');
    renderUI();
  }

  async function handleCloudMenu() {
    // Live session check: menu title may stay stale until page reload.
    if (cloud.session?.accessToken) {
      const email = cloud.session.email || gmGet(STORAGE.email, '') || '';
      const ok = window.confirm('当前已登录 ' + (email || '云端账号') + '\n\n确定退出登录？');
      if (ok) logout();
      return;
    }
    await menuLoginOrSignUp();
  }

  function cloudMenuLabel() {
    if (cloud.session?.accessToken) {
      const email = cloud.session.email || gmGet(STORAGE.email, '') || '';
      return email ? ('4KHD: 已登录 ' + email) : '4KHD: 已登录';
    }
    return '4KHD: 登录/注册云端';
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  function injectStyle() {
    if (document.getElementById(UI.styleId)) return;
    const style = document.createElement('style');
    style.id = UI.styleId;
    style.textContent = `
      #${UI.rootId} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483646;
        width: auto;
        max-width: min(92vw, 320px);
        color: #111;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${UI.rootId} .panel {
        background: rgba(255,255,255,0.96);
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.18);
        padding: 10px;
        backdrop-filter: blur(8px);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #${UI.rootId} .row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      #${UI.rootId} .muted {
        color: #666;
        font-size: 12px;
      }
      #${UI.rootId} .status {
        color: #555;
        font-size: 11px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      #${UI.rootId} button {
        font: inherit;
        border: 0;
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
        background: #111;
        color: #fff;
      }
      #${UI.rootId} button.liked {
        background: #ff2d55;
        color: #fff;
      }
      #${UI.rootId} button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      #${UI.rootId} .grow { flex: 1; }
      #${UI.rootId} .counts {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      #${UI.rootId} .pill {
        background: #f5f5f7;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 11px;
        color: #444;
      }
      #${UI.rootId} .title-line {
        font-size: 11px;
        color: #777;
        max-width: 260px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      a.imageLink,
      #basicExample a,
      .xptoolkit-4khd-gallery a,
      .entry-content.wp-block-post-content a:has(> img),
      .entry-content a:has(> img) {
        position: relative;
        display: inline-block;
      }
      .xptoolkit-img-fav {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 5;
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 999px;
        background: rgba(0,0,0,0.45);
        color: #fff;
        font-size: 18px;
        line-height: 36px;
        text-align: center;
        cursor: pointer;
        padding: 0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      }
      .xptoolkit-img-fav::before {
        content: '♡';
      }
      .xptoolkit-img-fav.liked {
        background: rgba(255,45,85,0.92);
      }
      .xptoolkit-img-fav.liked::before {
        content: '♥';
      }
      .xptoolkit-img-fav:hover {
        transform: scale(1.05);
      }
      .xptoolkit-img-fav:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      #${UI.toastId} {
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%) translateY(20px);
        background: rgba(20,20,20,0.92);
        color: #fff;
        padding: 10px 14px;
        border-radius: 999px;
        font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        z-index: 2147483647;
        opacity: 0;
        pointer-events: none;
        transition: opacity .18s ease, transform .18s ease;
        max-width: min(80vw, 420px);
        text-align: center;
      }
      #${UI.toastId}.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    `;
    document.documentElement.appendChild(style);
  }

  function renderUI() {
    injectStyle();
    let root = document.getElementById(UI.rootId);
    if (!root) {
      root = document.createElement('div');
      root.id = UI.rootId;
      document.documentElement.appendChild(root);
    }

    const album = getCurrentAlbum();
    const albumLiked = isAlbumFavorite(album.url);
    const loggedIn = Boolean(cloud.session?.accessToken);
    const email = cloud.session?.email || gmGet(STORAGE.email, '') || '';
    const status =
      uiState.statusText ||
      (busy.sync
        ? '正在同步…'
        : loggedIn
          ? `已登录 ${email || ''}`.trim()
          : '仅本地 · 登录请用油猴菜单');

    root.innerHTML = `
      <div class="panel">
        <div class="row">
          <button id="xpt-album-fav" data-album-url="${escapeHtml(album.url)}" class="grow ${albumLiked ? 'liked' : ''}" ${busy.album ? 'disabled' : ''}>
            ${albumLiked ? '♥ 已喜欢 album' : '♡ 喜欢 album'}
          </button>
        </div>
        <div class="row counts">
          <span class="pill">${loggedIn ? '云端' : '本地'}</span>
          <span class="pill">album ${favoriteAlbums.length}</span>
          <span class="pill">图片 ${favoriteImages.length}</span>
        </div>
        <div class="title-line" title="${escapeHtml(album.url)}">${escapeHtml(album.title)}</div>
        <div class="status">${escapeHtml(status)}</div>
      </div>
    `;

    root.querySelector('#xpt-album-fav')?.addEventListener('click', () => {
      void toggleAlbumFavorite();
    });
  }

  let imageObserver = null;
  let refreshingImageButtons = false;
  let refreshImageButtonsQueued = false;

  function ensureImageHost(node) {
    // Prefer anchor wrappers used by gallery (legacy + new entry-content).
    if (node.matches?.('a.imageLink, a')) {
      const img = node.querySelector('img');
      if (!img) return null;
      if (isExcludedGalleryNode(node) && !node.closest('#basicExample, .xptoolkit-4khd-gallery, .entry-content')) {
        return null;
      }
      if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
      return node;
    }
    if (node.matches?.('img')) {
      if (isExcludedGalleryNode(node)) return null;
      const parent = node.closest('a') || node.parentElement;
      if (!parent) return null;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      return parent;
    }
    return null;
  }

  function findFavButton(host) {
    if (!host) return null;
    for (const child of host.children || []) {
      if (child.classList && child.classList.contains('xptoolkit-img-fav')) return child;
    }
    return host.querySelector?.('.xptoolkit-img-fav') || null;
  }

  function paintFavButton(btn, imageURL) {
    if (!btn) return;
    const src = normalizeImageURL(imageURL || btn.dataset.imageUrl || '');
    if (!src) return;
    const liked = isImageFavorite(src);
    const nextTitle = liked ? '取消喜欢图片' : '喜欢图片';
    const nextDisabled = busy.images.has(src);
    if (btn.dataset.imageUrl !== src) btn.dataset.imageUrl = src;
    if (btn.classList.contains('liked') !== liked) btn.classList.toggle('liked', liked);
    if (btn.title !== nextTitle) btn.title = nextTitle;
    if (btn.disabled !== nextDisabled) btn.disabled = nextDisabled;
    // Heart glyph comes from CSS ::before to avoid MutationObserver childList storms.
    if (btn.childNodes.length) btn.textContent = '';
  }

  function updateImageButtonState(imageURL, button = null) {
    const id = normalizeImageURL(imageURL);
    if (!id) return;
    if (button && button.isConnected) {
      paintFavButton(button, id);
      return;
    }
    // Fallback only for sync/rollback paths without a button reference.
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/([\"\\])/g, '\\$1');
    const candidate = document.querySelector('.xptoolkit-img-fav[data-image-url="' + escaped + '"]');
    if (candidate) paintFavButton(candidate, id);
  }

  function attachImageButton(host) {
    if (!host || findFavButton(host)) return;
    const img = host.matches('img') ? host : host.querySelector('img');
    if (!img) return;
    const src = imageSrcFromElement(img);
    if (!src || !isLikelyGalleryImageURL(src)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xptoolkit-img-fav';
    btn.setAttribute('aria-label', '喜欢图片');
    paintFavButton(btn, src);
    const stopNav = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    };
    const onFavClick = (e) => {
      stopNav(e);
      const latest = imageSrcFromElement(img) || btn.dataset.imageUrl;
      // Sync local toggle only; network is background.
      toggleImageFavorite(latest, btn);
    };
    // Kill anchor navigation early; toggle only once on click.
    btn.addEventListener('pointerdown', stopNav, true);
    btn.addEventListener('click', onFavClick, true);
    host.appendChild(btn);
  }

  function iterGalleryImageHosts(container) {
    const root = container || findGalleryContainer() || document.querySelector('#basicExample');
    if (!root) return [];
    const hosts = [];
    const seen = new Set();
    // Prefer anchors with images; fall back to bare imgs.
    root.querySelectorAll('a[href] img').forEach((img) => {
      if (isExcludedGalleryNode(img)) return;
      const src = imageSrcFromElement(img);
      if (!src || !isLikelyGalleryImageURL(src)) return;
      const host = ensureImageHost(img.closest('a') || img);
      if (!host || seen.has(host)) return;
      seen.add(host);
      hosts.push(host);
    });
    if (!hosts.length) {
      root.querySelectorAll('img').forEach((img) => {
        if (isExcludedGalleryNode(img)) return;
        const src = imageSrcFromElement(img);
        if (!src || !isLikelyGalleryImageURL(src)) return;
        const host = ensureImageHost(img.closest('a') || img);
        if (!host || seen.has(host)) return;
        seen.add(host);
        hosts.push(host);
      });
    }
    return hosts;
  }

  function refreshImageButtons() {
    if (refreshingImageButtons) return;
    refreshingImageButtons = true;
    const container = findGalleryContainer() || document.querySelector('#basicExample');
    try {
      if (imageObserver) imageObserver.disconnect();
      const hosts = iterGalleryImageHosts(container);
      for (let i = 0; i < hosts.length; i += 1) {
        const host = hosts[i];
        const img = host.querySelector('img') || (host.matches && host.matches('img') ? host : null);
        const src = imageSrcFromElement(img);
        let btn = findFavButton(host);
        if (!btn) {
          attachImageButton(host);
          btn = findFavButton(host);
        }
        if (!btn || !src) continue;
        paintFavButton(btn, src);
      }
    } finally {
      refreshingImageButtons = false;
      if (imageObserver && container) {
        imageObserver.observe(container, { childList: true, subtree: true });
      }
    }
  }

  function scheduleRefreshImageButtons() {
    if (refreshImageButtonsQueued || refreshingImageButtons) return;
    refreshImageButtonsQueued = true;
    // Debounce: pagination merge appends many nodes; one pass is enough.
    setTimeout(() => {
      refreshImageButtonsQueued = false;
      if (!refreshingImageButtons) refreshImageButtons();
    }, 120);
  }

  function observeImages() {
    const container = findGalleryContainer() || document.querySelector('#basicExample');
    if (!container) return;
    if (imageObserver) imageObserver.disconnect();
    imageObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i += 1) {
        const m = mutations[i];
        // Ignore our own heart-button mutations.
        if (m.target && m.target.classList && m.target.classList.contains('xptoolkit-img-fav')) continue;
        if (m.target && m.target.closest && m.target.closest('.xptoolkit-img-fav')) continue;
        let meaningful = false;
        if (m.type === 'childList') {
          const nodes = [].concat(Array.from(m.addedNodes || []), Array.from(m.removedNodes || []));
          for (const n of nodes) {
            if (!n || n.nodeType !== 1) continue;
            if (n.classList && n.classList.contains('xptoolkit-img-fav')) continue;
            meaningful = true;
            break;
          }
        }
        if (meaningful) {
          scheduleRefreshImageButtons();
          return;
        }
      }
    });
    imageObserver.observe(container, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  hideNoise();
  stayOnMirrorLinks(document);
  installMirrorNavGuard();
  injectStyle();
  renderUI();

  const container = findGalleryContainer();
  if (container) {
    rememberGalleryContainer(container);
    await mergePagination(container);
    undelayImages(container);
    stayOnMirrorLinks(document);
    rememberGalleryContainer(container);
  }

  // Recompute cover after images merge; keep liked album metadata fresh.
  {
    const album = getCurrentAlbum();
    const idx = favoriteAlbums.findIndex((a) => a.url === album.url);
    if (idx >= 0) {
      const prev = favoriteAlbums[idx];
      if (prev.title !== album.title || prev.coverURL !== album.coverURL) {
        favoriteAlbums[idx] = { ...prev, title: album.title, coverURL: album.coverURL || prev.coverURL };
        saveAlbums(favoriteAlbums);
        if (cloud.session) {
          cloud.upsertAlbum(favoriteAlbums[idx]).catch((err) => console.warn('更新 album 封面失败:', err));
        }
      }
    }
  }
  renderUI();
  refreshImageButtons();
  observeImages();

  // Restore session and soft-sync in background.
  if (cloud.session) {
    try {
      await cloud.ensureSession();
      setStatus(`已登录 ${cloud.session.email || ''}`.trim());
      const result = await syncWithCloud({ quiet: true });
      setStatus(`已登录 ${cloud.session.email || ''}`.trim());
      toast(`云端同步完成（album ${result.albums} / 图片 ${result.images}）`);
      refreshImageButtons();
    } catch (err) {
      console.warn('云端自动同步失败:', err);
      setStatus(`已登录 ${cloud.session?.email || ''}（自动同步失败）`.trim());
      toast(`自动同步失败：${authErrorMessage(err)}`, 4200);
      // Keep local favorites available offline.
      renderUI();
    }
  }

  try {
    GM_registerMenuCommand(cloudMenuLabel(), () => { handleCloudMenu(); });
  } catch (_) {
    // optional
  }
})();

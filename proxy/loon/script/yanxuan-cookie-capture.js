/**
 * @file yanxuan-cookie-capture.js
 * @description 网易严选活动签到凭据本地安全捕获脚本（适配 Loon）。
 *
 * 安全约束：
 * 1. 严格域名与路径白名单：仅对 act.you.163.com 指定的 3 条签到路径生效。
 * 2. 严格阻止 URL 绕过：拒绝包含 userinfo、非 443 端口、fragment 的异常请求。
 * 3. 严格 Cookie 字段白名单：仅提取 yx_csrf, yx_new_sid, yx_sid, NTES_YD_SESS。
 * 4. 完整性校验：必须包含 yx_csrf 且包含至少一种会话凭据才进行保存。
 * 5. 本地持久化与去重 (Fail-Closed)：严格要求 $persistentStore.write 为有效函数，
 *    写入失败或环境不可持久化时直接终止，绝不发送假成功通知；
 *    若与已有本地存储完全一致则跳过通知与重写，避免页面连续请求频繁发通知。
 * 6. 原请求绝对无害透传：始终由 finally 调用 $done({}) 且仅调用一次。
 * 7. 绝对禁止网络外发：不发起任何外部网络请求，不调用第三方推送服务。
 * 8. 严防信息泄露：通知标题、正文及运行日志中严禁包含任何 Cookie 或凭据明文；
 *    异常捕获时只记录固定通用日志，绝不拼接 err.message；
 *    通过 Loon 的 { clipboard: value } 仅在用户主动点击通知时挂载剪贴板。
 */

(function () {
  "use strict";

  const TARGET_HOSTNAME = "act.you.163.com";
  const ALLOWED_PATHS = Object.freeze([
    "/act-attendance/task/list",
    "/act-attendance/att/v4/index",
    "/act-attendance/att/v3/sign",
  ]);
  const ALLOWED_COOKIE_KEYS = Object.freeze([
    "yx_csrf",
    "yx_new_sid",
    "yx_sid",
    "NTES_YD_SESS",
  ]);
  const STORE_KEY = "yanxuan_daily_sign";

  function complete() {
    if (typeof $done === "function") {
      $done({});
    }
  }

  function getHeader(headers, headerName) {
    if (!headers || typeof headers !== "object") return "";
    const lowerName = headerName.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lowerName) {
        return String(headers[key] || "");
      }
    }
    return "";
  }

  function isAllowedUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return false;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:") return false;
      if (parsed.hostname !== TARGET_HOSTNAME) return false;
      if (parsed.username || parsed.password) return false;
      if (parsed.port && parsed.port !== "443") return false;
      if (parsed.hash) return false;
      return ALLOWED_PATHS.includes(parsed.pathname);
    } catch (_) {
      return /^https:\/\/act\.you\.163\.com(?::443)?\/act-attendance\/(?:task\/list|att\/v4\/index|att\/v3\/sign)(?:\?[^#]*)?$/.test(rawUrl);
    }
  }

  function parseAndFilterCookies(cookieStr) {
    const result = {};
    if (!cookieStr || typeof cookieStr !== "string") return result;

    const parts = cookieStr.split(";");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;

      const key = part.slice(0, eqIdx).trim();
      const val = part.slice(eqIdx + 1).trim();

      if (
        ALLOWED_COOKIE_KEYS.includes(key) &&
        val &&
        val.length <= 512 &&
        !/[\r\n\0]/.test(val)
      ) {
        result[key] = val;
      }
    }
    return result;
  }

  try {
    const req = typeof $request !== "undefined" ? $request : null;
    if (!req || !req.url || !isAllowedUrl(req.url)) {
      return;
    }

    const headers = req.headers || {};
    const cookieHeader = getHeader(headers, "Cookie");
    if (!cookieHeader) {
      return;
    }

    const filtered = parseAndFilterCookies(cookieHeader);

    // 校验登录态完整性：必需 yx_csrf，且必须包含会话 Cookie 之一
    const hasCsrf = Boolean(filtered.yx_csrf);
    const hasSession = Boolean(
      filtered.yx_new_sid || filtered.yx_sid || filtered.NTES_YD_SESS
    );

    if (!hasCsrf || !hasSession) {
      return;
    }

    // 序列化为白名单字段 Cookie 字符串
    const serializedCookie = ALLOWED_COOKIE_KEYS
      .filter((k) => filtered[k])
      .map((k) => `${k}=${filtered[k]}`)
      .join("; ");

    const payload = {
      cookie: serializedCookie,
    };

    const ua = getHeader(headers, "User-Agent");
    if (ua && ua.length <= 512 && !/[\r\n\0]/.test(ua)) {
      payload.ua = ua;
    }

    const payloadJson = JSON.stringify(payload);

    // Fail-Closed 持久化检查：$persistentStore 缺失或 write 不可用时直接拒绝，绝不报假成功
    if (
      typeof $persistentStore === "undefined" ||
      typeof $persistentStore.write !== "function"
    ) {
      return;
    }

    // 检查与已有本地存储是否完全一致，一致则跳过通知与重写，避免页面连续请求频繁发通知
    if (typeof $persistentStore.read === "function") {
      const existing = $persistentStore.read(STORE_KEY);
      if (existing === payloadJson) {
        return;
      }
    }

    // 仅当写入成功时才发送通知，避免假成功
    const isSuccess = $persistentStore.write(payloadJson, STORE_KEY);
    if (!isSuccess) {
      return;
    }

    // 发送脱敏通知：通知标题、副标题与正文绝不包含 Cookie / 敏感凭据
    // 通过 Loon 官方 { clipboard: value } 参数仅在用户主动点击通知时提供剪贴板复制能力
    if (typeof $notification !== "undefined" && typeof $notification.post === "function") {
      $notification.post(
        "网易严选签到",
        "已本地保存凭据",
        "点击本通知复制所需配置，然后到青龙新增 yanxuan_daily_sign 环境变量",
        { clipboard: payloadJson }
      );
    }
  } catch (_) {
    // 捕获异常使用固定常量提示，绝不拼接 err.message 或动态对象以防凭据泄露
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[YanXuan Capture] 处理异常已拦截");
    }
  } finally {
    complete();
  }
})();

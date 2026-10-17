import { join } from 'node:path';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { loadPlaywright } from './dependency.mjs';
import { ORIGIN, validateRequest, fetchInSite } from './policy.mjs';

export function createBrowser({ directory, launcher, launchOptions = {}, prepareContext } = {}) {
  let context = null, starting = null, page = null;
  const profile = join(directory, 'browser-profile');
  const status = () => ({ browser_open: !!context, connected: !!context,
    mode: 'dedicated-browser', login_check_required: true, extension_required: false, pairing_required: false });
  async function open({ focus = true } = {}) {
    if (starting) await starting;
    if (!context) {
      starting = (async () => {
        mkdirSync(profile, { recursive: true, mode: 0o700 });
        const stat = lstatSync(profile);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('UNSAFE_BROWSER_PROFILE');
        chmodSync(profile, 0o700);
        const chromium = launcher ?? loadPlaywright(directory).chromium;
        let next;
        try {
          next = await chromium.launchPersistentContext(profile, {
            channel: 'chrome', headless: false, acceptDownloads: false, timeout: 20000,
            chromiumSandbox: true, viewport: null, ...launchOptions,
          });
        } catch { throw new Error('BROWSER_START_FAILED'); }
        context = next;
        next.on('close', () => { if (context === next) { context = null; page = null; } });
        const guardDownloads = opened => opened.on('download', download => { void download.cancel(); });
        next.on('page', guardDownloads);
        for (const opened of next.pages()) guardDownloads(opened);
        if (prepareContext) await prepareContext(next); // Injected fixture only; not set by the daemon.
      })();
      try { await starting; } finally { starting = null; }
    }
    if (!page || page.isClosed()) page = context.pages().find(p => p.url().startsWith(ORIGIN + '/')) ?? await context.newPage();
    let origin;
    try { origin = new URL(page.url()).origin; } catch { /* Blank initial tab. */ }
    if (origin !== ORIGIN) {
      try { await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 18000 }); }
      catch { return { ...status(), action: '请在专用窗口手动检查网络或完成站点验证。' }; }
    }
    if (focus) await page.bringToFront();
    return { ...status(), action: '请在专用窗口自行登录或完成验证；随后调用 research_account 确认。' };
  }
  async function request(task) {
    validateRequest(task);
    await open({ focus: false });
    let session;
    try {
      session = await context.newCDPSession(page);
      const { frameTree } = await session.send('Page.getFrameTree');
      if (new URL(frameTree.frame.url).origin !== ORIGIN) return { error: 'BROWSER_VERIFICATION_REQUIRED' };
      const { executionContextId } = await session.send('Page.createIsolatedWorld', {
        frameId: frameTree.frame.id, worldName: 'xp-site-research-readonly', grantUniveralAccess: false,
      });
      const result = await session.send('Runtime.evaluate', {
        expression: `(${fetchInSite.toString()})(${JSON.stringify(task.path)})`,
        contextId: executionContextId, returnByValue: true, awaitPromise: true,
      });
      if (result.exceptionDetails || !result.result?.value) return { error: 'BROWSER_REQUEST_FAILED' };
      return result.result.value;
    } catch { return { error: 'BROWSER_REQUEST_FAILED' }; }
    finally { if (session) await session.detach().catch(() => {}); }
  }
  async function close() {
    if (starting) await starting.catch(() => {});
    if (context) await context.close();
    context = null; page = null;
    return { ...status(), session_saved: true };
  }
  return { status, open, request, close };
}

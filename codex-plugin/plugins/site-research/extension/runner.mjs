import { validateRequest, fetchInSite, ORIGIN } from './policy.mjs';
export async function executeTask(chromeApi, task) {
  validateRequest(task);
  const settings = await chromeApi.storage.local.get(['linuxdoTabId']);
  let tab;
  if (Number.isInteger(settings.linuxdoTabId)) {
    try { tab = await chromeApi.tabs.get(settings.linuxdoTabId); } catch { /* User may have closed it. */ }
  }
  if (!tab || !tab.url || new URL(tab.url).origin !== ORIGIN) return { error: 'BROWSER_TAB_REQUIRED' };
  try {
    const results = await chromeApi.scripting.executeScript({
      target: { tabId: tab.id }, world: 'ISOLATED', func: fetchInSite, args: [task.path],
    });
    return results[0]?.result ?? { error: 'BROWSER_REQUEST_FAILED' };
  } catch { return { error: 'BROWSER_REQUEST_FAILED' }; }
}

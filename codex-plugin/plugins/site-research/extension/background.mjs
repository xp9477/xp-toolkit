import { BRIDGE_BASE, ORIGIN } from './policy.mjs';
import { executeTask } from './runner.mjs';
let running = false;
async function bridge(path, token, body) {
  const response = await fetch(BRIDGE_BASE + path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(35000),
  });
  if (!response.ok) throw new Error(`BRIDGE_HTTP_${response.status}`);
  return response.json();
}
async function loop() {
  if (running) return;
  running = true;
  try {
    while (true) {
      const { enabled, pairingToken, clientId } = await chrome.storage.local.get(['enabled', 'pairingToken', 'clientId']);
      if (!enabled || !/^[a-f0-9]{64}$/u.test(pairingToken ?? '') || !clientId) break;
      try {
        const { task } = await bridge('/extension/poll', pairingToken, { clientId });
        if (!task) continue;
        // Disabling takes effect before the next request; in-flight GET may already have completed.
        if (!(await chrome.storage.local.get('enabled')).enabled) break;
        let result;
        try { result = await executeTask(chrome, task); }
        catch { result = { error: 'BROWSER_REQUEST_FAILED' }; }
        await bridge('/extension/result', pairingToken, { id: task.id, clientId, result });
      } catch { break; } // No bypass/retry storm; the alarm reconnects the local bridge, not the website.
    }
  } finally { running = false; }
}
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create('bridge-reconnect', { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(loop);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'bridge-reconnect') void loop(); });
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('options.html')) return false;
  if (message?.type === 'connect') {
    (async () => {
      const tab = await chrome.tabs.create({ url: ORIGIN, active: true });
      await chrome.storage.local.set({ linuxdoTabId: tab.id });
      void loop();
      sendResponse({ ok: true });
    })().catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
void loop();

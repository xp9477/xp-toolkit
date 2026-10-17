const status = document.querySelector('#status');
const token = document.querySelector('#token');
const state = await chrome.storage.local.get('enabled');
status.textContent = state.enabled ? '已启用。可在 Codex 中调用 research_status / research_account 检查连接与登录。' : '尚未连接。';
document.querySelector('#pair-form').addEventListener('submit', async event => {
  event.preventDefault();
  const pairingToken = token.value.trim();
  if (!/^[a-f0-9]{64}$/u.test(pairingToken)) { status.textContent = '配对码格式不正确。'; return; }
  const existing = await chrome.storage.local.get('clientId');
  await chrome.storage.local.set({ pairingToken, clientId: existing.clientId ?? crypto.randomUUID(), enabled: true });
  token.value = ''; // Never populate saved secrets back into the DOM.
  const result = await chrome.runtime.sendMessage({ type: 'connect' });
  status.textContent = result?.ok ? '已打开专用标签页。请登录 Linux.do；桥接连接状态请在 Codex 检查。' : '打开标签页失败，请重新连接。';
});
document.querySelector('#disconnect').addEventListener('click', async () => {
  await chrome.storage.local.set({ enabled: false });
  await chrome.storage.local.remove(['pairingToken', 'clientId', 'linuxdoTabId']);
  token.value = '';
  status.textContent = '已断开并清除配对码。现有请求可能已完成；Linux.do 登录仍保留在浏览器里。';
});

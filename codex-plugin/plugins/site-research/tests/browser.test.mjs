import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowser } from '../src/browser.mjs';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
function mockLauncher() {
  const calls = [];
  const page = { on() {}, url: () => 'https://linux.do/', isClosed: () => false, bringToFront: async () => {} };
  const sessionCalls = [];
  const context = {
    on() {}, pages: () => [page], newPage: async () => page, close: async () => {},
    newCDPSession: async () => ({
      async send(name, args) {
        sessionCalls.push({ name, args });
        if (name === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://linux.do/' } } };
        if (name === 'Page.createIsolatedWorld') return { executionContextId: 123 };
        if (name === 'Runtime.evaluate') return { result: { value: { status: 200, data: { fixture: true } } } };
      }, detach: async () => {},
    }),
  };
  return { calls, sessionCalls, async launchPersistentContext(profile, options) { calls.push({ profile, options }); return context; } };
}
test('dedicated profile is deterministic, no debug TCP port, no extension and isolated evaluation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-browser-test-'));
  const launcher = mockLauncher(); const browser = createBrowser({ directory, launcher });
  try {
    assert.equal(browser.status().browser_open, false);
    const open = await browser.open();
    assert.equal(open.extension_required, false); assert.equal(open.pairing_required, false);
    assert.equal(launcher.calls[0].profile, join(directory, 'browser-profile'));
    assert.equal(launcher.calls[0].options.channel, 'chrome');
    assert.equal(launcher.calls[0].options.acceptDownloads, false);
    assert.equal(launcher.calls[0].options.args, undefined);
    await browser.open(); assert.equal(launcher.calls.length, 1);
    const result = await browser.request({ site: 'linuxdo', path: '/latest.json' });
    assert.equal(result.status, 200);
    const isolated = launcher.sessionCalls.find(c => c.name === 'Page.createIsolatedWorld');
    assert.equal(isolated.args.grantUniveralAccess, false);
    const evaluation = launcher.sessionCalls.find(c => c.name === 'Runtime.evaluate');
    assert.equal(evaluation.args.contextId, 123);
    assert.ok(!evaluation.args.expression.includes('document.cookie'));
    await assert.rejects(browser.request({ site: 'linuxdo', path: '/admin/users.json' }));
    await browser.close(); assert.equal(browser.status().browser_open, false);
    await browser.open(); assert.equal(launcher.calls[1].profile, launcher.calls[0].profile);
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('symlink browser profiles cannot silently point at the daily Chrome profile', async () => {
  if (process.platform === 'win32') return;
  const directory = mkdtempSync(join(tmpdir(), 'xp-browser-test-'));
  const outside = mkdtempSync(join(tmpdir(), 'xp-other-profile-'));
  try {
    symlinkSync(outside, join(directory, 'browser-profile'));
    const browser = createBrowser({ directory, launcher: mockLauncher() });
    await assert.rejects(browser.open(), /UNSAFE_BROWSER_PROFILE/u);
  } finally { rmSync(directory, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

// Browser-only fixtures: never contact Linux.do, read real cookies, or use a real profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBrowser } from '../src/browser.mjs';
import { callTool } from '../src/tools.mjs';

test('real Chrome: isolated GET, projected search/read, persistent login survives relaunch, no extension', { timeout: 45000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-session-fixture-'));
  const requests = []; let setCookie = true;
  const browser = createBrowser({ directory, launchOptions: {
    headless: true,
    ...(process.env.XP_TEST_BROWSER_PATH ? { channel: undefined, executablePath: process.env.XP_TEST_BROWSER_PATH } : {}),
    ...(process.env.CI ? { chromiumSandbox: false } : {}),
  }, prepareContext: async context => {
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== 'https://linux.do') return route.abort();
      requests.push({ path: url.pathname, method: req.method() });
      if (url.pathname === '/') {
        const headers = { 'content-type': 'text/html' };
        if (setCookie) headers['set-cookie'] = 'fixture_session=fixture-only; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600';
        return route.fulfill({ headers, body: '<!doctype html><title>Fixture login only</title><script>window.fetch=()=>{throw Error("main world tampered")};JSON.parse=()=>{throw Error("tampered")}</script><h1>No real website or account</h1>' });
      }
      const loggedIn = (await req.allHeaders()).cookie?.includes('fixture_session=fixture-only') === true;
      if (!loggedIn) return route.fulfill({ status: 401, body: '' });
      if (url.pathname === '/session/current.json') return route.fulfill({ json: { current_user: { username: 'fixture-user', email: 'private@example.test' } } });
      if (url.pathname === '/search.json') return route.fulfill({ json: { topics: [{ id: 3014361, title: 'MuMu fixture' }], posts: [], grouped_search_result: {} } });
      if (url.pathname === '/t/3014361/1.json') return route.fulfill({ json: { id: 3014361, title: 'MuMu fixture', posts_count: 1, highest_post_number: 1, post_stream: { posts: [{ id: 1, post_number: 1, cooked: '<p>Keep apps and data</p>' }] } } });
      return route.fulfill({ status: 404, body: '' });
    });
  } });
  const transport = { request: task => browser.request(task) };
  try {
    assert.equal((await browser.open()).pairing_required, false);
    const account = await callTool('research_account', {}, transport);
    assert.equal(account.data.username, 'fixture-user'); assert.ok(!('email' in account.data));
    const search = await callTool('research_search', { query: 'MuMu' }, transport);
    assert.equal(search.data.topics[0].id, 3014361);
    const topic = await callTool('research_read', { topic: '3014361' }, transport);
    assert.equal(topic.data.posts[0].text, 'Keep apps and data');
    await browser.close(); setCookie = false;
    await browser.open();
    assert.equal((await callTool('research_account', {}, transport)).data.username, 'fixture-user');
    assert.ok(requests.every(req => req.method === 'GET'));
  } finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
});

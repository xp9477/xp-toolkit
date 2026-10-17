import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createBroker } from '../src/broker.mjs';
import { localRequest, loadConfig } from '../src/runtime.mjs';
import { callTool } from '../src/tools.mjs';
import { mkdtempSync, statSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function mockBrowser() {
  let open = false;
  return {
    status: () => ({ browser_open: open, extension_required: false, pairing_required: false }),
    async open() { open = true; return this.status(); },
    async close() { open = false; return this.status(); },
    async request(task) { await this.open(); return { status: 200, data: { fixture: true, path: task.path } }; },
  };
}
async function fixture(t, options = {}) {
  const token = randomBytes(32).toString('hex');
  const browser = options.browser ?? mockBrowser();
  const broker = createBroker({ token, browser, port: 0, ...options });
  const base = await broker.listen();
  t.after(() => broker.stop());
  const config = { base, token };
  const raw = (path, body = {}, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  return { broker, browser, config, raw };
}
test('internal auth is automatic; web Origin, wrong token and wrong Host fail closed', async t => {
  const { config, raw } = await fixture(t);
  assert.equal((await raw('/health', {}, { Authorization: 'Bearer wrong' })).status, 401);
  for (const Origin of ['https://evil.test', 'chrome-extension://' + 'a'.repeat(32)]) assert.equal((await raw('/health', {}, { Origin })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.request(config.base + '/health', { method: 'POST', headers: {
      Host: 'attacker.test', Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json',
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(wrongHost, 403);
  const get = await fetch(config.base + '/health', { headers: { Authorization: `Bearer ${config.token}` } });
  assert.equal(get.status, 405);
  const status = await localRequest(config, '/health');
  assert.equal(status.browser_open, false); assert.equal(status.pairing_required, false);
  assert.ok(!JSON.stringify(status).includes(config.token));
});
test('open/close and requests work without an extension polling or manual pairing', async t => {
  const { config, raw } = await fixture(t);
  assert.equal((await localRequest(config, '/open')).browser_open, true);
  const result = await localRequest(config, '/call', { site: 'linuxdo', path: '/latest.json' });
  assert.equal(result.data.path, '/latest.json');
  assert.equal((await localRequest(config, '/close')).browser_open, false);
  assert.equal((await raw('/extension/poll', {})).status, 404);
  assert.equal((await raw('/call', { site: 'linuxdo', path: '/admin/users.json' })).status, 400);
});
test('search projection roundtrip and private fields remain isolated', async t => {
  const browser = mockBrowser();
  browser.request = async () => ({ status: 200, data: {
    topics: [{ id: 3014361, title: 'MuMu update', posts_count: 2 }],
    posts: [{ id: 101, topic_id: 3014361, post_number: 1, blurb: 'Keep apps' }],
    grouped_search_result: {}, private_key: 'never-return-this',
  } });
  const { config } = await fixture(t, { browser });
  const answer = await callTool('research_search', { query: 'MuMu' }, { request: task => localRequest(config, '/call', task) });
  assert.equal(answer.data.topics[0].url, 'https://linux.do/t/3014361');
  assert.ok(!JSON.stringify(answer).includes('never-return-this'));
});
test('shared daemon serializes requests and enforces global site request spacing', async t => {
  const browser = mockBrowser();
  const times = []; let active = 0, maxActive = 0;
  browser.request = async () => {
    times.push(Date.now()); active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => setTimeout(resolve, 20)); active--;
    return { status: 200, data: {} };
  };
  const { config } = await fixture(t, { browser, minInterval: 100 });
  await Promise.all(['/latest.json', '/hot.json', '/top.json'].map(path => localRequest(config, '/call', { site: 'linuxdo', path })));
  assert.equal(maxActive, 1);
  assert.ok(times[1] - times[0] >= 90); assert.ok(times[2] - times[1] >= 90);
});
test('runtime errors are explicit; unknown exception details cannot leak', async t => {
  const browser = mockBrowser();
  browser.open = async () => { throw new Error('BROWSER_RUNTIME_MISSING'); };
  const { config } = await fixture(t, { browser });
  assert.deepEqual(await localRequest(config, '/open'), { error: 'BROWSER_RUNTIME_MISSING' });
  browser.open = async () => { throw new Error('secret exception containing private input'); };
  assert.deepEqual(await localRequest(config, '/open'), { error: 'LOCAL_REQUEST_FAILED' });
});
test('internal service token stays private and stable; symlinks are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-research-test-'));
  try {
    const config = loadConfig(directory);
    assert.match(config.token, /^[a-f0-9]{64}$/u); assert.equal(loadConfig(directory).token, config.token);
    if (process.platform !== 'win32') {
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(statSync(join(directory, 'bridge-token')).mode & 0o777, 0o600);
      rmSync(join(directory, 'bridge-token'));
      const target = join(directory, 'target'); writeFileSync(target, config.token);
      symlinkSync(target, join(directory, 'bridge-token'));
      assert.throws(() => loadConfig(directory), /UNSAFE_TOKEN_FILE/u);
      assert.equal(readFileSync(target, 'utf8'), config.token);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

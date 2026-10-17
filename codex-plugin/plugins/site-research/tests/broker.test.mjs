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

async function fixture(t, options = {}) {
  const token = randomBytes(32).toString('hex');
  const broker = createBroker({ token, port: 0, pollTimeout: 30, callTimeout: 400, ...options });
  const base = await broker.listen();
  t.after(() => broker.stop());
  const config = { base, token };
  const raw = (path, body = {}, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
  });
  return { broker, config, raw };
}
test('broker protects token, Origin, Host and HTTP method', async t => {
  const { config, raw } = await fixture(t);
  assert.equal((await raw('/health', {}, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await raw('/health', {}, { Origin: 'https://evil.test' })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.request(config.base + '/health', { method: 'POST', headers: {
      Host: 'attacker.test', Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json',
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(wrongHost, 403);
  const get = await fetch(config.base + '/health', { headers: { Authorization: `Bearer ${config.token}` } });
  assert.equal(get.status, 405);
  assert.equal((await localRequest(config, '/health')).connected, false);
  assert.equal((await raw('/call', { site: 'linuxdo', path: '/latest.json' })).status, 503);
});
test('full tool → broker → mock extension → projected citation flow', async t => {
  const { config, raw } = await fixture(t);
  const clientId = 'fixture-client-123456';
  const ready = await raw('/extension/poll', { clientId }); await ready.json();
  const polling = raw('/extension/poll', { clientId });
  const calling = callTool('research_search', { query: 'MuMu 保留数据', limit: 3 }, {
    request: task => localRequest(config, '/call', task),
  });
  const { task } = await (await polling).json();
  assert.equal(task.site, 'linuxdo'); assert.match(task.path, /^\/search.json\?/u);
  assert.equal((await raw('/extension/result', { clientId: 'wrong-client-123456', id: task.id, result: {} })).status, 403);
  const result = { status: 200, data: {
    topics: [{ id: 3014361, title: 'MuMu 升级', posts_count: 2 }],
    posts: [{ id: 101, topic_id: 3014361, post_number: 1, blurb: '保留模拟器数据' }],
    grouped_search_result: { more_full_page_results: false },
  } };
  await (await raw('/extension/result', { clientId, id: task.id, result })).json();
  const answer = await calling;
  assert.equal(answer.untrusted_content, true);
  assert.equal(answer.data.topics[0].url, 'https://linux.do/t/3014361');
  assert.equal(answer.data.matches[0].text, '保留模拟器数据');
  assert.ok(!JSON.stringify(answer).includes(config.token));
});
test('broker rejects hidden endpoints and another active browser, expires unanswered tasks', async t => {
  const { raw } = await fixture(t, { callTimeout: 100 });
  assert.equal((await raw('/call', { site: 'linuxdo', path: '/admin/users.json' })).status, 400);
  await (await raw('/extension/poll', { clientId: 'fixture-client-123456' })).json();
  assert.equal((await raw('/extension/poll', { clientId: 'other-client-123456' })).status, 409);
  const call = await raw('/call', { site: 'linuxdo', path: '/latest.json' });
  assert.equal(call.status, 504);
  assert.deepEqual(await call.json(), { error: 'BROWSER_REQUEST_TIMEOUT' });
});
test('pairing secret is local, permission-restricted, stable and rejects symlinks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-research-test-'));
  try {
    const config = loadConfig(directory);
    assert.match(config.token, /^[a-f0-9]{64}$/u);
    assert.equal(loadConfig(directory).token, config.token);
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
test('separate MCP clients share a globally rate-limited browser queue', async t => {
  const { raw } = await fixture(t, { callTimeout: 2500, pollTimeout: 1500 });
  const clientId = 'fixture-client-123456';
  const poll1 = raw('/extension/poll', { clientId });
  // Waiting briefly here allows the extension long-poll to register before the MCP calls.
  await new Promise(resolve => setTimeout(resolve, 15));
  const calls = [raw('/call', { site: 'linuxdo', path: '/latest.json' }), raw('/call', { site: 'linuxdo', path: '/hot.json' })];
  const first = (await (await poll1).json()).task;
  const started = Date.now();
  await raw('/extension/result', { clientId, id: first.id, result: { status: 200, data: { fixture: true } } });
  const second = (await (await raw('/extension/poll', { clientId })).json()).task;
  assert.ok(Date.now() - started >= 850, 'requests must not bypass the global one-second interval');
  assert.notEqual(first.id, second.id);
  await raw('/extension/result', { clientId, id: second.id, result: { error: 'HTTP_504', status: 504 } });
  const results = await Promise.all(calls.map(async p => (await p).json()));
  assert.ok(results.some(value => value.error === 'HTTP_504'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchInSite } from '../src/policy.mjs';

test('stdio MCP handshake, tool discovery and errors produce only valid JSON-RPC', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/mcp-server.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const messages = [
    { jsonrpc: '2.0', id: 0, method: 'tools/list' },
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'research_sites', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'research_read', arguments: { topic: 'https://evil.test/t/1' } } },
    { jsonrpc: '2.0', id: 5, method: 'unknown' },
  ];
  child.stdin.end(messages.map(value => JSON.stringify(value)).join('\n') + '\nnot-json\n');
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0); assert.equal(stderr, '');
  const responses = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.length, 7);
  assert.equal(responses[0].error.code, -32002);
  assert.equal(responses[1].result.protocolVersion, '2025-06-18');
  assert.equal(responses[2].result.tools.length, 8);
  assert.equal(JSON.parse(responses[3].result.content[0].text).sites[0].id, 'linuxdo');
  assert.equal(responses[4].result.isError, true);
  assert.equal(responses[5].error.code, -32601);
  assert.equal(responses[6].error.code, -32700);
});
test('in-page GET uses browser credentials, denies redirects and classifies failures', async () => {
  const originalLocation = globalThis.location, originalFetch = globalThis.fetch;
  let options;
  globalThis.location = { origin: 'https://linux.do' };
  try {
    globalThis.fetch = async (_path, init) => { options = init; return new Response(JSON.stringify({ posts: [] }), { headers: { 'content-type': 'application/json' } }); };
    assert.equal((await fetchInSite('/latest.json')).status, 200);
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, undefined);
    globalThis.fetch = async () => new Response('private body', { status: 403 });
    assert.deepEqual(await fetchInSite('/latest.json'), { error: 'HTTP_403', status: 403 });
    globalThis.fetch = async () => new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } });
    assert.equal((await fetchInSite('/latest.json')).error, 'BROWSER_VERIFICATION_REQUIRED');
    globalThis.location = { origin: 'https://evil.test' };
    assert.equal((await fetchInSite('/latest.json')).error, 'WRONG_SITE');
  } finally { globalThis.fetch = originalFetch; globalThis.location = originalLocation; }
});

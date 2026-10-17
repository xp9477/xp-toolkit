import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { MAX_BYTES, validateRequest } from './policy.mjs';
import { VERSION } from './version.mjs';
const SAFE_ERRORS = new Set(['UNSUPPORTED_SITE', 'INVALID_PATH', 'INVALID_ORIGIN', 'INVALID_QUERY', 'INVALID_PAGE', 'ENDPOINT_NOT_ALLOWED', 'BROWSER_RUNTIME_MISSING', 'BROWSER_START_FAILED', 'UNSAFE_BROWSER_PROFILE']);
export function createBroker({ token, browser, port = 47832, idleTimeout = 900000, minInterval = 1000 } = {}) {
  if (!/^[a-f0-9]{64}$/u.test(token ?? '')) throw new Error('INVALID_TOKEN');
  if (!browser) throw new Error('BROWSER_REQUIRED');
  let tail = Promise.resolve(), queued = 0, lastRequest = 0, lastActivity = Date.now(), stopping = false;
  const reply = (response, status, data) => {
    if (!response.destroyed && !response.writableEnded) response.writeHead(status, {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    }).end(JSON.stringify(data));
  };
  function enqueue(action) {
    if (queued >= 16) throw new Error('QUEUE_FULL');
    queued++;
    const result = tail.then(action);
    tail = result.catch(() => {}).finally(() => { queued--; });
    return result;
  }
  const server = http.createServer(async (request, response) => {
    const auth = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    // Only local Node clients are admitted; web pages/extensions need no access in this version.
    if (request.headers.host !== `127.0.0.1:${server.address()?.port}` || request.headers.origin) return reply(response, 403, { error: 'FORBIDDEN_ORIGIN' });
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply(response, 401, { error: 'LOCAL_AUTH_REQUIRED' });
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) return reply(response, 405, { error: 'JSON_POST_REQUIRED' });
    if (stopping) return reply(response, 503, { error: 'BRIDGE_STOPPING' });
    lastActivity = Date.now();
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65536) throw new Error('INVALID_REQUEST');
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_REQUEST');
      if (request.url === '/health') return reply(response, 200, {
        service: 'xp-site-research', version: VERSION, read_only: true, ...browser.status(),
      });
      if (request.url === '/stop') { await stop(); reply(response, 200, { stopped: true, session_saved: true }); return; }
      if (!['/open', '/close', '/call'].includes(request.url)) return reply(response, 404, { error: 'UNKNOWN_ENDPOINT' });
      if (request.url === '/call') validateRequest(data);
      const result = await enqueue(async () => {
        // A disconnected caller must not start another browser/site request.
        if (response.destroyed) return { error: 'CALLER_DISCONNECTED' };
        if (request.url === '/open') return browser.open();
        if (request.url === '/close') return browser.close();
        const wait = lastRequest + minInterval - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        if (response.destroyed) return { error: 'CALLER_DISCONNECTED' };
        lastRequest = Date.now();
        try { return await browser.request(data); }
        finally { lastActivity = Date.now(); }
      });
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES + 65536) return reply(response, 502, { error: 'RESPONSE_TOO_LARGE' });
      reply(response, 200, result);
    } catch (error) {
      const message = SAFE_ERRORS.has(error.message) || error.message === 'QUEUE_FULL' ? error.message : 'LOCAL_REQUEST_FAILED';
      reply(response, error.message === 'QUEUE_FULL' ? 429 : 400, { error: message });
    }
  });
  server.headersTimeout = 5000; server.requestTimeout = 20000; server.maxConnections = 32;
  const idle = setInterval(() => {
    if (!queued && !browser.status().browser_open && Date.now() - lastActivity > idleTimeout) void stop();
  }, Math.min(idleTimeout, 60000));
  idle.unref();
  async function stop() {
    if (stopping) return;
    stopping = true; clearInterval(idle);
    await tail;
    await browser.close();
    server.close(); server.closeIdleConnections();
  }
  return { server, stop, listen: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  }) };
}

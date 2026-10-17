import http from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { MAX_BYTES, validateRequest } from '../extension/policy.mjs';

const PUBLIC_ERRORS = new Set(['WRONG_SITE', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_429', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'BROWSER_VERIFICATION_REQUIRED', 'NETWORK_OR_VERIFICATION_FAILED', 'RESPONSE_TOO_LARGE', 'BROWSER_TAB_REQUIRED', 'BROWSER_REQUEST_FAILED']);
export function createBroker({ token, port = 47831, callTimeout = 30000, pollTimeout = 15000, idleTimeout = 900000 } = {}) {
  if (!/^[a-f0-9]{64}$/u.test(token ?? '')) throw new Error('INVALID_TOKEN');
  const pending = new Map();
  const queue = [];
  let polling = null, lastPoll = 0, lastActivity = Date.now(), nextDispatch = 0, clientId = null;
  let dispatchTimer;
  function reply(response, status, data) {
    if (!response.destroyed && !response.writableEnded) response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(data));
  }
  function flush() {
    while (queue.length && !pending.has(queue[0].id)) queue.shift();
    if (!polling || !queue.length) return;
    const wait = nextDispatch - Date.now();
    if (wait > 0) { clearTimeout(dispatchTimer); dispatchTimer = setTimeout(flush, wait); return; }
    const { response, timer } = polling;
    polling = null; clearTimeout(timer);
    nextDispatch = Date.now() + 1000;
    reply(response, 200, { task: queue.shift() });
  }
  async function body(request) {
    if (Number(request.headers['content-length']) > MAX_BYTES + 65536) throw new Error('BODY_TOO_LARGE');
    let size = 0; const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BYTES + 65536) throw new Error('BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_BODY');
    return value;
  }
  const server = http.createServer(async (request, response) => {
    const expectedHost = `127.0.0.1:${server.address()?.port}`;
    const origin = request.headers.origin;
    const auth = Buffer.from(request.headers.authorization ?? '');
    const expectedAuth = Buffer.from(`Bearer ${token}`);
    if (request.headers.host !== expectedHost || (origin && !/^chrome-extension:\/\/[a-p]{32}$/u.test(origin))) return reply(response, 403, { error: 'FORBIDDEN_ORIGIN' });
    if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) return reply(response, 401, { error: 'PAIRING_REQUIRED' });
    if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) return reply(response, 405, { error: 'JSON_POST_REQUIRED' });
    lastActivity = Date.now();
    try {
      const data = await body(request);
      if (request.url === '/health') return reply(response, 200, { service: 'xp-site-research', version: '0.1.0', connected: Date.now() - lastPoll < 45000, read_only: true });
      if (request.url === '/stop') { reply(response, 200, { stopped: true }); setImmediate(stop); return; }
      if (request.url === '/extension/poll') {
        if (typeof data.clientId !== 'string' || !/^[a-z0-9-]{16,64}$/iu.test(data.clientId)) return reply(response, 400, { error: 'INVALID_CLIENT' });
        if (clientId && clientId !== data.clientId && Date.now() - lastPoll < 45000) return reply(response, 409, { error: 'ANOTHER_BROWSER_CONNECTED' });
        if (polling) return reply(response, 409, { error: 'POLL_ALREADY_PENDING' });
        clientId = data.clientId; lastPoll = Date.now();
        const timer = setTimeout(() => {
          if (polling?.response === response) { polling = null; reply(response, 200, { task: null }); }
        }, pollTimeout);
        polling = { response, timer };
        response.on('close', () => { if (polling?.response === response) { clearTimeout(timer); polling = null; } });
        flush(); return;
      }
      if (request.url === '/extension/result') {
        if (data.clientId !== clientId) return reply(response, 403, { error: 'WRONG_CLIENT' });
        const item = pending.get(data.id);
        if (!item) return reply(response, 410, { error: 'TASK_EXPIRED' });
        const result = data.result;
        if (!result || typeof result !== 'object' || Array.isArray(result) || (result.error && !PUBLIC_ERRORS.has(result.error) && !/^HTTP_[45][0-9]{2}$/u.test(result.error)) || (!result.error && (result.status !== 200 || !result.data || typeof result.data !== 'object'))) return reply(response, 400, { error: 'INVALID_RESULT' });
        clearTimeout(item.timer); pending.delete(data.id);
        reply(item.response, 200, result); reply(response, 200, { received: true }); return;
      }
      if (request.url === '/call') {
        validateRequest(data);
        if (Date.now() - lastPoll >= 45000) return reply(response, 503, { error: 'BROWSER_NOT_CONNECTED' });
        if (pending.size >= 16) return reply(response, 429, { error: 'QUEUE_FULL' });
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reply(response, 504, { error: 'BROWSER_REQUEST_TIMEOUT' }); flush(); }, callTimeout);
        pending.set(id, { response, timer }); queue.push({ id, site: data.site, path: data.path });
        response.on('close', () => { const item = pending.get(id); if (item) { clearTimeout(item.timer); pending.delete(id); flush(); } });
        flush(); return;
      }
      reply(response, 404, { error: 'UNKNOWN_ENDPOINT' });
    } catch { reply(response, 400, { error: 'INVALID_REQUEST' }); }
  });
  server.headersTimeout = 5000; server.requestTimeout = 20000;
  server.maxConnections = 32;
  const idle = setInterval(() => { if (!pending.size && Date.now() - lastActivity > idleTimeout) stop(); }, Math.min(idleTimeout, 60000));
  idle.unref();
  function stop() {
    clearInterval(idle); clearTimeout(dispatchTimer);
    if (polling) { clearTimeout(polling.timer); reply(polling.response, 200, { task: null }); polling = null; }
    for (const { response, timer } of pending.values()) { clearTimeout(timer); reply(response, 503, { error: 'BRIDGE_STOPPED' }); }
    pending.clear(); queue.length = 0;
    server.close(); server.closeIdleConnections();
  }
  return { server, stop, listen: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  }) };
}

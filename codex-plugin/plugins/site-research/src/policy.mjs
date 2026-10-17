// Shared by the local daemon and browser transport. New sites need an explicit allowlist.
export const SITE = 'linuxdo';
export const ORIGIN = 'https://linux.do';
export const MAX_BYTES = 2 * 1024 * 1024;
export const BRIDGE_BASE = 'http://127.0.0.1:47832';

export function validateRequest(task) {
  if (!task || task.site !== SITE || typeof task.path !== 'string') {
    throw new Error('UNSUPPORTED_SITE');
  }
  if (!task.path.startsWith('/') || task.path.startsWith('//') || /[\\#%\x00-\x20]/u.test(task.path.split('?')[0])) {
    throw new Error('INVALID_PATH');
  }
  const url = new URL(task.path, ORIGIN);
  if (url.origin !== ORIGIN || url.hash || url.username || url.password) throw new Error('INVALID_ORIGIN');
  const params = [...url.searchParams];
  const path = url.pathname;
  if (path === '/search.json') {
    if (params.length !== 2 || url.searchParams.getAll('q').length !== 1 || url.searchParams.getAll('page').length !== 1) throw new Error('INVALID_QUERY');
    const q = url.searchParams.get('q');
    if (!q || q.length > 500 || /[\x00-\x1f]/u.test(q)) throw new Error('INVALID_QUERY');
    if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(url.searchParams.get('page'))) throw new Error('INVALID_PAGE');
  } else if (!(
    /^\/t\/[1-9][0-9]{0,11}\/([1-9][0-9]{0,6})\.json$/u.test(path)
    || /^\/(latest|hot|top)\.json$/u.test(path)
    || path === '/session/current.json'
  ) || params.length) {
    throw new Error('ENDPOINT_NOT_ALLOWED');
  }
  return url.href;
}

// Runs in a CDP isolated world, never the page's main JavaScript context. Self-contained.
export async function fetchInSite(path) {
  if (location.origin !== 'https://linux.do') return { error: 'WRONG_SITE' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 18000);
  try {
    const response = await fetch(path, {
      method: 'GET', credentials: 'include', redirect: 'error',
      headers: { Accept: 'application/json' }, signal: abort.signal,
    });
    if (!response.ok) return { error: `HTTP_${response.status}`, status: response.status };
    if (!response.headers.get('content-type')?.includes('application/json')) return { error: 'BROWSER_VERIFICATION_REQUIRED' };
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); return { error: 'RESPONSE_TOO_LARGE' }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return { status: response.status, data };
  } catch {
    return { error: 'NETWORK_OR_VERIFICATION_FAILED' };
  } finally { clearTimeout(timer); }
}

import { ORIGIN, validateRequest } from '../policy.mjs';

const safeText = (value, max = 1000) => typeof value === 'string' ? value.slice(0, max) : '';
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function htmlToText(html) {
  return safeText(html, 120000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<\/(p|div|li|pre|blockquote|h[1-6])\s*>|<br\s*\/?>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (match, key) => {
      if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? match;
      const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
    }).trim();
}
export function topicId(input) {
  if (typeof input !== 'string') throw new Error('topic 必须是 Linux.do 帖子链接或数字 ID');
  if (/^[1-9][0-9]{0,11}$/u.test(input)) return input;
  let url;
  try { url = new URL(input); } catch { throw new Error('INVALID_TOPIC_URL'); }
  if (url.origin !== ORIGIN || url.username || url.password || /[\\]/u.test(input)) throw new Error('INVALID_TOPIC_URL');
  const parts = url.pathname.replace(/\/$/u, '').split('/').slice(1);
  if (parts[0] !== 't') throw new Error('INVALID_TOPIC_URL');
  const numeric = /^[1-9][0-9]{0,11}$/u;
  const offset = numeric.test(parts[1] ?? '') ? 1 : 2;
  if (!numeric.test(parts[offset] ?? '') || parts.length > offset + 2 || parts.length < offset + 1
      || (parts.length === offset + 2 && !/^[1-9][0-9]{0,6}$/u.test(parts[offset + 1]))) throw new Error('INVALID_TOPIC_URL');
  return parts[offset];
}
export function int(value, fallback, min, max) {
  const n = value === undefined ? fallback : value;
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`参数须为 ${min}–${max} 的整数`);
  return n;
}
function post(row) {
  const body = htmlToText(row.cooked ?? row.blurb ?? '');
  const links = [];
  for (const match of safeText(row.cooked, 120000).matchAll(/\bhref\s*=\s*["']([^"']+)["']/giu)) {
    try {
      const url = new URL(htmlToText(match[1]), ORIGIN);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) links.push(url.href);
    } catch { /* Untrusted malformed links are not followed. */ }
  }
  return {
    id: row.id, post_number: row.post_number, username: safeText(row.username, 100),
    created_at: safeText(row.created_at, 50), text: body.slice(0, 10000),
    text_truncated: body.length > 10000, links: [...new Set(links)].slice(0, 50),
    url: `${ORIGIN}/t/${row.topic_id}/${row.post_number ?? 1}`,
    accepted_answer: row.accepted_answer === true,
  };
}
function topics(rows, limit) {
  return rows.slice(0, limit).map(row => ({
    id: row.id, title: safeText(row.title, 400), url: `${ORIGIN}/t/${row.id}`,
    posts_count: row.posts_count, created_at: safeText(row.created_at, 50),
    last_posted_at: safeText(row.last_posted_at, 50),
    tags: Array.isArray(row.tags) ? row.tags.filter(t => typeof t === 'string').slice(0, 20) : [],
  }));
}
export function plan(operation, args) {
  let path;
  const limit = int(args.limit, 10, 1, 20);
  let id, start;
  if (operation === 'account') path = '/session/current.json';
  else if (operation === 'search') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw new Error('query 须为 1–500 字符');
    const page = int(args.page, 1, 1, 100);
    path = `/search.json?${new URLSearchParams({ q: args.query, page: String(page) })}`;
  } else if (operation === 'read') {
    id = topicId(args.topic); start = int(args.start_post, 1, 1, 9999999);
    path = `/t/${id}/${start}.json`;
  } else if (operation === 'latest') {
    const filter = args.filter ?? 'latest';
    if (!['latest', 'hot', 'top'].includes(filter)) throw new Error('INVALID_FILTER');
    path = `/${filter}.json`;
  } else throw new Error('UNSUPPORTED_OPERATION');
  const request = { site: 'linuxdo', path };
  validateRequest(request);
  return { request, project(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.errors) throw new Error('INVALID_SITE_RESPONSE');
    if (operation === 'account') {
      const user = data.current_user;
      return { logged_in: !!user?.username, username: safeText(user?.username, 100), name: safeText(user?.name, 200) };
    }
    if (operation === 'search') {
      if (!Array.isArray(data.topics) || !Array.isArray(data.posts)) throw new Error('INVALID_SEARCH_RESPONSE');
      return { topics: topics(data.topics, limit), matches: data.posts.slice(0, limit).map(post),
        more_available: data.grouped_search_result?.more_full_page_results === true || data.topics.length > limit || data.posts.length > limit,
        page: args.page ?? 1, scope: '当前账号可访问的搜索结果；未读取所有匹配帖正文' };
    }
    if (operation === 'latest') {
      if (!Array.isArray(data.topic_list?.topics)) throw new Error('INVALID_TOPIC_LIST');
      return { topics: topics(data.topic_list.topics, limit), scope: '单次列表窗口，非全站穷尽结果' };
    }
    if (!Array.isArray(data.post_stream?.posts) || String(data.id) !== id) throw new Error('INVALID_TOPIC_RESPONSE');
    const rows = data.post_stream.posts.filter(p => Number.isInteger(p.post_number) && p.post_number >= start).sort((a, b) => a.post_number - b.post_number);
    const selected = rows.slice(0, limit);
    const projected = selected.map(row => post({ ...row, topic_id: data.id }));
    const last = selected.at(-1)?.post_number;
    const highest = data.highest_post_number ?? data.posts_count;
    return { id: data.id, title: safeText(data.title, 400), url: `${ORIGIN}/t/${id}`,
      posts_count: data.posts_count, highest_post_number: highest,
      posts: projected, next_post: last && last < highest ? last + 1 : null,
      coverage: { start_post: start, returned: selected.length, entire_topic: start === 1 && selected.length === data.posts_count },
      accepted_answer_post_id: data.accepted_answer?.post_id ?? null,
      scope: '单次帖子窗口；next_post 非空时应继续读取，不能称为已读完整帖' };
  } };
}
export const linuxdo = { id: 'linuxdo', name: 'Linux.do', origin: ORIGIN, auth: 'dedicated-browser-session', read_only: true, plan };

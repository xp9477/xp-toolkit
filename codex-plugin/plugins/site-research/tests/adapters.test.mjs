import test from 'node:test';
import assert from 'node:assert/strict';
import { topicId, htmlToText, plan } from '../src/adapters/linuxdo.mjs';
import { validateRequest } from '../src/policy.mjs';
import { callTool, tools } from '../src/tools.mjs';


test('topic selection never accepts other origins, credentials or traversal', () => {
  for (const input of ['3014361', 'https://linux.do/t/topic/3014361', 'https://linux.do/t/3014361/2', 'https://linux.do/t/topic/3014361?u=fixture#post', 'https://linux.do/t/%E6%B5%8B%E8%AF%95/3014361']) assert.equal(topicId(input), '3014361');
  for (const input of ['https://evil.test/t/topic/3014361', 'https://linux.do.evil.test/t/topic/3014361', 'https://u:p@linux.do/t/3014361', 'file:///t/3014361', '//evil.test/t/3014361', '../3014361', '0', '1e5']) assert.throws(() => topicId(input));
});
test('shared request allowlist excludes writes, other endpoints, encoded paths, redirect tricks', () => {
  const valid = ['/search.json?q=test&page=1', '/t/3014361/1.json', '/latest.json', '/hot.json', '/top.json', '/session/current.json'];
  for (const path of valid) assert.ok(validateRequest({ site: 'linuxdo', path }).startsWith('https://linux.do/'));
  const bad = ['//evil.test/x', '/posts.json', '/admin/users.json', '/t/1/1.json?foo=bar', '/session/current.json?x=1', '/search.json?q=x&page=0', '/search.json?q=x&page=1&x=1', '/search.json?q=x&q=y&page=1', '/search.json?q=x&page=1#x', '/%2e%2e/posts.json', '/\\evil.test/x', '/uploads/1.json', '/session'];
  for (const path of bad) assert.throws(() => validateRequest({ site: 'linuxdo', path }), path);
  assert.throws(() => validateRequest({ site: 'future', path: '/latest.json' }));
});
test('account projection returns no private session fields', () => {
  const { project } = plan('account', {});
  assert.deepEqual(project({ current_user: { username: 'fixture', name: 'Tester', api_key: 'secret', email: 'private@example.test' } }), { logged_in: true, username: 'fixture', name: 'Tester' });
  assert.equal(project({ current_user: null }).logged_in, false);
});
test('topic projection preserves code text, citations and explicit partial coverage', () => {
  const { request, project } = plan('read', { topic: '3014361', limit: 1 });
  assert.equal(request.path, '/t/3014361/1.json');
  const result = project({ id: 3014361, title: 'MuMu update', posts_count: 2, highest_post_number: 3,
    accepted_answer: { post_id: 102 }, post_stream: { posts: [
      { id: 101, post_number: 1, cooked: '<p>keep app &amp; data</p><pre>x &lt; y</pre><a href="https://vendor.test/update">official</a><a href="javascript:alert(1)">bad</a>' },
      { id: 102, post_number: 3, cooked: 'answer' },
    ] } });
  assert.equal(result.next_post, 2); assert.equal(result.coverage.entire_topic, false);
  assert.match(result.posts[0].text, /x < y/u);
  assert.equal(result.posts[0].url, 'https://linux.do/t/3014361/1');
  assert.deepEqual(result.posts[0].links, ['https://vendor.test/update']);
  assert.equal(result.accepted_answer_post_id, 102);
  assert.throws(() => project({ id: 3014362, post_stream: { posts: [] } }));
});
test('invalid responses and params fail visibly rather than silently returning empty results', () => {
  for (const args of [{ query: '' }, { query: 'x', page: '1' }, { query: 'x', limit: 0 }, { query: 'x', page: 101 }]) assert.throws(() => plan('search', args));
  assert.throws(() => plan('latest', { filter: 'admin' }));
  assert.throws(() => plan('search', { query: 'x' }).project({ errors: ['private error'] }));
  assert.throws(() => plan('search', { query: 'x' }).project({}));
  assert.equal(htmlToText('<script>secret()</script><p>A &#x4e2d;</p>'), 'A 中');
});
test('tool schemas are read-only and argument validation precedes network access', async () => {
  for (const tool of tools) assert.equal(tool.annotations.readOnlyHint, true);
  const never = { request() { throw new Error('NETWORK_SHOULD_NOT_RUN'); } };
  await assert.rejects(callTool('research_search', { query: 'x', cookie: 'secret' }, never), /INVALID_ARGUMENTS/u);
  await assert.rejects(callTool('research_read', { topic: 'https://evil.test/t/1' }, never), /INVALID_TOPIC_URL/u);
  const result = await callTool('research_sites', {}, never);
  assert.deepEqual(result.sites.map(s => s.id), ['linuxdo']);
  await assert.rejects(callTool('research_search', { query: 'x' }, { request: async () => ({ error: 'HTTP_404' }) }), /不能仅据此/u);
});

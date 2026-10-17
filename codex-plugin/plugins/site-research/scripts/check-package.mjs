import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const pkg = readJSON(join(root, 'package.json'));
const manifest = readJSON(join(root, '.codex-plugin/plugin.json'));
assert.ok(!existsSync(join(root, 'extension')), 'Extension must not be shipped');
assert.ok(!Object.hasOwn(pkg.scripts, 'pair'), 'No pairing command');
const lock = readJSON(join(root, 'package-lock.json'));
assert.equal(lock.packages[''].dependencies['playwright-core'], pkg.dependencies['playwright-core']);
assert.match(pkg.dependencies['playwright-core'], /^\d+\.\d+\.\d+$/u);
assert.ok(lock.packages['node_modules/playwright-core'].integrity.startsWith('sha512-'));
assert.equal(pkg.version, manifest.version);

assert.equal(manifest.name, 'site-research');
assert.equal(manifest.skills, './skills/');
const mcp = readJSON(join(root, manifest.mcpServers));
assert.equal(mcp.mcpServers['site-research'].command, 'node');
const entrypoint = mcp.mcpServers['site-research'].args[0].replace('${CLAUDE_PLUGIN_ROOT}', root);
assert.ok(readFileSync(entrypoint).length);

const marketRoot = resolve(root, '../..');
const market = readJSON(join(marketRoot, '.agents/plugins/marketplace.json'));
const entry = market.plugins.find(item => item.name === manifest.name);
assert.equal(resolve(marketRoot, entry.source.path), root);
assert.equal(entry.policy.installation, 'AVAILABLE');
assert.equal(entry.policy.authentication, 'ON_USE');
const digest = createHash('sha256');
function walk(path) {
  for (const ent of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const file = join(path, ent.name);
    assert.ok(!ent.isSymbolicLink(), `Unexpected symlink: ${file}`);
    if (ent.isDirectory()) walk(file);
    else {
      const bytes = readFileSync(file); digest.update(file.slice(root.length)); digest.update(bytes);
      if (/\.(?:json|md|mjs|html)$/u.test(file)) assert.ok(!bytes.toString().includes('[' + 'TODO:'), file);
      if (file.endsWith('.mjs')) assert.equal(spawnSync(process.execPath, ['--check', file]).status, 0, file);
    }
  }
}
walk(root);
console.log(`Package/marketplace/path/permission/syntax checks passed. SHA-256 tree: ${digest.digest('hex')}`);

import { mkdirSync, lstatSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version.mjs';
import { BRIDGE_BASE } from './policy.mjs';

export function loadConfig(directory = process.env.XP_RESEARCH_STATE_DIR ?? join(homedir(), '.local', 'share', 'xp-site-research')) {
  if (!isAbsolute(directory)) throw new Error('STATE_DIR_MUST_BE_ABSOLUTE');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new Error('UNSAFE_STATE_DIRECTORY');
  chmodSync(directory, 0o700);
  const file = join(directory, 'bridge-token');
  try { writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('UNSAFE_TOKEN_FILE');
  chmodSync(file, 0o600);
  const token = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/u.test(token)) throw new Error('INVALID_LOCAL_SERVICE_TOKEN');
  return { token, directory, base: BRIDGE_BASE };
}
export async function localRequest(config, path, body = {}, timeout = 60000) {
  const response = await fetch(config.base + path, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok && !result.error) throw new Error(`LOCAL_BRIDGE_HTTP_${response.status}`);
  return result;
}
export async function ensureBridge(config = loadConfig()) {
  try {
    const health = await localRequest(config, '/health', {}, 1000);
    if (health.service !== 'xp-site-research' || health.error || health.version !== VERSION) throw new Error('LOCAL_BRIDGE_HTTP_VERSION_MISMATCH');
    return config;
  }
  catch (error) { if (/LOCAL_BRIDGE_HTTP_/u.test(error.message)) throw error; }
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/bridge.mjs', import.meta.url))], {
    detached: true, stdio: 'ignore', env: { ...process.env, XP_RESEARCH_STATE_DIR: config.directory },
  });
  let spawnFailed = false;
  child.on('error', () => { spawnFailed = true; }); child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (spawnFailed) throw new Error('BRIDGE_START_FAILED');
    try {
      const health = await localRequest(config, '/health', {}, 500);
      if (health.service !== 'xp-site-research' || health.error || health.version !== VERSION) throw new Error('LOCAL_BRIDGE_HTTP_VERSION_MISMATCH');
      return config;
    }
    catch (error) { if (/LOCAL_BRIDGE_HTTP_/u.test(error.message)) throw error; }
  }
  throw new Error('BRIDGE_START_FAILED_OR_PORT_IN_USE');
}

// Explicit one-time setup: install only the locked Node package, never download a browser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../src/runtime.mjs';
import { PLAYWRIGHT_VERSION } from '../src/version.mjs';
const config = loadConfig();
const target = join(config.directory, 'runtime', PLAYWRIGHT_VERSION);
mkdirSync(target, { recursive: true, mode: 0o700 });
for (const name of ['package.json', 'package-lock.json']) {
  writeFileSync(join(target, name), readFileSync(new URL('../' + name, import.meta.url)), { mode: 0o600 });
}
const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-fund', '--audit=false', '--fetch-retries=1', '--fetch-timeout=30000'], {
  cwd: target, stdio: 'inherit', shell: false,
});
child.on('error', () => { console.error('npm 不可用，无法安装浏览器运行时。'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PLAYWRIGHT_VERSION } from './version.mjs';
export function loadPlaywright(directory) {
  // A local npm ci is useful in development. Personal installs use the shared private runtime.
  const roots = [new URL('../package.json', import.meta.url), join(directory, 'runtime', PLAYWRIGHT_VERSION, 'package.json')];
  for (const root of roots) {
    try {
      const require = createRequire(root);
      const pkg = require('playwright-core/package.json');
      if (pkg.version === PLAYWRIGHT_VERSION) return require('playwright-core');
    } catch { /* Try the other explicitly controlled location, never unrelated global modules. */ }
  }
  throw new Error('BROWSER_RUNTIME_MISSING');
}

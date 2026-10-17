import { readFileSync } from 'node:fs';
export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const PLAYWRIGHT_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies['playwright-core'];

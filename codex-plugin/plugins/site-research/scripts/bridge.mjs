import { loadConfig } from '../src/runtime.mjs';
import { createBroker } from '../src/broker.mjs';
import { createBrowser } from '../src/browser.mjs';
const config = loadConfig();
const broker = createBroker({ ...config, browser: createBrowser(config) });
try { await broker.listen(); }
catch { process.exitCode = 1; await broker.stop(); }
process.on('SIGTERM', () => { void broker.stop(); });
process.on('SIGINT', () => { void broker.stop(); });

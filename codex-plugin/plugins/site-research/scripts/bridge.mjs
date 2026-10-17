import { loadConfig } from '../src/runtime.mjs';
import { createBroker } from '../src/broker.mjs';
const broker = createBroker(loadConfig());
try { await broker.listen(); }
catch { process.exitCode = 1; broker.stop(); }
process.on('SIGTERM', () => broker.stop());
process.on('SIGINT', () => broker.stop());

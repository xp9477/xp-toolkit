import { linuxdo } from './linuxdo.mjs';
// Extend this registry only when the matching browser permission + policy + tests exist.
const sites = new Map([[linuxdo.id, linuxdo]]);
export function listSites() { return [...sites.values()].map(({ plan: _plan, ...metadata }) => metadata); }
export function getSite(id = 'linuxdo') {
  if (!sites.has(id)) throw new Error('UNSUPPORTED_SITE');
  return sites.get(id);
}

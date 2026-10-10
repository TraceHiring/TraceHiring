// Small CLI helpers shared by repo scripts.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when the module at `moduleUrl` is the script node was started with (not an import). */
export function isEntryPoint(moduleUrl, argv1 = process.argv[1], platform = process.platform) {
  if (!argv1) return false;
  const norm = (p) => (platform === 'win32' ? p.toLowerCase() : p);
  return norm(resolve(argv1)) === norm(fileURLToPath(moduleUrl));
}

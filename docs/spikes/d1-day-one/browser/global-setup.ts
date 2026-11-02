import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR } from './support/env.ts';
import { startMediaWorker, startSite } from './support/servers.ts';

// Boots the media Worker (wrangler dev) and the recruiter stand-in once for the whole run.
export default async function globalSetup() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const t0 = performance.now();
  const site = await startSite();
  const worker = await startMediaWorker();
  const timings = {
    siteAndWorkerReadyMs: Math.round(performance.now() - t0),
    wranglerBootMs: worker.bootMs,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'setup-timings.json'), JSON.stringify(timings, null, 2));
  console.log(`setup: ${JSON.stringify(timings)}`);
  return async () => {
    worker.stop();
    await new Promise<void>((resolve) => site.close(() => resolve()));
  };
}

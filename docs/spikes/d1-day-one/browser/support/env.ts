// Shared constants for the browser spikes (DC-D5 part c, DC-D6). Two loopback names on two ports stand in for two
// sites: the recruiter app (localhost:8812) and the media Worker (127.0.0.1:8811). Different host AND port, so the
// fetch is cross-origin and even cross-site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPO_ROOT = path.resolve(SPIKE_DIR, '..', '..', '..');
export const OUT_DIR = path.join(SPIKE_DIR, '.out');

export const WORKER_PORT = 8811;
export const SITE_PORT = 8812;
export const WORKER_ORIGIN = `http://127.0.0.1:${WORKER_PORT}`;
export const SITE_ORIGIN = `http://localhost:${SITE_PORT}`;

export const SYNTHETIC_SUPABASE_ORIGIN = 'https://synthetic-project.supabase.example';

export const FAKE_MEDIA_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
];

export type CspVariant = 'strict' | 'img-allowed' | 'unmodified';

export interface SiteHeaders {
  csp: string;
  others: Record<string, string>;
}

/** The checked-out template, or (when it predates the __API_ORIGIN__ token) the verbatim d1/integration copy. */
function loadTemplate(): { text: string; source: string } {
  const repo = fs.readFileSync(
    path.join(REPO_ROOT, 'apps', 'recruiter', '_headers.template'),
    'utf8',
  );
  if (repo.includes('__API_ORIGIN__')) {
    return { text: repo, source: 'apps/recruiter/_headers.template' };
  }
  const fixture = 'recruiter-headers.d1-integration.template';
  return {
    text: fs.readFileSync(path.join(SPIKE_DIR, 'browser', 'site', fixture), 'utf8'),
    source: `docs/spikes/d1-day-one/browser/site/${fixture}`,
  };
}

export const TEMPLATE_SOURCE = loadTemplate().source;

/**
 * The recruiter's real header template, filled the way the Vite headers-template plugin fills it: the Supabase
 * token gets a synthetic https origin, the unset Sentry token is dropped, and the __API_ORIGIN__ token (the api
 * Worker origin, which serves /media/:jti) gets the media Worker's origin.
 *  - strict:      the template as planned for D1: the media origin only in connect-src (through __API_ORIGIN__)
 *  - img-allowed: strict + the Worker origin in img-src as well (only to demonstrate the tainted-canvas case)
 *  - unmodified:  the template with the api token dropped (no media origin anywhere)
 */
export function recruiterHeaders(variant: CspVariant): SiteHeaders {
  const tpl = loadTemplate().text;
  const headers: Record<string, string> = {};
  for (const line of tpl.split(/\r?\n/)) {
    const m = /^\s+([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m && m[1] && m[2] !== undefined) headers[m[1]] = m[2].trim();
  }
  let csp = headers['Content-Security-Policy'];
  if (!csp) throw new Error('no Content-Security-Policy in the recruiter header template');
  delete headers['Content-Security-Policy'];
  csp = csp
    .replace('__SUPABASE_ORIGIN__', SYNTHETIC_SUPABASE_ORIGIN)
    .replace('__API_ORIGIN__', variant === 'unmodified' ? '' : WORKER_ORIGIN)
    .replace('__SENTRY_ORIGIN__', '')
    .replace(/[ ]+;/g, ';')
    .replace(/[ ]{2,}/g, ' ');
  if (variant === 'img-allowed') {
    csp = csp.replace(/(img-src [^;]*)/, `$1 ${WORKER_ORIGIN}`);
  }
  return { csp, others: headers };
}

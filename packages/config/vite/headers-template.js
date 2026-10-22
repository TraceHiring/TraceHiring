// Vite plugin: writes dist/_headers (Cloudflare Pages format) from the app's _headers.template
// (specs/m0b-tenancy.md §2.7). The template's connect-src holds the token __SUPABASE_ORIGIN__ exactly
// once; it becomes the origin of VITE_SUPABASE_URL, which must be https://<20 lowercase alnum>.supabase.co,
// or is dropped when the variable is unset, so local and CI builds keep connect-src 'self'. Any other
// value fails the build without echoing it. It lives here, not in vite.config.ts, because a config
// file may not touch fs (the trace/vite-config-env rule). check-headers checks the emitted file.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SUPABASE_ORIGIN_TOKEN = '__SUPABASE_ORIGIN__';

const SUPABASE_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;

/**
 * The Supabase origin for connect-src, or null when the variable is unset or empty.
 * @param {unknown} value
 * @returns {string | null}
 */
function supabaseOrigin(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !SUPABASE_URL.test(value)) {
    throw new Error(
      'VITE_SUPABASE_URL must be https://<20 lowercase letters or digits>.supabase.co (value not shown)',
    );
  }
  return value.replace(/\/$/, '');
}

const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;

/**
 * The recruiter bundle inlines VITE_SUPABASE_PUBLISHABLE_KEY, so anything but a publishable key
 * (a secret key, a service-role JWT) fails the build here, before scan-dist (B4-SEC-3, H10).
 * @param {unknown} value
 */
function checkPublishableKey(value) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || !PUBLISHABLE_KEY.test(value)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY must be an sb_publishable_ key (value not shown)',
    );
  }
}

/**
 * The `_headers` text for one build.
 * @param {string} template
 * @param {unknown} supabaseUrl
 * @returns {string}
 */
export function renderHeaders(template, supabaseUrl) {
  const origin = supabaseOrigin(supabaseUrl);
  if (template.split(SUPABASE_ORIGIN_TOKEN).length !== 2) {
    throw new Error(`_headers.template must contain ${SUPABASE_ORIGIN_TOKEN} exactly once`);
  }
  return origin === null
    ? template.replace(` ${SUPABASE_ORIGIN_TOKEN}`, '').replace(SUPABASE_ORIGIN_TOKEN, '')
    : template.replace(SUPABASE_ORIGIN_TOKEN, origin);
}

/**
 * @param {{ template?: string }} [options] the template path, relative to the Vite root
 */
export function headersTemplatePlugin(options = {}) {
  const templateName = options.template ?? '_headers.template';
  let root = '';
  /** @type {unknown} */
  let supabaseUrl;
  return {
    name: /** @type {const} */ ('trace:headers-template'),
    /** @param {{ root: string, env: Record<string, unknown> }} config */
    configResolved(config) {
      root = config.root;
      supabaseUrl = config.env['VITE_SUPABASE_URL'];
      supabaseOrigin(supabaseUrl);
      checkPublishableKey(config.env['VITE_SUPABASE_PUBLISHABLE_KEY']);
    },
    /** @this {{ emitFile(file: { type: 'asset', fileName: string, source: string }): unknown }} */
    generateBundle() {
      const template = readFileSync(path.resolve(root, templateName), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: renderHeaders(template, supabaseUrl),
      });
    },
  };
}

export default headersTemplatePlugin;

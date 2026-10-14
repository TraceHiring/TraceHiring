// Vite plugin: writes dist/_headers (Cloudflare Pages format) from the app's _headers.template
// (specs/m0b-tenancy.md §2.7). The template's connect-src holds the token __SUPABASE_ORIGIN__ exactly
// once; it becomes the origin of VITE_SUPABASE_URL, which must be https://<20 lowercase alnum>.supabase.co,
// or is dropped when the variable is unset, so local and CI builds keep connect-src 'self'. Any other
// value fails the build without echoing it. It lives here, not in vite.config.ts, because a config
// file may not touch fs (the trace/vite-config-env rule). check-headers checks the emitted file.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SUPABASE_ORIGIN_TOKEN = '__SUPABASE_ORIGIN__';
/** d1 AT-D22 / L-24: the Sentry ingest origin of VITE_SENTRY_DSN, in the recruiter's connect-src. */
export const SENTRY_ORIGIN_TOKEN = '__SENTRY_ORIGIN__';

/** A Sentry DSN on an ingest host: https, a 32-hex public key, o<n>.ingest[.<region>].sentry.io, a project id. */
const SENTRY_DSN = /^https:\/\/[0-9a-f]{32}@(o[0-9]+\.ingest(?:\.[a-z]{2})?\.sentry\.io)\/[0-9]+$/;

/**
 * The ingest origin of the DSN (never its key or project), or null when the variable is unset or empty.
 * @param {unknown} value
 * @returns {string | null}
 */
function sentryOrigin(value) {
  if (value === undefined || value === null || value === '') return null;
  const m = typeof value === 'string' ? SENTRY_DSN.exec(value) : null;
  if (m === null) {
    throw new Error(
      'VITE_SENTRY_DSN must be a Sentry DSN on an o<n>.ingest[.<region>].sentry.io host (value not shown)',
    );
  }
  return `https://${m[1]}`;
}

/**
 * Replaces `token` with `origin`, or drops it (and its leading space) when origin is null.
 * @param {string} text
 * @param {string} token
 * @param {string | null} origin
 */
function fill(text, token, origin) {
  return origin === null
    ? text.replace(` ${token}`, '').replace(token, '')
    : text.replace(token, () => origin);
}

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
 * @param {unknown} [sentryDsn] VITE_SENTRY_DSN; when set, the template must hold the Sentry token exactly once
 * @returns {string}
 */
export function renderHeaders(template, supabaseUrl, sentryDsn) {
  const origin = supabaseOrigin(supabaseUrl);
  const ingest = sentryOrigin(sentryDsn);
  if (template.split(SUPABASE_ORIGIN_TOKEN).length !== 2) {
    throw new Error(`_headers.template must contain ${SUPABASE_ORIGIN_TOKEN} exactly once`);
  }
  const sentryTokens = template.split(SENTRY_ORIGIN_TOKEN).length - 1;
  if (sentryTokens > 1 || (ingest !== null && sentryTokens !== 1)) {
    throw new Error(`_headers.template must contain ${SENTRY_ORIGIN_TOKEN} exactly once`);
  }
  return fill(fill(template, SUPABASE_ORIGIN_TOKEN, origin), SENTRY_ORIGIN_TOKEN, ingest);
}

/**
 * @param {{ template?: string }} [options] the template path, relative to the Vite root
 */
export function headersTemplatePlugin(options = {}) {
  const templateName = options.template ?? '_headers.template';
  let root = '';
  /** @type {unknown} */
  let supabaseUrl;
  /** @type {unknown} */
  let sentryDsn;
  return {
    name: /** @type {const} */ ('trace:headers-template'),
    /** @param {{ root: string, env: Record<string, unknown> }} config */
    configResolved(config) {
      root = config.root;
      supabaseUrl = config.env['VITE_SUPABASE_URL'];
      supabaseOrigin(supabaseUrl);
      sentryDsn = config.env['VITE_SENTRY_DSN'];
      sentryOrigin(sentryDsn);
      checkPublishableKey(config.env['VITE_SUPABASE_PUBLISHABLE_KEY']);
    },
    /** @this {{ emitFile(file: { type: 'asset', fileName: string, source: string }): unknown }} */
    generateBundle() {
      const template = readFileSync(path.resolve(root, templateName), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: renderHeaders(template, supabaseUrl, sentryDsn),
      });
    },
  };
}

export default headersTemplatePlugin;

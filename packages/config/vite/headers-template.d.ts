// Types for the headers-template Vite plugin (./headers-template.js).
// Structural on purpose: @trace/config does not depend on vite, and this shape is assignable to Vite's `Plugin`.

/** The connect-src placeholder in an app's _headers.template. */
export declare const SUPABASE_ORIGIN_TOKEN: '__SUPABASE_ORIGIN__';

/** The connect-src placeholder for the Sentry ingest origin (recruiter, d1 AT-D22). */
export declare const SENTRY_ORIGIN_TOKEN: '__SENTRY_ORIGIN__';

/** The connect-src placeholder for the staging api Worker origin (recruiter, d1 spec §7.1). */
export declare const API_ORIGIN_TOKEN: '__API_ORIGIN__';

/**
 * The `_headers` text: each token replaced by its origin (Supabase URL, Sentry DSN, api origin), or dropped
 * when its variable is unset. A bad value throws without echoing it. `traceEnv` is VITE_TRACE_ENV: only
 * `'dev'` lets the Supabase URL and the api origin be `http://127.0.0.1:<port>` or `http://localhost:<port>`.
 */
export declare function renderHeaders(
  template: string,
  supabaseUrl: unknown,
  sentryDsn?: unknown,
  apiOrigin?: unknown,
  traceEnv?: unknown,
): string;

export interface EmittedAsset {
  type: 'asset';
  fileName: string;
  source: string;
}

export interface HeadersTemplatePlugin {
  name: 'trace:headers-template';
  configResolved(config: { root: string; env: Record<string, unknown> }): void;
  generateBundle(this: { emitFile(file: EmittedAsset): unknown }): void;
}

/** Emits dist/_headers from `<root>/_headers.template` (or `options.template`). */
export declare function headersTemplatePlugin(options?: {
  template?: string;
}): HeadersTemplatePlugin;

export default headersTemplatePlugin;

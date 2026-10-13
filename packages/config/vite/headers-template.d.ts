// Types for the headers-template Vite plugin (./headers-template.js).
// Structural on purpose: @trace/config does not depend on vite, and this shape is assignable to Vite's `Plugin`.

/** The connect-src placeholder in an app's _headers.template. */
export declare const SUPABASE_ORIGIN_TOKEN: '__SUPABASE_ORIGIN__';

/** The `_headers` text: the token replaced by the Supabase origin, or dropped when the URL is unset. */
export declare function renderHeaders(template: string, supabaseUrl: unknown): string;

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

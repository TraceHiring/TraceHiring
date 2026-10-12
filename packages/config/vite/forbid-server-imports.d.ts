// Types for the forbid-server-imports Vite plugin (./forbid-server-imports.js).
// Structural on purpose: @trace/config does not depend on vite, and this shape is assignable to Vite's `Plugin`.

/** Folders (relative to the repo root) whose code must never reach a browser bundle. */
export declare const FORBIDDEN_DIRS: string[];

/** Which forbidden folder or package `id` belongs to, or null. */
export declare function forbiddenReason(id: string, root: string): string | null;

/** Minimal slice of Vite's plugin context that `resolveId` uses. */
export interface ResolveContext {
  resolve(
    source: string,
    importer?: string,
    options?: Record<string, unknown>,
  ): Promise<{ id: string } | null>;
}

export interface ForbidServerImportsPlugin {
  name: 'trace:forbid-server-imports';
  enforce: 'pre';
  resolveId(
    this: ResolveContext,
    source: string,
    importer: string | undefined,
    options: Record<string, unknown>,
  ): Promise<{ id: string } | null>;
  load(id: string): null;
}

/** Fails the build when a module under packages/vendors, packages/config, workers/ or services/ is bundled. */
export declare function forbidServerImports(options?: { root?: string }): ForbidServerImportsPlugin;

export default forbidServerImports;

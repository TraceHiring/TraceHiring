// Types for build-tokens.mjs (the tests import it; the package has no allowJs).

/** A token file: nested groups, numbers, strings and string lists. */
export type TokenNode = string | number | boolean | TokenNode[] | TokenTree;
export interface TokenTree {
  [key: string]: TokenNode;
}

export declare const BASE_FILE: 'docs/design/tokens.json';
export declare const EXTENSIONS_FILE: 'packages/ui/tokens.extensions.json';
export declare const CSS_FILE: 'packages/ui/src/generated/tokens.css';
export declare const TS_FILE: 'packages/ui/src/generated/tokens.ts';

/** Adds the extension tokens to the design tokens; throws if an extension redefines a token. */
export declare function mergeTokens(base: TokenTree, extensions: TokenTree): TokenTree;

/** The generated file contents, and the merged tokens they were built from. Pure. */
export declare function buildTokens(
  base: TokenTree,
  extensions: TokenTree,
): { css: string; ts: string; tokens: TokenTree };

/** Reads the inputs under `root`; returns { [repo-relative path]: file text } for both outputs. */
export declare function generate(root: string): Record<string, string>;

/** One problem per missing or stale committed output under `root`; empty when current. */
export declare function checkGenerated(root: string): string[];

/** Writes both outputs under `root`; returns the repo-relative paths written. */
export declare function writeGenerated(root: string): string[];

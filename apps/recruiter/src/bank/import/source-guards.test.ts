// Source guards for the import stream (ADR-033, R5-48, rules 5 and 8): production code uses fflate's streaming
// Unzip + UnzipInflate and nothing else from it, in one file only; imported values are only ever React text; nothing
// here reads or writes browser storage or talks to the network except through the typed api calls.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORT_IMAGE_MAX_BYTES as SHARED_IMAGE_MAX } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { IMPORT_IMAGE_MAX_BYTES as LIMITS_IMAGE_MAX, IMPORT_LIMITS } from './limits';

const dir = path.dirname(fileURLToPath(import.meta.url));
const isTest = (name: string) => /\.test\.|\.test-helpers\./.test(name);
const production = readdirSync(dir)
  .filter((name) => /\.(?:ts|tsx|css)$/.test(name) && !isTest(name))
  .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('production import code', () => {
  it('has files to scan (the guards below are not vacuous)', () => {
    const names = production.map((f) => f.name);
    for (const expected of ['zip-core.ts', 'import.worker.ts', 'parse.ts', 'ImportRoute.tsx']) {
      expect(names).toContain(expected);
    }
  });

  it('names none of the whole-buffer or callback-style fflate helpers', () => {
    const forbidden =
      /\b(?:unzipSync|inflateSync|decompressSync|gunzipSync|unzlibSync|zipSync|unzip|inflate|decompress|gunzip|unzlib|AsyncUnzipInflate|AsyncInflate|AsyncDecompress|AsyncGunzip|AsyncUnzlib|AsyncZipInflate|Decompress|Inflate|Gunzip|Unzlib)\s*\(/;
    const forbiddenNames =
      /\b(?:unzipSync|inflateSync|decompressSync|gunzipSync|unzlibSync|zipSync|AsyncUnzipInflate|AsyncInflate|AsyncDecompress|AsyncGunzip|AsyncUnzlib|AsyncZipInflate|DecompressionStream)\b/;
    for (const file of production) {
      // template-files.ts (S3) builds the two Trace template files with zipSync; that one name is allowed there and
      // nowhere else. Every other helper stays forbidden in it too.
      const body =
        file.name === 'template-files.ts'
          ? code(file.text).replace(/\bzipSync\b/g, 'ZIPPED')
          : code(file.text);
      expect(body, file.name).not.toMatch(forbidden);
      expect(body, file.name).not.toMatch(forbiddenNames);
    }
  });

  it('imports fflate in zip-core.ts (Unzip, UnzipInflate) and template-files.ts (strToU8, zipSync) only', () => {
    const allowed: Record<string, string[]> = {
      'zip-core.ts': ['Unzip', 'UnzipInflate'],
      'template-files.ts': ['strToU8', 'zipSync'],
    };
    for (const file of production) {
      const imports = [
        ...file.text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'fflate'/g),
      ];
      const bare = /from\s+'fflate[^']*'|import\s+'fflate|require\('fflate|import\('fflate/.test(
        file.text,
      );
      const expected = allowed[file.name];
      if (expected === undefined) {
        expect(bare, file.name).toBe(false);
        continue;
      }
      expect(imports, file.name).toHaveLength(1);
      const names = (imports[0]?.[1] ?? '')
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n !== '')
        .sort();
      expect(names, file.name).toEqual(expected);
    }
  });

  it('keeps the template builder out of the worker: it is the page that makes the template files', () => {
    for (const name of ['zip-core.ts', 'import.worker.ts', 'worker-handler.ts', 'protocol.ts']) {
      expect(production.find((f) => f.name === name)?.text, name).not.toMatch(/template-files/);
    }
    expect(production.map((f) => f.name)).toContain('template-files.ts');
  });

  it('starts the worker from a same-origin module URL, with no blob worker and no eval', () => {
    const client = production.find((f) => f.name === 'worker-client.ts')?.text ?? '';
    expect(client).toContain(
      "new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })",
    );
    for (const file of production) {
      expect(code(file.text), file.name).not.toMatch(/["'`]blob:|\beval\s*\(|new Function\s*\(/);
      // The error list is the one Blob URL (plain-text CSV, revoked at once); a worker never comes from one.
      if (file.name !== 'csv-download.ts') {
        expect(code(file.text), file.name).not.toMatch(/createObjectURL/);
      }
    }
  });

  it('renders every value as React text: no raw HTML, no inline style, no storage, no direct network', () => {
    for (const file of production) {
      const text = code(file.text);
      expect(text, file.name).not.toMatch(
        /dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/,
      );
      expect(text, file.name).not.toMatch(/\bstyle=\{|\sstyle=["']/);
      expect(text, file.name).not.toMatch(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/);
      expect(text, file.name).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
      expect(text, file.name).not.toMatch(/\bconsole\./);
    }
  });

  it('the page parses XML with DOMParser and the worker never does', () => {
    expect(production.find((f) => f.name === 'xml.ts')?.text).toContain('new DOMParser()');
    for (const name of ['zip-core.ts', 'import.worker.ts', 'worker-handler.ts']) {
      expect(production.find((f) => f.name === name)?.text, name).not.toMatch(/DOMParser/);
    }
  });

  it('takes the image cap from the shared contract, not from a literal of its own (S4, R5-55 d)', () => {
    const limits = production.find((f) => f.name === 'limits.ts')?.text ?? '';
    expect(code(limits)).toMatch(
      /import\s*\{\s*IMPORT_IMAGE_MAX_BYTES\s*\}\s*from\s*'@trace\/shared\/contracts\/m1'/,
    );
    expect(code(limits)).toMatch(/export\s*\{\s*IMPORT_IMAGE_MAX_BYTES\s*\}/);
    expect(code(limits)).not.toMatch(/IMPORT_IMAGE_MAX_BYTES\s*=/);
    expect(IMPORT_LIMITS.imageBytes).toBe(SHARED_IMAGE_MAX);
    expect(LIMITS_IMAGE_MAX).toBe(SHARED_IMAGE_MAX);
    expect(SHARED_IMAGE_MAX).toBe(1_048_576);
  });
});

// Raw-source guards for the recruiter app's error wiring (AT-9 recruiter part, spec
// m0-foundations §9.2). error-reporting.test.ts exercises the functions; this file checks the real
// call sites, which no unit test runs: the entry installs global reporting before the first
// render, the route error element reports the error, and nothing else can reach a reporter without
// going through `reportAppError` (serialise, then redact). The sources are read as text, so a call
// that a build would tree-shake still fails here.
import { describe, expect, it } from 'vitest';

const all = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Production sources: everything under src/ except the tests (which name what is forbidden). */
const sources = Object.entries(all).filter(([file]) => !/\.test\.tsx?$/.test(file));

const source = (file: string): string => {
  const text = all[file];
  if (text === undefined) throw new Error(`${file} was not found in the recruiter sources`);
  return text;
};

/** The entry installs the global handlers: a call on `window`, not just an import. */
const INSTALL_CALL = /\binstallGlobalErrorReporting\s*\(\s*window\s*\)/;
/** `createRoot(...)`: the call, not the import specifier. */
const CREATE_ROOT_CALL = /\bcreateRoot\s*\(/;
/** A call to the page-level reporting function. */
const REPORT_APP_ERROR_CALL = /\breportAppError\s*\(/;
/** A direct call to a reporter's `capture`, as a property or as a string key. */
const CAPTURE_CALL = /\.\s*capture\s*\(|\[\s*['"]capture['"]\s*\]/;
/** The shared helpers that only error-reporting.ts may use. */
const SHARED_ERROR_HELPERS = /\b(?:reportError|serializeError)\b/;

/** The text of `export function <name>` up to its closing brace at column 0. */
const functionBody = (text: string, name: string): string => {
  const start = text.search(new RegExp(`function\\s+${name}\\b`));
  if (start < 0) return '';
  const end = text.indexOf('\n}\n', start);
  return end < 0 ? text.slice(start) : text.slice(start, end + 2);
};

/** The sources (file names) in which `pattern` occurs, apart from error-reporting.ts itself. */
const outsideReporting = (pattern: RegExp): string[] =>
  sources
    .filter(([file, text]) => file !== './error-reporting.ts' && pattern.test(text))
    .map(([file]) => file);

describe('recruiter error wiring (AT-9, spec §9.2)', () => {
  it('reads the real sources (the guards cannot pass on an empty glob)', () => {
    expect(sources.map(([file]) => file)).toEqual(
      expect.arrayContaining(['./main.tsx', './App.tsx', './routes.tsx', './error-reporting.ts']),
    );
  });

  it('installs global error reporting on window before the first render', () => {
    const main = source('./main.tsx');
    const install = main.search(INSTALL_CALL);
    const render = main.search(CREATE_ROOT_CALL);
    expect(install, 'installGlobalErrorReporting(window) call').toBeGreaterThanOrEqual(0);
    expect(render, 'createRoot( call').toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(render);
    expect(main).toMatch(
      /import\s*\{[^}]*\binstallGlobalErrorReporting\b[^}]*\}\s*from\s*'\.\/error-reporting'/,
    );
  });

  it('wires the route error element and reports from it', () => {
    expect(source('./routes.tsx')).toMatch(/errorElement:\s*<RouteError\s*\/>/);
    const body = functionBody(source('./App.tsx'), 'RouteError');
    expect(body, 'RouteError was found').not.toBe('');
    expect(body).toMatch(/\buseRouteError\s*\(/);
    expect(body).toMatch(REPORT_APP_ERROR_CALL);
    expect(source('./App.tsx')).toMatch(
      /import\s*\{[^}]*\breportAppError\b[^}]*\}\s*from\s*'\.\/error-reporting'/,
    );
  });

  it('does not render the error object or its message', () => {
    const body = functionBody(source('./App.tsx'), 'RouteError');
    expect(body).not.toMatch(/\{\s*(?:error|err)\b[^}]*\}/);
    expect(body).not.toMatch(/\.message\b|\.stack\b|String\s*\(\s*error/);
  });

  it('calls a reporter nowhere outside error-reporting.ts (no .capture)', () => {
    expect(outsideReporting(CAPTURE_CALL)).toEqual([]);
  });

  it('uses reportError and serializeError nowhere outside error-reporting.ts', () => {
    expect(outsideReporting(SHARED_ERROR_HELPERS)).toEqual([]);
  });

  it('keeps error-reporting.ts as the one place that calls reportError', () => {
    expect(source('./error-reporting.ts')).toMatch(/\breportError\s*\(\s*reporter\b/);
    expect(source('./error-reporting.ts')).not.toMatch(CAPTURE_CALL);
  });
});

describe('guard patterns (negative controls)', () => {
  it('INSTALL_CALL needs a call on window, not a mention', () => {
    expect(INSTALL_CALL.test('installGlobalErrorReporting(window);')).toBe(true);
    expect(INSTALL_CALL.test('installGlobalErrorReporting( window )')).toBe(true);
    for (const bad of [
      "import { installGlobalErrorReporting } from './error-reporting';",
      'installGlobalErrorReporting(globalThis);',
      '// installGlobalErrorReporting',
      'installGlobalErrorReporting()',
    ])
      expect(INSTALL_CALL.test(bad), bad).toBe(false);
  });

  it('CREATE_ROOT_CALL matches the call and not the import', () => {
    expect(CREATE_ROOT_CALL.test('createRoot(container).render(x)')).toBe(true);
    expect(CREATE_ROOT_CALL.test("import { createRoot } from 'react-dom/client';")).toBe(false);
  });

  it('REPORT_APP_ERROR_CALL matches a call, not an import', () => {
    expect(REPORT_APP_ERROR_CALL.test('reportAppError(error);')).toBe(true);
    expect(REPORT_APP_ERROR_CALL.test("import { reportAppError } from './error-reporting';")).toBe(
      false,
    );
  });

  it('the ordering check fails when the install comes after the render', () => {
    const bad = 'createRoot(c).render(x);\ninstallGlobalErrorReporting(window);';
    expect(bad.search(INSTALL_CALL)).toBeGreaterThan(bad.search(CREATE_ROOT_CALL));
  });

  it('CAPTURE_CALL flags direct reporter calls', () => {
    for (const bad of [
      'reporter.capture(serialized)',
      'errorReporter .capture (x, ctx)',
      "reporter['capture'](x)",
      'a?.capture(x)',
    ])
      expect(CAPTURE_CALL.test(bad), bad).toBe(true);
    for (const ok of ['reportAppError(error)', 'const captured = 1;', 'capture: true'])
      expect(CAPTURE_CALL.test(ok), ok).toBe(false);
  });

  it('SHARED_ERROR_HELPERS flags the helpers and not reportAppError', () => {
    for (const bad of [
      "import { reportError } from '@trace/shared/log';",
      'serializeError(err)',
      'reportError(reporter, err)',
    ])
      expect(SHARED_ERROR_HELPERS.test(bad), bad).toBe(true);
    for (const ok of ['reportAppError(err)', "import { reportAppError } from './error-reporting'"])
      expect(SHARED_ERROR_HELPERS.test(ok), ok).toBe(false);
  });

  it('functionBody finds a function and its end', () => {
    const text =
      'export function A() {\n  return 1;\n}\n\nexport function B() {\n  reportAppError(x);\n}\n';
    expect(functionBody(text, 'B')).toMatch(REPORT_APP_ERROR_CALL);
    expect(functionBody(text, 'A')).not.toMatch(REPORT_APP_ERROR_CALL);
    expect(functionBody(text, 'Missing')).toBe('');
  });

  it('outsideReporting would list a bad file (the filter is not vacuous)', () => {
    const fake: [string, string][] = [
      ['./error-reporting.ts', 'reportError(reporter, err)'],
      ['./bad.ts', 'reportError(reporter, err)'],
    ];
    const hits = fake
      .filter(([file, text]) => file !== './error-reporting.ts' && SHARED_ERROR_HELPERS.test(text))
      .map(([file]) => file);
    expect(hits).toEqual(['./bad.ts']);
  });
});

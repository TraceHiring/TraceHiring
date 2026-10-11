// AT-20 (spec m0-foundations §13): the token files are current, every token is present, and
// `build-tokens.mjs --check` passes on the committed files and fails on a changed one.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASE_FILE,
  CSS_FILE,
  EXTENSIONS_FILE,
  TS_FILE,
  buildTokens,
  generate,
  mergeTokens,
  type TokenTree,
} from '../scripts/build-tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = path.join(ROOT, 'packages', 'ui', 'scripts', 'build-tokens.mjs');

const readJson = (file: string): TokenTree =>
  JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) as TokenTree;
const readText = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

const base = readJson(BASE_FILE);
const extensions = readJson(EXTENSIONS_FILE);

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** `--name: value;` lines of the generated stylesheet, in order. */
const declarations = (css: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const line of css.split('\n')) {
    const m = /^ {2}(--[a-z0-9-]+): (.+);$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      expect(map.has(m[1]), `duplicate ${m[1]}`).toBe(false);
      map.set(m[1], m[2]);
    }
  }
  return map;
};

/**
 * The variables spec §11 and plan Q5 call for, derived from the merged token tree independently
 * of the generator.
 */
function expectedVariables(tree: TokenTree): Map<string, string> {
  const out = new Map<string, string>();
  const color = tree['color'] as TokenTree;
  const walk = (node: TokenTree, trail: string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string')
        out.set(`--color-${[...trail, key].map(kebab).join('-')}`, value);
      else walk(value as TokenTree, [...trail, key]);
    }
  };
  walk(color, []);
  for (const [k, v] of Object.entries(tree['space'] as Record<string, number>))
    out.set(`--space-${k}`, `${v}px`);
  for (const [k, v] of Object.entries(tree['radius'] as Record<string, number>))
    out.set(`--radius-${k}`, `${v}px`);
  for (const k of Object.keys(tree['font'] as Record<string, string>)) out.set(`--font-${k}`, '*');
  const type = tree['type'] as Record<string, Record<string, string | number>>;
  for (const [name, style] of Object.entries(type)) {
    for (const [prop, v] of Object.entries(style)) {
      const variable = `--type-${kebab(name)}-${kebab(prop)}`;
      if (prop === 'family') out.set(variable, `var(--font-${String(v)})`);
      else if (prop === 'weight' || prop === 'textTransform') out.set(variable, String(v));
      else out.set(variable, `${String(v)}px`);
    }
  }
  const component = tree['component'] as TokenTree;
  const walkComponent = (node: TokenTree, trail: string[]): void => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'number')
        out.set(`--component-${[...trail, key].map(kebab).join('-')}`, `${value}px`);
      else if (value !== null && typeof value === 'object' && !Array.isArray(value))
        walkComponent(value as TokenTree, [...trail, key]);
      // strings and arrays (radius: "md", variants, rule) are not numeric: no variable (plan Q5)
    }
  };
  walkComponent(component, []);
  return out;
}

describe('build-tokens (AT-20): committed files are current', () => {
  const merged = mergeTokens(base, extensions);
  const built = buildTokens(base, extensions);

  it('the committed tokens.css is byte-identical to the generator output', () => {
    expect(readText(CSS_FILE)).toBe(built.css);
  });

  it('the committed tokens.ts is byte-identical to the generator output', () => {
    expect(readText(TS_FILE)).toBe(built.ts);
  });

  it('generate() returns exactly the two committed files', () => {
    const files = generate(ROOT);
    expect(Object.keys(files).sort()).toEqual([CSS_FILE, TS_FILE].sort());
    expect(files[CSS_FILE]).toBe(readText(CSS_FILE));
    expect(files[TS_FILE]).toBe(readText(TS_FILE));
  });

  it('is deterministic: same inputs, same bytes', () => {
    expect(buildTokens(base, extensions)).toEqual(built);
    expect(buildTokens(structuredClone(base), structuredClone(extensions))).toEqual(built);
  });

  it('uses LF endings, ends with one newline and carries no timestamp or path', () => {
    for (const text of [built.css, built.ts]) {
      expect(text).not.toContain('\r');
      expect(text.endsWith('\n')).toBe(true);
      expect(text.endsWith('\n\n')).toBe(false);
      expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
      expect(text).not.toMatch(/[A-Za-z]:[\\/]|\/Users\//);
    }
  });

  it('has every token as a custom property, and no other', () => {
    const got = declarations(built.css);
    const want = expectedVariables(merged);
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [name, value] of want) {
      if (value === '*') expect(got.get(name), name).toMatch(/^"IBM Plex (Sans|Mono)", /);
      else expect(got.get(name), name).toBe(value);
    }
  });

  it('spells out the examples in spec §11', () => {
    const got = declarations(built.css);
    expect(got.get('--color-bg-canvas')).toBe('#F6F6F3');
    expect(got.get('--space-16')).toBe('16px');
    expect(got.get('--radius-md')).toBe('8px');
    expect(got.get('--type-body-size')).toBe('14px');
  });

  it('adds the D4 extensions: color.border.input and color.focus.ring', () => {
    const got = declarations(built.css);
    expect(got.get('--color-border-input')).toBe('#8A8F98');
    expect(got.get('--color-focus-ring')).toBe(got.get('--color-accent-default'));
  });

  it('turns only numeric component tokens into variables (plan Q5)', () => {
    const got = declarations(built.css);
    const component = [...got.keys()].filter((k) => k.startsWith('--component-'));
    expect(component.sort()).toEqual(
      [
        '--component-button-min-height',
        '--component-button-padding-x',
        '--component-band-pill-padding-x',
        '--component-band-pill-padding-y',
        '--component-touch-target-min',
      ].sort(),
    );
    expect(got.get('--component-touch-target-min')).toBe('44px');
    expect(built.css).not.toMatch(/variants|rule|pill-radius|button-radius/);
  });

  it('exports the Band type and the merged tokens in tokens.ts', () => {
    expect(built.ts).toContain(
      "export type Band = 'clear' | 'review' | 'concern' | 'insufficient';",
    );
    expect(built.ts).toContain('export const tokens = ');
    expect(built.ts).toContain('as const;');
    expect(built.ts).toContain('#8A8F98');
  });
});

describe('build-tokens: inputs are validated', () => {
  it('refuses an extension that redefines a design token', () => {
    const clash = { color: { bg: { canvas: '#000000' } } };
    expect(() => mergeTokens(base, clash)).toThrow(/color\.bg\.canvas/);
  });

  it('refuses an extension that changes a group into a token or back', () => {
    expect(() => mergeTokens(base, { color: { bg: '#000000' } })).toThrow(/color\.bg/);
    expect(() => mergeTokens(base, { space: { 4: { a: 1 } } })).toThrow(/space\.4/);
  });

  it('refuses a colour that is not a 6-digit hex value', () => {
    for (const bad of ['red', '#FFF', '#12345G', 'url(x)', '#FFFFFF;}', 7]) {
      const tree = structuredClone(base);
      (tree['color'] as TokenTree)['bg'] = { canvas: bad } as unknown as TokenTree;
      expect(() => buildTokens(tree, {}), String(bad)).toThrow();
    }
  });

  it('refuses a missing section and a non-finite number', () => {
    const noSpace = structuredClone(base);
    delete noSpace['space'];
    expect(() => buildTokens(noSpace, {})).toThrow(/space/);
    const bad = structuredClone(base);
    (bad['space'] as TokenTree)['4'] = Number.NaN;
    expect(() => buildTokens(bad, {})).toThrow(/space\.4/);
  });

  it('refuses a type style that references an unknown font', () => {
    const bad = structuredClone(base);
    ((bad['type'] as TokenTree)['body'] as TokenTree)['family'] = 'serif';
    expect(() => buildTokens(bad, {})).toThrow(/serif/);
  });

  it('ignores $-prefixed documentation keys', () => {
    const css = buildTokens(base, extensions).css;
    expect(css).not.toContain('schema');
  });
});

/** Characters that would end a declaration, a rule or a string, or open a comment or a url(). */
const INJECTIONS = [';', '}', '"', '/*', 'url(', '\n', 'x"; } body{color:red', 'a;b', 'a}b'];

describe('build-tokens: CSS-injection guards (S2-1)', () => {
  type Mutate = (tree: TokenTree) => void;
  const section = (tree: TokenTree, name: string): TokenTree => tree[name] as TokenTree;
  /** buildTokens on a copy of the design tokens after `mutate`. */
  const build = (mutate: Mutate) => {
    const tree = structuredClone(base);
    mutate(tree);
    return buildTokens(tree, {});
  };
  const expectRefused = (mutate: Mutate, label: string): void => {
    expect(() => build(mutate), label).toThrow();
  };

  it('accepts the unmodified tokens and a value at the MAX_PX boundary', () => {
    expect(() => build(() => undefined)).not.toThrow();
    const css = build((t) => {
      section(t, 'space')['4'] = 10_000;
    }).css;
    expect(css).toContain('--space-4: 10000px;');
  });

  it('refuses out-of-range and non-number lengths everywhere px() is used (MAX_PX)', () => {
    const targets: [string, Mutate][] = [
      ['space.4', (t) => void (section(t, 'space')['4'] = 1e6)],
      ['space.4 just over', (t) => void (section(t, 'space')['4'] = 10_001)],
      ['space.4 negative', (t) => void (section(t, 'space')['4'] = -1e6)],
      ['space.4 infinite', (t) => void (section(t, 'space')['4'] = Number.POSITIVE_INFINITY)],
      ['radius.md', (t) => void (section(t, 'radius')['md'] = 1e6)],
      ['type.body.size', (t) => void (section(section(t, 'type'), 'body')['size'] = 1e6)],
      [
        'type.body.lineHeight',
        (t) => void (section(section(t, 'type'), 'body')['lineHeight'] = 1e6),
      ],
      [
        'type.display.letterSpacing',
        (t) => void (section(section(t, 'type'), 'display')['letterSpacing'] = -1e6),
      ],
      [
        'component.touchTarget.min',
        (t) => void (section(section(t, 'component'), 'touchTarget')['min'] = 1e6),
      ],
    ];
    for (const [label, mutate] of targets) expectRefused(mutate, label);
    for (const text of ['4px;}', '1e6', 'url(x)', '4px']) {
      expectRefused((t) => void (section(t, 'space')['4'] = text as unknown as number), text);
      expectRefused((t) => void (section(t, 'radius')['md'] = text as unknown as number), text);
    }
  });

  it('refuses an injected colour token name (color KEY guard)', () => {
    for (const name of [...INJECTIONS, '1a', 'a-b', 'a b', '', 'a.b']) {
      expectRefused(
        (t) => void (section(section(t, 'color'), 'bg')[name] = '#000000'),
        JSON.stringify(name),
      );
      expectRefused((t) => void (section(t, 'color')[name] = { x: '#000000' }), name);
    }
  });

  it('refuses an injected component token name (component KEY guard)', () => {
    for (const name of [...INJECTIONS, '1a', 'a-b', 'a b', '']) {
      expectRefused(
        (t) => void (section(section(t, 'component'), 'touchTarget')[name] = 5),
        JSON.stringify(name),
      );
      expectRefused((t) => void (section(t, 'component')[name] = { min: 5 }), name);
    }
  });

  it('refuses a space token that is not named by a whole number (space key guard)', () => {
    for (const name of [...INJECTIONS.map((s) => `4${s}`), 'a', '-1', '4.5', '', '4 ', 'x4']) {
      expectRefused((t) => void (section(t, 'space')[name] = 4), JSON.stringify(name));
    }
  });

  it('refuses an injected radius token name (radius KEY guard)', () => {
    for (const name of [...INJECTIONS, '1a', 'a-b', 'a b', '']) {
      expectRefused((t) => void (section(t, 'radius')[name] = 4), JSON.stringify(name));
    }
  });

  it('refuses a font family that is not a plain name (font family guard)', () => {
    const families = [...INJECTIONS, 'a\\b', "a'b", '1Plex', ' Plex', '', 'Plex<', 'a:b'];
    for (const family of families) {
      expectRefused((t) => void (section(t, 'font')['sans'] = family), JSON.stringify(family));
      expectRefused((t) => void (section(t, 'font')['mono'] = family), JSON.stringify(family));
    }
    expectRefused((t) => void (section(t, 'font')['sans'] = 5 as unknown as string), 'number');
    expectRefused(
      (t) => void (section(t, 'font')['serif'] = 'Plex Serif'),
      'font without a fallback stack',
    );
    expectRefused((t) => void (section(t, 'font')['a;b'] = 'Plex'), 'font key injection');
  });

  it('refuses an injected type style name (type KEY guard)', () => {
    for (const name of [...INJECTIONS, '1a', 'a-b', 'a b', '']) {
      expectRefused((t) => {
        section(t, 'type')[name] = structuredClone(section(section(t, 'type'), 'body'));
      }, JSON.stringify(name));
    }
    expectRefused((t) => void (section(t, 'type')['broken'] = 'body'), 'style that is not a group');
  });

  it('refuses a text-transform outside the allow-list (textTransform guard)', () => {
    const style = (t: TokenTree): TokenTree => section(section(t, 'type'), 'overline');
    const bad = [...INJECTIONS, 'uppercase;', 'Uppercase', ' none', 'inherit', 'none\n', ''];
    for (const value of bad) {
      expectRefused((t) => void (style(t)['textTransform'] = value), JSON.stringify(value));
    }
    expectRefused((t) => void (style(t)['textTransform'] = 7 as unknown as string), 'number');
    for (const ok of ['none', 'uppercase', 'lowercase', 'capitalize']) {
      const tree = structuredClone(base);
      style(tree)['textTransform'] = ok;
      expect(buildTokens(tree, {}).css).toContain(`--type-overline-text-transform: ${ok};`);
    }
  });

  it('the committed stylesheet carries no injection-shaped text', () => {
    const css = buildTokens(base, extensions).css;
    expect(css).not.toMatch(/url\(|@import|expression\(|<|\\/);
    expect(css.match(/\/\*/g)?.length).toBe(css.match(/\*\//g)?.length);
  });
});

describe('build-tokens --check (CLI)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A throwaway repo root holding copies of the inputs and the committed outputs. */
  function tempRoot(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'trace-tokens-'));
    dirs.push(dir);
    for (const file of [BASE_FILE, EXTENSIONS_FILE, CSS_FILE, TS_FILE]) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      cpSync(path.join(ROOT, file), path.join(dir, file));
    }
    return dir;
  }
  const run = (args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('passes on the committed files of this repository', () => {
    const r = run(['--check']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it('passes on a copy, and writing then checking passes too', () => {
    const dir = tempRoot();
    expect(run(['--check', dir]).status).toBe(0);
    writeFileSync(path.join(dir, CSS_FILE), 'stale\n');
    expect(run(['--check', dir]).status).toBe(1);
    expect(run([dir]).status).toBe(0);
    expect(run(['--check', dir]).status).toBe(0);
    expect(readFileSync(path.join(dir, CSS_FILE), 'utf8')).toBe(buildTokens(base, extensions).css);
  });

  it('fails when the committed css differs by one byte', () => {
    const dir = tempRoot();
    const file = path.join(dir, CSS_FILE);
    writeFileSync(file, readFileSync(file, 'utf8').replace('#F6F6F3', '#F6F6F4'));
    const r = run(['--check', dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(CSS_FILE);
  });

  it('fails when tokens.ts differs, and when a generated file is missing', () => {
    const dir = tempRoot();
    const file = path.join(dir, TS_FILE);
    writeFileSync(file, `${readFileSync(file, 'utf8')}// edited\n`);
    const r = run(['--check', dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(TS_FILE);
    rmSync(path.join(dir, CSS_FILE));
    expect(run(['--check', dir]).status).toBe(1);
  });

  it('fails when a design token changes and the files were not regenerated', () => {
    const dir = tempRoot();
    const file = path.join(dir, BASE_FILE);
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('"surface": "#FFFFFF"', '"surface": "#FEFEFE"'),
    );
    expect(run(['--check', dir]).status).toBe(1);
  });

  it('fails (and writes nothing) on an invalid token file', () => {
    const dir = tempRoot();
    const tokens = path.join(dir, BASE_FILE);
    writeFileSync(tokens, readFileSync(tokens, 'utf8').replace('#F6F6F3', 'not-a-colour'));
    const before = readFileSync(path.join(dir, CSS_FILE), 'utf8');
    expect(run([dir]).status).toBe(1);
    expect(readFileSync(path.join(dir, CSS_FILE), 'utf8')).toBe(before);
    expect(run(['--check', dir]).status).toBe(1);
  });
});

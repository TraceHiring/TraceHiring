#!/usr/bin/env node
// Design tokens pipeline (spec specs/m0-foundations.md §11, AT-20).
// Reads docs/design/tokens.json plus packages/ui/tokens.extensions.json (pending design sign-off,
// D4) and writes two committed files under packages/ui/src/generated/:
//   tokens.css  CSS custom properties on :root (--color-bg-canvas, --space-16, --type-body-size, …)
//   tokens.ts   the merged tokens as a const object, and `type Band`
// Usage: node packages/ui/scripts/build-tokens.mjs [--check] [repo-root]
//   (default)  validate, then write both files. Nothing is written if validation fails.
//   --check    write nothing; exit 1 if a file is missing or differs byte for byte from the output.
// The output is deterministic (no timestamps or paths; key order follows the input files) and ends
// with a single LF. Both input files are checked: an unknown section, a colour that is not a
// 6-digit hex value, a non-finite number or an extension that redefines a design token is an error,
// so a token can never be dropped or half-emitted silently.
// Plan Q5: the `component` section becomes variables for its numeric values only; strings and
// arrays there (radius: "md", variants, rule) are design notes and have no variable.
// No environment variables.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE_FILE = 'docs/design/tokens.json';
export const EXTENSIONS_FILE = 'packages/ui/tokens.extensions.json';
export const CSS_FILE = 'packages/ui/src/generated/tokens.css';
export const TS_FILE = 'packages/ui/src/generated/tokens.ts';

/** Fallback stacks behind the self-hosted families (fonts arrive in M3b; M0a is a stack only, §11). */
const FONT_STACKS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};
const SECTIONS = ['color', 'space', 'radius', 'font', 'type', 'component'];
const TYPE_PROPS = ['family', 'weight', 'size', 'lineHeight', 'letterSpacing', 'textTransform'];
const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'];
const HEX = /^#[0-9A-Fa-f]{6}$/;
const KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const MAX_PX = 10_000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** `$schema`-style keys are documentation, never tokens. */
const isDoc = (key) => key.startsWith('$');
/** onMedia → on-media, lineHeight → line-height, scoreXL → score-xl. */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Copies a token tree without its `$` documentation keys. */
function stripDocs(node) {
  if (!isObject(node)) return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !isDoc(key))
      .map(([key, value]) => [key, stripDocs(value)]),
  );
}

/**
 * Adds the extension tokens to the design tokens. An extension may add a token or a group, never
 * redefine a token or turn a group into a token (or back).
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} extensions
 */
export function mergeTokens(base, extensions) {
  const merge = (into, from, trail) => {
    for (const [key, value] of Object.entries(from)) {
      if (isDoc(key)) continue;
      const where = [...trail, key].join('.');
      if (!Object.hasOwn(into, key)) {
        into[key] = stripDocs(structuredClone(value));
      } else if (isObject(into[key]) && isObject(value)) {
        merge(into[key], value, [...trail, key]);
      } else if (isObject(into[key]) !== isObject(value)) {
        throw new Error(`extension ${where} turns a group into a token, or a token into a group`);
      } else {
        throw new Error(`extension ${where} redefines a design token`);
      }
    }
    return into;
  };
  return merge(stripDocs(structuredClone(base)), extensions, []);
}

/** A px length from a finite number. */
function px(value, where) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_PX)
    throw new Error(`${where} must be a finite number (found ${JSON.stringify(value)})`);
  return `${value}px`;
}

/** Declarations for one colour group, recursively: [name, value][]. */
function colorDeclarations(node, trail, out) {
  if (!isObject(node) || Object.keys(node).length === 0)
    throw new Error(`${trail.join('.')} must be a non-empty group`);
  for (const [key, value] of Object.entries(node)) {
    const where = [...trail, key].join('.');
    if (!KEY.test(key)) throw new Error(`${where}: invalid token name`);
    if (isObject(value)) colorDeclarations(value, [...trail, key], out);
    else if (typeof value === 'string' && HEX.test(value))
      out.push([`--${[...trail, key].map(kebab).join('-')}`, value]);
    else throw new Error(`${where} must be a 6-digit hex colour (found ${JSON.stringify(value)})`);
  }
}

/** Declarations for the numeric leaves of the component section (plan Q5). */
function componentDeclarations(node, trail, out) {
  for (const [key, value] of Object.entries(node)) {
    const where = [...trail, key].join('.');
    if (!KEY.test(key)) throw new Error(`${where}: invalid token name`);
    if (typeof value === 'number')
      out.push([`--${[...trail, key].map(kebab).join('-')}`, px(value, where)]);
    else if (isObject(value)) componentDeclarations(value, [...trail, key], out);
    // strings, arrays and booleans are design notes, not numeric tokens: no variable
  }
}

/**
 * Validates the merged tokens and lists the CSS declarations by section, in order.
 * @returns {{ section: string, declarations: [string, string][] }[]}
 */
function declarationsOf(tokens) {
  for (const section of Object.keys(tokens))
    if (!SECTIONS.includes(section)) throw new Error(`unknown token section "${section}"`);
  for (const section of SECTIONS)
    if (!isObject(tokens[section])) throw new Error(`token section "${section}" is missing`);

  const color = [];
  colorDeclarations(tokens.color, ['color'], color);

  const space = Object.entries(tokens.space).map(([key, value]) => {
    if (!/^[0-9]+$/.test(key)) throw new Error(`space.${key}: space tokens are named by number`);
    return [`--space-${key}`, px(value, `space.${key}`)];
  });

  const radius = Object.entries(tokens.radius).map(([key, value]) => {
    if (!KEY.test(key)) throw new Error(`radius.${key}: invalid token name`);
    return [`--radius-${kebab(key)}`, px(value, `radius.${key}`)];
  });

  const families = Object.keys(tokens.font);
  const font = Object.entries(tokens.font).map(([key, family]) => {
    if (!Object.hasOwn(FONT_STACKS, key))
      throw new Error(`font.${key} has no fallback stack in build-tokens.mjs`);
    if (typeof family !== 'string' || !/^[A-Za-z][A-Za-z0-9 ]*$/.test(family))
      throw new Error(`font.${key} must be a plain family name`);
    return [`--font-${key}`, `"${family}", ${FONT_STACKS[key]}`];
  });

  const type = [];
  for (const [name, style] of Object.entries(tokens.type)) {
    const where = `type.${name}`;
    if (!KEY.test(name) || !isObject(style)) throw new Error(`${where}: invalid type style`);
    for (const prop of Object.keys(style))
      if (!TYPE_PROPS.includes(prop)) throw new Error(`${where}.${prop}: unknown type property`);
    for (const required of ['family', 'weight', 'size', 'lineHeight'])
      if (!Object.hasOwn(style, required)) throw new Error(`${where}.${required} is missing`);
    const variable = (prop) => `--type-${kebab(name)}-${kebab(prop)}`;
    if (!families.includes(style.family))
      throw new Error(`${where}.family "${String(style.family)}" is not a font token`);
    type.push([variable('family'), `var(--font-${style.family})`]);
    if (!Number.isInteger(style.weight) || style.weight < 100 || style.weight > 900)
      throw new Error(`${where}.weight must be a whole number from 100 to 900`);
    type.push([variable('weight'), String(style.weight)]);
    type.push([variable('size'), px(style.size, `${where}.size`)]);
    type.push([variable('lineHeight'), px(style.lineHeight, `${where}.lineHeight`)]);
    if (Object.hasOwn(style, 'letterSpacing'))
      type.push([variable('letterSpacing'), px(style.letterSpacing, `${where}.letterSpacing`)]);
    if (Object.hasOwn(style, 'textTransform')) {
      if (!TEXT_TRANSFORMS.includes(style.textTransform))
        throw new Error(`${where}.textTransform must be one of ${TEXT_TRANSFORMS.join(', ')}`);
      type.push([variable('textTransform'), style.textTransform]);
    }
  }

  const component = [];
  componentDeclarations(tokens.component, ['component'], component);

  return [
    { section: 'color', declarations: color },
    { section: 'space', declarations: space },
    { section: 'radius', declarations: radius },
    { section: 'font', declarations: font },
    { section: 'type', declarations: type },
    { section: 'component', declarations: component },
  ];
}

const HEADER = [
  'Generated by packages/ui/scripts/build-tokens.mjs from docs/design/tokens.json and',
  'packages/ui/tokens.extensions.json. Do not edit by hand; run',
  'node packages/ui/scripts/build-tokens.mjs and commit the result.',
];

/**
 * The generated file contents for the given design tokens and extensions. Pure and deterministic.
 * @param {Record<string, unknown>} base docs/design/tokens.json
 * @param {Record<string, unknown>} extensions packages/ui/tokens.extensions.json
 * @returns {{ css: string, ts: string, tokens: Record<string, unknown> }}
 */
export function buildTokens(base, extensions) {
  const tokens = mergeTokens(base, extensions);
  const sections = declarationsOf(tokens);

  const css = [
    `/* ${HEADER.join('\n   ')} */`,
    ':root {',
    sections
      .map(({ section, declarations }) =>
        [`  /* ${section} */`, ...declarations.map(([name, value]) => `  ${name}: ${value};`)].join(
          '\n',
        ),
      )
      .join('\n\n'),
    '}',
    '',
  ].join('\n');

  const bands = Object.keys(tokens.color.band);
  const ts = [
    `// ${HEADER.join('\n// ')}`,
    '',
    `export const tokens = ${JSON.stringify(tokens, null, 2)} as const;`,
    '',
    '/** The four Integrity Signals bands; their colours are tokens.color.band.<band>. */',
    `export type Band = ${bands.map((band) => `'${band}'`).join(' | ')};`,
    '',
  ].join('\n');

  return { css, ts, tokens };
}

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const readJson = (root, file) => {
  const abs = path.join(root, file);
  if (!existsSync(abs)) throw new Error(`${file} is missing`);
  try {
    return JSON.parse(stripBom(readFileSync(abs, 'utf8')));
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
};

/**
 * Reads the inputs under `root` and returns { [repo-relative path]: file text } for both outputs.
 * @param {string} root repository root
 */
export function generate(root) {
  const { css, ts } = buildTokens(readJson(root, BASE_FILE), readJson(root, EXTENSIONS_FILE));
  return { [CSS_FILE]: css, [TS_FILE]: ts };
}

/**
 * Compares the committed outputs under `root` with a fresh build, byte for byte.
 * @returns {string[]} one problem per missing or stale file; empty when current
 */
export function checkGenerated(root) {
  const problems = [];
  for (const [file, text] of Object.entries(generate(root))) {
    const abs = path.join(root, file);
    if (!existsSync(abs)) problems.push(`${file} is missing`);
    else if (!readFileSync(abs).equals(Buffer.from(text, 'utf8')))
      problems.push(`${file} is out of date`);
  }
  return problems;
}

/** Writes both outputs under `root`; returns the files written. */
export function writeGenerated(root) {
  const files = generate(root);
  for (const [file, text] of Object.entries(files)) {
    const abs = path.join(root, file);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
  }
  return Object.keys(files);
}

function isMain() {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const rest = args.filter((a) => a !== '--check');
  const unknown = rest.filter((a) => a.startsWith('--'));
  if (unknown.length > 0 || rest.length > 1) {
    console.error('usage: node packages/ui/scripts/build-tokens.mjs [--check] [repo-root]');
    process.exit(2);
  }
  const root = rest[0]
    ? path.resolve(rest[0])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  try {
    if (check) {
      const problems = checkGenerated(root);
      for (const p of problems) console.error(`build-tokens: ${p}`);
      if (problems.length > 0) {
        console.error('build-tokens: run node packages/ui/scripts/build-tokens.mjs and commit');
        process.exit(1);
      }
      console.log('build-tokens: OK (tokens.css, tokens.ts are current)');
    } else {
      for (const file of writeGenerated(root)) console.log(`build-tokens: wrote ${file}`);
    }
  } catch (error) {
    console.error(`build-tokens: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

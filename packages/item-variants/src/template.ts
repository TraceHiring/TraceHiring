// Stem and option templates (specs/m1-test-authoring.md §6.3): `{{name}}` or `{{name:fmt}}`, fmt = 0-4 (decimals,
// rounded half away from zero) or `%` (the value times 100). Everything else between `{{` and `}}`, and a stray
// `}}`, is a template error. Single braces are plain text.
//   {{x}}    exact: an integer, or a decimal that terminates within 6 places; otherwise the tuple is rejected
//            (the author picks a format rather than seeing a silently rounded value)
//   {{x:2}}  fixed 2 decimals ("0.33"); never "-0.00"
//   {{x:%}}  x times 100 printed exactly as for {{x}}, then "%" ("12.5%")
// A text value (a `choice` param with string values) is inserted as written and takes no format.
// A value too large to scale for printing (the size bound, rational.ts) is RenderRejection `too_large`, never a
// thrown RationalError (review round 1). Rendering charges the work meter per placeholder and per character.
import {
  RationalError,
  mul,
  rational,
  toExactDecimal,
  toFixed,
  type Rational,
} from './rational.js';
import { charge, textUnits } from './work.js';

export type TemplateFormat =
  | { readonly kind: 'plain' }
  | { readonly kind: 'fixed'; readonly places: number }
  | { readonly kind: 'percent' };

export type TemplatePart =
  { readonly text: string } | { readonly name: string; readonly format: TemplateFormat };

export type TemplateValue = Rational | string;

/** A malformed template (a spec error, `bad_param_spec`). */
export class TemplateError extends Error {
  readonly code = 'bad_template' as const;
  readonly at: number;
  constructor(at: number) {
    super(`template: bad_template at ${at}`);
    this.name = 'TemplateError';
    this.at = at;
  }
}

export type RenderRejectCode = 'not_terminating' | 'unknown_name' | 'format_on_text' | 'too_large';

/** The tuple cannot be rendered (for example 1/3 with no format). */
export class RenderRejection extends Error {
  readonly code: RenderRejectCode;
  constructor(code: RenderRejectCode) {
    super(`render: ${code}`);
    this.name = 'RenderRejection';
    this.code = code;
  }
}

const EXACT_PLACES = 6;
const PLACEHOLDER = /\{\{([a-z][a-z0-9_]{0,15})(?::([0-4%]))?\}\}/y;

/** Splits a template into text and placeholders. Throws TemplateError when it is malformed. */
export function parseTemplate(src: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('}}', i)) throw new TemplateError(i);
    if (!src.startsWith('{{', i)) {
      text += src[i]!;
      i += 1;
      continue;
    }
    PLACEHOLDER.lastIndex = i;
    const match = PLACEHOLDER.exec(src);
    if (match === null) throw new TemplateError(i);
    if (text !== '') parts.push({ text });
    text = '';
    const fmt = match[2];
    const format: TemplateFormat =
      fmt === undefined
        ? { kind: 'plain' }
        : fmt === '%'
          ? { kind: 'percent' }
          : { kind: 'fixed', places: Number(fmt) };
    parts.push({ name: match[1]!, format });
    i = PLACEHOLDER.lastIndex;
  }
  if (text !== '') parts.push({ text });
  return parts;
}

/** The names a template uses, sorted and without repeats. */
export function templateNames(parts: readonly TemplatePart[]): string[] {
  const names = new Set<string>();
  for (const part of parts) if ('name' in part) names.add(part.name);
  return [...names].sort();
}

/** The names a template formats (fixed or percent), sorted and without repeats. */
export function formattedNames(parts: readonly TemplatePart[]): string[] {
  const names = new Set<string>();
  for (const part of parts)
    if ('name' in part && part.format.kind !== 'plain') names.add(part.name);
  return [...names].sort();
}

function exact(v: Rational): string {
  const s = toExactDecimal(v, EXACT_PLACES);
  if (s === null) throw new RenderRejection('not_terminating');
  return s;
}

/**
 * Renders a parsed template. `values` is a Map (never a plain object, so no name resolves through a prototype).
 * Throws RenderRejection when the tuple cannot be rendered.
 */
export function renderTemplate(
  parts: readonly TemplatePart[],
  values: ReadonlyMap<string, TemplateValue>,
): string {
  let out = '';
  for (const part of parts) {
    if ('text' in part) {
      charge(textUnits(part.text.length));
      out += part.text;
      continue;
    }
    const v = values.get(part.name);
    if (v === undefined) throw new RenderRejection('unknown_name');
    if (typeof v === 'string') {
      if (part.format.kind !== 'plain') throw new RenderRejection('format_on_text');
      charge(textUnits(v.length));
      out += v;
      continue;
    }
    const s = formatNumber(v, part.format);
    charge(textUnits(s.length));
    out += s;
  }
  return out;
}

function formatNumber(v: Rational, format: TemplateFormat): string {
  try {
    switch (format.kind) {
      case 'plain':
        return exact(v);
      case 'fixed':
        return toFixed(v, format.places);
      case 'percent':
        return `${exact(mul(v, rational(100n)))}%`;
    }
  } catch (error) {
    if (error instanceof RationalError) throw new RenderRejection('too_large');
    throw error;
  }
}

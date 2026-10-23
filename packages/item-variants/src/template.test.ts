// Templates (specs/m1-test-authoring.md §6.3): `{{name}}` or `{{name:fmt}}`, fmt = decimals 0-4 or `%`.
import { describe, expect, it } from 'vitest';
import { parseDecimal, rational } from './rational.js';
import {
  RenderRejection,
  TemplateError,
  parseTemplate,
  renderTemplate,
  templateNames,
  type TemplateValue,
} from './template.js';

const r = (n: number, d = 1) => rational(BigInt(n), BigInt(d));
const values = (entries: Record<string, TemplateValue>) => new Map(Object.entries(entries));
const render = (src: string, entries: Record<string, TemplateValue>) =>
  renderTemplate(parseTemplate(src), values(entries));
const templateCode = (src: string): string => {
  try {
    parseTemplate(src);
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateError);
    return (error as TemplateError).code;
  }
  return 'accepted';
};
const renderCode = (src: string, entries: Record<string, TemplateValue>): string => {
  try {
    render(src, entries);
  } catch (error) {
    expect(error).toBeInstanceOf(RenderRejection);
    return (error as RenderRejection).code;
  }
  return 'accepted';
};

describe('templates', () => {
  it('substitute names and keep the surrounding text', () => {
    expect(render('[synthetic] {{a}} apples and {{b}} pears', { a: r(3), b: r(-2) })).toBe(
      '[synthetic] 3 apples and -2 pears',
    );
    expect(render('{{colour}} box', { colour: 'red' })).toBe('red box');
    expect(render('no placeholders { } here', {})).toBe('no placeholders { } here');
  });

  it('format with 0-4 decimals (half away from zero) or as a percentage', () => {
    expect(render('{{x:2}}', { x: r(1, 3) })).toBe('0.33');
    expect(render('{{x:0}}', { x: r(5, 2) })).toBe('3');
    expect(render('{{x:4}}', { x: r(2, 3) })).toBe('0.6667');
    expect(render('{{x:2}}', { x: r(-1, 1000) })).toBe('0.00');
    expect(render('{{x:%}}', { x: parseDecimal('0.125') })).toBe('12.5%');
    expect(render('{{x:%}}', { x: r(3, 4) })).toBe('75%');
  });

  it('prints an unformatted value exactly, or rejects the tuple when it does not terminate', () => {
    expect(render('{{x}}', { x: r(1, 8) })).toBe('0.125');
    expect(renderCode('{{x}}', { x: r(1, 3) })).toBe('not_terminating');
    expect(renderCode('{{x:%}}', { x: r(1, 3) })).toBe('not_terminating');
    expect(renderCode('{{x}}', {})).toBe('unknown_name');
    expect(renderCode('{{x:2}}', { x: 'red' })).toBe('format_on_text');
  });

  it('a value near the size bound that cannot be scaled is a rejection, never a throw (review round 1)', () => {
    const huge = rational(2n ** 250n + 1n);
    expect(renderCode('{{x:4}}', { x: huge })).toBe('too_large');
    expect(renderCode('{{x:%}}', { x: rational(2n ** 250n + 1n, 2n ** 5n) })).toBe('too_large');
    expect(renderCode('{{x}}', { x: rational(2n ** 250n + 1n, 2n ** 5n) })).toBe('too_large');
  });

  it('treats names found on Object.prototype as ordinary names (lead note, contracts security review)', () => {
    for (const name of ['constructor', 'prototype', 'hasownproperty', 'valueof', 'tostring']) {
      expect(renderCode(`{{${name}}}`, {})).toBe('unknown_name');
      expect(render(`{{${name}}} kg`, { [name]: r(5) })).toBe('5 kg');
    }
  });

  it('lists the names it uses', () => {
    expect(templateNames(parseTemplate('{{a}} + {{b:2}} = {{a}}'))).toEqual(['a', 'b']);
  });

  const BAD = [
    '{{a',
    '{{ a }}',
    '{{A}}',
    '{{a:5}}',
    '{{a:x}}',
    '{{a:}}',
    '{{}}',
    '{{{a}}}',
    'a }} b',
    '{{abcdefghijklmnopq}}',
  ];
  it.each(BAD)('refuses %j', (src) => {
    expect(templateCode(src)).toBe('bad_template');
  });
});

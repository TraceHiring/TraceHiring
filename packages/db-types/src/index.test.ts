import { describe, expect, expectTypeOf, it } from 'vitest';
import { Constants, type Database } from './index.js';

describe('@trace/db-types', () => {
  it('exposes only the public schema (spec §8.1: exposed schemas = public)', () => {
    expect(Object.keys(Constants)).toEqual(['public']);
    expectTypeOf<keyof Database>().toEqualTypeOf<'public'>();
  });

  it('has no tables, views or functions in M0a (the baseline migration creates none)', () => {
    expectTypeOf<keyof Database['public']['Tables']>().toEqualTypeOf<never>();
    expectTypeOf<keyof Database['public']['Views']>().toEqualTypeOf<never>();
    expectTypeOf<keyof Database['public']['Functions']>().toEqualTypeOf<never>();
  });
});

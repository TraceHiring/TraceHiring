// The M1 screen registry for tests/m1-guards.test.tsx (AT-M1-24). A stream that builds M1 screens adds one file next
// to them, `<dir>/m1-screens.test-helpers.tsx`, exporting `m1Screens(): Record<string, ReactNode>`: synthetic-data
// renders of the views it built, by name (a name ending in " integrity-step" is also checked for the plan wording,
// R5-6). The guards then apply D1's word lists to those screens without any change to the guard file.
// It lives at the top of src/ because `import.meta.glob` patterns may start with './' only (trace/static-module-paths).
import type { ReactNode } from 'react';

const modules = import.meta.glob('./**/m1-screens.test-helpers.tsx', { eager: true }) as Record<
  string,
  { m1Screens?: unknown }
>;

/** Every registered screen as `<file> <name>` -> node. A module without `m1Screens()` fails loudly. */
export function registeredM1Screens(): Record<string, ReactNode> {
  const out: Record<string, ReactNode> = {};
  for (const [file, mod] of Object.entries(modules)) {
    if (typeof mod.m1Screens !== 'function') throw new Error(`${file} exports no m1Screens()`);
    const screens = (mod.m1Screens as () => Record<string, ReactNode>)();
    for (const [name, node] of Object.entries(screens)) out[`${file} ${name}`] = node;
  }
  return out;
}

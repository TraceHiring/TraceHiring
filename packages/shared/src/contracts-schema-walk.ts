// Test helper for the wire contracts: walks a zod v4 schema and reports every node, so tests can scan key names at
// any depth (rules 1, 5, 7) and prove two schemas share no sub-schema object. Not imported by product code.
import type { z } from 'zod';

type Def = { type: string; [k: string]: unknown };
type Child = { key?: string | undefined; node: unknown };

function defOf(node: unknown): Def | undefined {
  const zod = (node as { _zod?: { def?: Def } } | null)?._zod;
  return zod?.def;
}

function children(def: Def): Child[] {
  const out: Child[] = [];
  const add = (node: unknown, key?: string) => {
    if (node !== undefined && node !== null) out.push({ key, node });
  };
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, unknown>;
      for (const [key, node] of Object.entries(shape)) add(node, key);
      add(def.catchall);
      break;
    }
    case 'array':
      add(def.element);
      break;
    case 'union':
      for (const node of def.options as unknown[]) add(node);
      break;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      add(def.innerType);
      break;
    case 'pipe':
      add(def.in);
      add(def.out);
      break;
    case 'record':
    case 'map':
      add(def.keyType);
      add(def.valueType);
      break;
    case 'tuple':
      for (const node of def.items as unknown[]) add(node);
      add(def.rest);
      break;
    case 'set':
      add(def.valueType);
      break;
    case 'intersection':
      add(def.left);
      add(def.right);
      break;
    case 'lazy':
      add((def.getter as () => unknown)());
      break;
    default:
      break;
  }
  return out;
}

/** Every schema node reachable from `root` (the root included), each once. */
export function schemaNodes(root: z.ZodType): Set<unknown> {
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (seen.has(node)) return;
    seen.add(node);
    const def = defOf(node);
    if (!def) return;
    for (const child of children(def)) visit(child.node);
  };
  visit(root);
  return seen;
}

/** Every object-property name reachable from `root`, at any depth, sorted and de-duplicated. */
export function schemaKeys(root: z.ZodType): string[] {
  const keys = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (seen.has(node)) return;
    seen.add(node);
    const def = defOf(node);
    if (!def) return;
    for (const child of children(def)) {
      if (child.key !== undefined) keys.add(child.key);
      visit(child.node);
    }
  };
  visit(root);
  return [...keys].sort();
}

/** Keys at any depth that match `pattern`. Empty means the schema is clean. */
export function keysMatching(root: z.ZodType, pattern: RegExp): string[] {
  return schemaKeys(root).filter((key) => pattern.test(key));
}

/** Schema nodes reachable from both roots (reference equality). Empty means no sub-schema is shared. */
export function sharedNodes(a: z.ZodType, b: z.ZodType): unknown[] {
  const left = schemaNodes(a);
  return [...schemaNodes(b)].filter((node) => left.has(node));
}

/** True when every object schema reachable from `root` is strict (rejects unknown keys). */
export function allObjectsStrict(root: z.ZodType): boolean {
  for (const node of schemaNodes(root)) {
    const def = defOf(node);
    if (def?.type !== 'object') continue;
    const catchall = def.catchall as { _zod?: { def?: Def } } | undefined;
    if (catchall?._zod?.def?.type !== 'never') return false;
  }
  return true;
}

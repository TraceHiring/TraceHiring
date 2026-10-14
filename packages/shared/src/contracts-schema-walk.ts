// Test helper for the wire contracts: walks a zod v4 schema and reports every node, so tests can scan key names at
// any depth (rules 1, 5, 7) and prove two schemas share no sub-schema object. Not imported by product code.
// The walker is strict about itself: a def type it does not know throws, so a new zod wrapper can never make a
// sweep silently skip part of a schema.
import type { z } from 'zod';

type Def = { type: string; [k: string]: unknown };
type Child = { key?: string | undefined; node: unknown };

function defOf(node: unknown): Def | undefined {
  const zod = (node as { _zod?: { def?: Def } } | null)?._zod;
  return zod?.def;
}

/** Def types with no child schema. Anything neither listed here nor handled in `children` throws. */
const LEAF_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'null',
  'undefined',
  'void',
  'never',
  'any',
  'unknown',
  'date',
  'nan',
  'literal',
  'enum',
  'file',
  'template_literal',
  'custom',
  'transform',
]);

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
    case 'promise':
    case 'success':
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
      if (!LEAF_TYPES.has(def.type)) {
        throw new Error(`contracts-schema-walk: unknown zod def type "${def.type}"`);
      }
  }
  return out;
}

function requireDef(node: unknown): Def {
  const def = defOf(node);
  if (!def) throw new Error('contracts-schema-walk: node is not a zod schema');
  return def;
}

/** Every schema node reachable from `root` (the root included), each once. */
export function schemaNodes(root: z.ZodType): Set<unknown> {
  const seen = new Set<unknown>();
  const visit = (node: unknown) => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const child of children(requireDef(node))) visit(child.node);
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
    for (const child of children(requireDef(node))) {
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

/**
 * True when `root` reaches at least one object schema and every one of them is strict (rejects unknown keys).
 * A schema with no object node at all returns false, so a strictness sweep can never pass vacuously.
 */
export function allObjectsStrict(root: z.ZodType): boolean {
  let objects = 0;
  for (const node of schemaNodes(root)) {
    const def = defOf(node);
    if (def?.type !== 'object') continue;
    objects += 1;
    const catchall = def.catchall as { _zod?: { def?: Def } } | undefined;
    if (catchall?._zod?.def?.type !== 'never') return false;
  }
  return objects > 0;
}

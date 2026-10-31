// R3-3 static check (spec §6.2 "Media link requirements"; security review m4 F1): the evidence key is deterministic
// (D1-5), so "no audit row, no bytes" rests on services/api never building one. `keyTemplateOffenders` names every
// non-test source outside the media read path that holds a `media/` key template, the start-photo object name or the
// EVIDENCE binding. media-link.ts asserts the shape of the key media_view_grant returned; routes.ts wraps the bucket's
// `get`. Test files and helpers are skipped: they model the database, which is where the key comes from.
//
// The scan over all of services/api/src needs an `import.meta.glob('./**/*.ts')` at the src root (the lint rule
// trace/static-module-paths forbids `..` in a glob), which is lead-owned: see the R3a writer report.

// `media/${…}`, 'media/' + …, and the start-photo object name. A URL path `/media/${jti}` is not a key (it is
// preceded by `/`), so it does not match.
export const KEY_TEMPLATE = /(?<![/\w])media\/(\$\{|['"`])|['"`]media\/['"`]|start_photo\.jpg/;
export const EVIDENCE_USE = /\bEVIDENCE\b/;

/** The media read path as keyed by a glob at the services/api/src root. */
export const ROOT_READ_PATH: ReadonlySet<string> = new Set([
  './modules/media/media-link.ts',
  './modules/media/routes.ts',
]);
/** The same files as keyed by a glob in modules/media/. */
export const MEDIA_DIR_READ_PATH: ReadonlySet<string> = new Set(['./media-link.ts', './routes.ts']);

const isSource = (path: string) =>
  path.endsWith('.ts') &&
  !path.endsWith('.test.ts') &&
  !path.endsWith('.test-helpers.ts') &&
  !path.endsWith('.d.ts');

/** Sources outside the read path that name a media key or the EVIDENCE binding. */
export const keyTemplateOffenders = (
  sources: Readonly<Record<string, string>>,
  readPath: ReadonlySet<string>,
): string[] =>
  Object.entries(sources)
    .filter(([path]) => isSource(path) && !readPath.has(path))
    .filter(([, text]) => KEY_TEMPLATE.test(text) || EVIDENCE_USE.test(text))
    .map(([path]) => path);

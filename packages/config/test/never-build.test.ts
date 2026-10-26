// AT-D21, product rule 7 (specs/d1-demo-slice.md §9; docs/reviews/D1.md D1-SPEC-1): the never-build list.
// (1) No source identifier in apps/*/src, workers/*/src, services/*/src or packages/*/src names gaze,
//     emotion, personality, a voiceprint, face matching, an AI-likeness score or an ASN. Identifiers are
//     read from the TypeScript AST, so comments and prose strings do not count; a string literal that is
//     itself identifier-shaped (an object key, a column name) does. Test files are excluded.
// (2) No face-matching, face-recognition or emotion-inference package in any package.json or in the
//     lockfile (transitive packages included).
// (3) Self-tests: a planted identifier and a planted dependency are caught.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE_ROOTS = ['apps', 'workers', 'services', 'packages'];
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.wrangler', '__tests__', 'test', 'tests']);

/** One forbidden concept: a run of words that must not appear in a row in an identifier. */
const FORBIDDEN_WORDS: readonly (readonly string[])[] = [
  ['gaze'],
  ['emotion'],
  ['emotions'],
  ['emotional'],
  ['personality'],
  ['voiceprint'],
  ['voiceprints'],
  ['voice', 'print'],
  ['face', 'match'],
  ['face', 'matching'],
  ['face', 'matcher'],
  ['face', 'recognition'],
  ['ai', 'likeness'],
  ['asn'],
  // Single-token spellings the word split cannot separate (spec re-review of the D1 FIX, note 3).
  ['facematch'],
  ['facematches'],
  ['facematching'],
  ['facematcher'],
  ['faceprint'],
  ['faceprints'],
  ['face', 'print'],
  ['ailikeness'],
];

/** Face matching / face recognition / emotion or affect inference packages (rule 7; the opt-in identity add-on is not built in D1). */
const FORBIDDEN_PACKAGE =
  /^(?:face-api\.js|@vladmandic\/(?:face-api|human)|face-recognition|node-face-recognition|facenet.*|deepface.*|@tensorflow-models\/face-.*|@mediapipe\/face_.*|face-?landmarks.*|.*face-?match.*|.*emotion-?(?:detect|recogn|infer|analy).*|affectiva.*|morphcast.*|.*voiceprint.*)$/i;

/** An identifier's words: camelCase, PascalCase and snake_case split, lower case. */
const identifierWords = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());

const hasRun = (words: readonly string[], run: readonly string[]): boolean =>
  words.some((_, i) => run.every((w, j) => words[i + j] === w));

const forbiddenIdentifier = (name: string): boolean => {
  const words = identifierWords(name);
  return FORBIDDEN_WORDS.some((run) => hasRun(words, run));
};

const IDENTIFIER_SHAPED = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** The forbidden identifiers in one source text. */
const scanSource = (fileName: string, text: string): string[] => {
  const kind = /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    let name: string | undefined;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) name = node.text;
    else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      IDENTIFIER_SHAPED.test(node.text)
    )
      name = node.text;
    if (name !== undefined && forbiddenIdentifier(name)) found.push(name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

/** The forbidden package names among a package.json's dependency fields. */
const scanManifest = (manifest: Record<string, unknown>): string[] =>
  ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap((field) => Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}))
    .filter((name) => FORBIDDEN_PACKAGE.test(name));

/** The forbidden package names among a pnpm lockfile's `packages:` keys. */
const scanLockfile = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => /^ {2}'?(@?[^@\s'/]+(?:\/[^@\s']+)?)@/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined && FORBIDDEN_PACKAGE.test(name));

const dirsIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : sourceFiles(full);
    return SOURCE_FILE.test(e.name) && !TEST_FILE.test(e.name) ? [full] : [];
  });

const srcDirs = (): string[] =>
  SOURCE_ROOTS.flatMap((root) => dirsIn(path.join(repoRoot, root)))
    .map((pkg) => path.join(pkg, 'src'))
    .filter((src) => existsSync(src));

const manifests = (): string[] => [
  path.join(repoRoot, 'package.json'),
  ...[...SOURCE_ROOTS, 'e2e']
    .flatMap((root) => {
      const dir = path.join(repoRoot, root);
      return root === 'e2e' ? [dir] : dirsIn(dir);
    })
    .map((pkg) => path.join(pkg, 'package.json'))
    .filter((file) => existsSync(file)),
];

describe('AT-D21: the never-build list (rule 7)', () => {
  it('scans every app, Worker, service and package src directory', () => {
    const dirs = srcDirs().map((d) => path.relative(repoRoot, d).replaceAll('\\', '/'));
    for (const expected of [
      'apps/candidate/src',
      'apps/recruiter/src',
      'workers/edge/src',
      'workers/jobs/src',
      'services/api/src',
      'packages/band-engine/src',
      'packages/shared/src',
    ])
      expect(dirs).toContain(expected);
    expect(srcDirs().flatMap(sourceFiles).length).toBeGreaterThan(100);
  });

  it('scans source in a src directory named test (the candidate test screen; A7 spec review #4)', () => {
    const files = srcDirs()
      .flatMap(sourceFiles)
      .map((f) => path.relative(repoRoot, f).replaceAll('\\', '/'));
    expect(files).toContain('apps/candidate/src/test/Test.tsx');
    expect(files).toContain('apps/candidate/src/test/signals.ts');
    expect(files.filter((f) => TEST_FILE.test(f))).toEqual([]);
  });

  it('no source identifier names gaze, emotion, personality, a voiceprint, face matching, AI-likeness or an ASN', () => {
    const hits = srcDirs()
      .flatMap(sourceFiles)
      .flatMap((file) =>
        scanSource(file, readFileSync(file, 'utf8')).map(
          (name) => `${path.relative(repoRoot, file).replaceAll('\\', '/')}: ${name}`,
        ),
      );
    expect(hits).toEqual([]);
  });

  it('no package.json depends on a face-matching, face-recognition or emotion-inference package', () => {
    const found = manifests();
    expect(found.length).toBeGreaterThan(10);
    const hits = found.flatMap((file) =>
      scanManifest(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>).map(
        (name) => `${path.relative(repoRoot, file).replaceAll('\\', '/')}: ${name}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it('no such package is installed transitively (pnpm-lock.yaml)', () => {
    const lock = readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toMatch(/^packages:/m);
    expect(scanLockfile(lock)).toEqual([]);
  });

  describe('self-test: planted violations are caught', () => {
    it.each([
      ['gazeX', true],
      ['gaze_dwell_ms', true],
      ['emotionScore', true],
      ['detectEmotions', true],
      ['personalityTraits', true],
      ['voiceprint', true],
      ['VoicePrintTemplate', true],
      ['faceMatch', true],
      ['face_matching_score', true],
      ['FaceRecognitionClient', true],
      ['ai_likeness', true],
      ['aiLikenessScore', true],
      ['asn', true],
      ['clientASN', true],
      ['ASN_LOOKUP', true],
      // single-token spellings (spec re-review of the D1 FIX, note 3)
      ['facematch', true],
      ['Facematch', true],
      ['facematchScore', true],
      ['facematching', true],
      ['facematcher', true],
      ['faceprint', true],
      ['ailikeness', true],
      ['aiLikenessScore', true],
      // ordinary words that contain the letters but not the word
      ['gazette', false],
      ['async', false],
      ['asn1Parser', false],
      ['interface', false],
      ['surfaceMatches', false],
      ['facet', false],
      ['emotive', false],
      ['matchFace', false],
    ])('%s -> %s', (name, forbidden) => {
      expect(forbiddenIdentifier(name)).toBe(forbidden);
    });

    it('finds identifiers, identifier-shaped strings, JSX props and private fields, but not comments or prose', () => {
      const code = [
        '// gaze is never a flag; no emotion inference',
        '/* faceMatch is not built */',
        "const note = 'we never track gaze or emotion';",
        'export const gazeScore = 1;',
        "const row = { 'ai_likeness': 2 };",
        'class A { #voiceprint = 3; }',
        'export const C = () => <div emotionLabel="x">{\'asn\'}</div>;',
      ].join('\n');
      expect(scanSource('planted.tsx', code)).toEqual([
        'gazeScore',
        'ai_likeness',
        '#voiceprint',
        'emotionLabel',
        'asn',
      ]);
    });

    it('finds a planted dependency in a package.json and in a lockfile', () => {
      expect(
        scanManifest({
          dependencies: { react: '1.0.0', 'face-api.js': '0.22.2' },
          devDependencies: { '@vladmandic/human': '3.0.0', '@emotion/react': '11.0.0' },
          optionalDependencies: { 'emotion-detector': '1.0.0' },
        }),
      ).toEqual(['face-api.js', '@vladmandic/human', 'emotion-detector']);
      expect(
        scanLockfile(
          [
            'packages:',
            '',
            "  '@tensorflow-models/face-landmarks-detection@1.0.5':",
            '    resolution: {integrity: sha512-x}',
            '  react@18.3.1:',
            '  deepface-js@0.1.0:',
            '  @emotion/react@11.0.0:',
          ].join('\n'),
        ),
      ).toEqual(['@tensorflow-models/face-landmarks-detection', 'deepface-js']);
    });
  });
});

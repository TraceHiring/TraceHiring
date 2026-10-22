// R3-3 static half (spec §6.2 "Media link requirements"; security review m4 F1). This file proves the scanner and
// runs it over the media module; the same scanner over all of services/api/src runs from a src-root test the lead
// adds (a glob may not climb with `..`, rule trace/static-module-paths; see the R3a writer report).
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_USE,
  KEY_TEMPLATE,
  MEDIA_DIR_READ_PATH,
  keyTemplateOffenders,
} from './key-template.test-helpers.js';

declare global {
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

const media = import.meta.glob(['./**/*.ts'], { query: '?raw', import: 'default', eager: true });

describe('R3-3: no evidence key is built outside the media read path', () => {
  it('matches key templates and the bucket, not the /media/ URL path', () => {
    expect(KEY_TEMPLATE.test('const k = `media/${org}/${session}/start_photo.jpg`;')).toBe(true);
    expect(KEY_TEMPLATE.test("const k = 'media/' + org;")).toBe(true);
    expect(KEY_TEMPLATE.test('const k = "media/" + org;')).toBe(true);
    expect(KEY_TEMPLATE.test("const f = 'start_photo.jpg';")).toBe(true);
    expect(KEY_TEMPLATE.test('const u = `${origin}/media/${jti}`;')).toBe(false);
    expect(KEY_TEMPLATE.test("app.all('/media/:jti', h);")).toBe(false);
    expect(EVIDENCE_USE.test('await env.EVIDENCE.get(k);')).toBe(true);
  });

  it('flags a source outside the read path and skips tests and helpers', () => {
    const offenders = keyTemplateOffenders(
      {
        './media-link.ts': 'k.startsWith(`media/${org}/`)',
        './routes.ts': 'env.EVIDENCE',
        './other.ts': 'const k = `media/${o}/${s}/start_photo.jpg`;',
        './bucket.ts': 'env.EVIDENCE.get(k)',
        './x.test.ts': 'const k = `media/${o}`;',
        './x.test-helpers.ts': 'const k = `media/${o}`;',
      },
      MEDIA_DIR_READ_PATH,
    );
    expect(offenders).toEqual(['./other.ts', './bucket.ts']);
  });

  it('the read path holds the key assertion, and no other media source names a key or EVIDENCE', () => {
    expect(KEY_TEMPLATE.test(media['./media-link.ts'] ?? '')).toBe(true);
    expect(EVIDENCE_USE.test(media['./routes.ts'] ?? '')).toBe(true);
    expect(Object.keys(media).length).toBeGreaterThan(4);
    expect(keyTemplateOffenders(media, MEDIA_DIR_READ_PATH)).toEqual([]);
  });
});

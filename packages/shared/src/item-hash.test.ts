// The canonical content hash of an item version and a variant (spec m1 R5-49 a; Wave 2 lead scaffolding, so the api
// and the jobs worker write the same item_versions.content_sha256), and the AI draft topic scrubber (§6.4).
// Synthetic content only.
import { describe, expect, it } from 'vitest';
import {
  itemContentSha256,
  scrubDraftTopic,
  snapshotDigest,
  variantContentSha256,
} from './item-hash.js';

const HEX = /^[0-9a-f]{64}$/;
const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_LIB = '00000000-0000-4000-8000-0000000000b2';
const IMG = 'c'.repeat(64);

const mcq = {
  format: 'mcq' as const,
  stem: '[synthetic] Which is larger?',
  options: [
    { id: 'a', text: 'Two' },
    { id: 'b', text: 'Three' },
  ],
  media: [{ key: `item-media/${ORG_A}/${IMG}.png`, alt: 'A chart' }],
  paramSpec: null,
};

describe('itemContentSha256 (R5-49 a)', () => {
  it('is lower-case hex SHA-256 and deterministic', async () => {
    const a = await itemContentSha256(mcq);
    expect(a).toMatch(HEX);
    expect(await itemContentSha256({ ...mcq })).toBe(a);
  });

  it('changes with the stem, an option text, an option id, the format and an image alt', async () => {
    const base = await itemContentSha256(mcq);
    const variants = [
      { ...mcq, stem: '[synthetic] Which is smaller?' },
      {
        ...mcq,
        options: [
          { id: 'a', text: 'Two' },
          { id: 'b', text: 'Four' },
        ],
      },
      {
        ...mcq,
        options: [
          { id: 'a', text: 'Two' },
          { id: 'c', text: 'Three' },
        ],
      },
      { ...mcq, media: [{ key: mcq.media[0]!.key, alt: 'Another chart' }] },
      { ...mcq, media: [] },
    ];
    for (const v of variants) expect(await itemContentSha256(v)).not.toBe(base);
  });

  it('ignores the org prefix of an image key, so a library copy keeps its source hash', async () => {
    const copy = { ...mcq, media: [{ key: `item-media/${ORG_LIB}/${IMG}.png`, alt: 'A chart' }] };
    expect(await itemContentSha256(copy)).toBe(await itemContentSha256(mcq));
  });

  it('excludes param_spec.correctOptionId (the library copy strips it, SEC-M1-1)', async () => {
    const spec = { params: { a: { kind: 'int', min: 1, max: 9, step: 1 } }, stem: '{{a}}' };
    const withKey = await itemContentSha256({
      ...mcq,
      paramSpec: { ...spec, correctOptionId: 'a' },
    });
    expect(await itemContentSha256({ ...mcq, paramSpec: spec })).toBe(withKey);
    expect(await itemContentSha256({ ...mcq, paramSpec: { ...spec, stem: '{{a}}!' } })).not.toBe(
      withKey,
    );
  });

  it('a written item hashes with null options', async () => {
    const written = {
      format: 'written' as const,
      stem: '[synthetic] Explain.',
      options: null,
      media: null,
      paramSpec: null,
    };
    expect(await itemContentSha256(written)).toMatch(HEX);
    expect(await itemContentSha256(written)).not.toBe(
      await itemContentSha256({ ...written, format: 'mcq' }),
    );
  });

  it('refuses an image key that is not item-media/<uuid>/<sha256>.<ext>', async () => {
    await expect(
      itemContentSha256({ ...mcq, media: [{ key: 'item-media/x.png', alt: 'x' }] }),
    ).rejects.toThrow();
  });
});

describe('variantContentSha256 (R5-49 a)', () => {
  const v = {
    stem: '[synthetic] 2 + 3?',
    options: [
      { id: 'a', text: '5' },
      { id: 'b', text: '6' },
    ],
    params: { a: 2, b: 3 },
  };
  it('is deterministic, key-order free, and changes with the content', async () => {
    const h = await variantContentSha256(v);
    expect(h).toMatch(HEX);
    expect(await variantContentSha256({ ...v, params: { b: 3, a: 2 } })).toBe(h);
    expect(await variantContentSha256({ ...v, params: { a: 2, b: 4 } })).not.toBe(h);
    expect(await variantContentSha256({ ...v, stem: '[synthetic] 2 + 4?' })).not.toBe(h);
  });
});

describe('scrubDraftTopic (§6.4)', () => {
  it('replaces emails, URLs and digit runs of 8 or more with [removed]', () => {
    const at = String.fromCharCode(64);
    const topic = `queues; ask a${at}example.test or see https://example.test/x or call 98765 43210 now`;
    const out = scrubDraftTopic(topic);
    expect(out).not.toContain(at);
    expect(out).not.toContain('https');
    expect(out).not.toMatch(/\d{5}\s?\d{5}/);
    expect(out).toContain('[removed]');
    expect(out.startsWith('queues;')).toBe(true);
  });

  it('keeps short numbers and caps the result at 500 characters', () => {
    expect(scrubDraftTopic('top 10 sorting algorithms in 2026')).toBe(
      'top 10 sorting algorithms in 2026',
    );
    expect(scrubDraftTopic('x'.repeat(700))).toHaveLength(500);
  });

  it('never returns an empty topic', () => {
    expect(scrubDraftTopic('   ')).toBe('[removed]');
  });
});

describe('snapshotDigest (publish race, Wave 2 lead decision)', () => {
  const rows = [
    { sectionId: ORG_LIB, itemVersionId: ORG_A, exposureAtPublish: 3 },
    { sectionId: ORG_A, itemVersionId: ORG_LIB, exposureAtPublish: 0 },
  ];
  it('is the SHA-256 of the sorted lines, independent of row order', async () => {
    const lines = [`${ORG_A}:${ORG_LIB}:0`, `${ORG_LIB}:${ORG_A}:3`].join('\n');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await snapshotDigest(rows)).toBe(hex);
    expect(await snapshotDigest([...rows].reverse())).toBe(hex);
  });
  it('changes with an exposure count or a missing row; refuses a negative count', async () => {
    const base = await snapshotDigest(rows);
    expect(await snapshotDigest([{ ...rows[0]!, exposureAtPublish: 4 }, rows[1]!])).not.toBe(base);
    expect(await snapshotDigest([rows[0]!])).not.toBe(base);
    await expect(snapshotDigest([{ ...rows[0]!, exposureAtPublish: -1 }])).rejects.toThrow();
  });
});

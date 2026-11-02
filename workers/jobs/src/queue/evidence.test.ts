// The evidence bucket as the stages' read-only EvidenceReader (spec d1 §5.1: the consumer injects the R2 reader).
// Only get and head reach the bucket; a missing object is null; metadata defaults to an empty record.
import { describe, expect, it } from 'vitest';
import { r2EvidenceReader } from './evidence.js';

const fakeBucket = (objects: Record<string, { body: string; meta?: Record<string, string> }>) => {
  const calls: string[] = [];
  const bucket = {
    get(key: string) {
      calls.push(`get ${key}`);
      const o = objects[key];
      if (o === undefined) return Promise.resolve(null);
      const bytes = new TextEncoder().encode(o.body);
      return Promise.resolve({
        size: bytes.length,
        customMetadata: o.meta,
        text: () => Promise.resolve(o.body),
        arrayBuffer: () => Promise.resolve(bytes.buffer),
      });
    },
    head(key: string) {
      calls.push(`head ${key}`);
      const o = objects[key];
      if (o === undefined) return Promise.resolve(null);
      return Promise.resolve({
        size: new TextEncoder().encode(o.body).length,
        customMetadata: o.meta,
      });
    },
    put() {
      throw new Error('the reader must never write');
    },
    delete() {
      throw new Error('the reader must never delete');
    },
  };
  return { bucket: bucket as unknown as R2Bucket, calls };
};

describe('r2EvidenceReader', () => {
  it('get returns size, metadata and the body; head returns size and metadata', async () => {
    const { bucket, calls } = fakeBucket({
      'media/o/s/start_photo.jpg': { body: 'jpeg-bytes', meta: { sha256: 'ab', blurred: '1' } },
      'sessions/o/s/final.json': { body: '{"v":1}' },
    });
    const reader = r2EvidenceReader(bucket);

    const head = await reader.head('media/o/s/start_photo.jpg');
    expect(head).toEqual({ size: 10, customMetadata: { sha256: 'ab', blurred: '1' } });

    const obj = await reader.get('sessions/o/s/final.json');
    expect(obj?.size).toBe(7);
    expect(obj?.customMetadata).toEqual({});
    expect(await obj?.text()).toBe('{"v":1}');
    expect(new TextDecoder().decode(await obj!.arrayBuffer())).toBe('{"v":1}');

    expect(calls).toEqual(['head media/o/s/start_photo.jpg', 'get sessions/o/s/final.json']);
  });

  it('a missing object is null for get and head', async () => {
    const { bucket } = fakeBucket({});
    const reader = r2EvidenceReader(bucket);
    await expect(reader.get('nope')).resolves.toBeNull();
    await expect(reader.head('nope')).resolves.toBeNull();
  });

  it('exposes only get and head', () => {
    const { bucket } = fakeBucket({});
    expect(Object.keys(r2EvidenceReader(bucket)).sort()).toEqual(['get', 'head']);
  });
});

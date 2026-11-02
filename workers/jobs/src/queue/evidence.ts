// The evidence bucket (trace-evidence-<env>) as the stages' read-only EvidenceReader (spec d1 §5.1). Neutral,
// lead-wired code: only get and head reach the bucket, so no stage can write or delete evidence.
import type { EvidenceReader } from '@trace/shared/jobs';

export const r2EvidenceReader = (bucket: R2Bucket): EvidenceReader => ({
  get: async (key) => {
    const object = await bucket.get(key);
    if (object === null) return null;
    return {
      size: object.size,
      customMetadata: object.customMetadata ?? {},
      text: () => object.text(),
      arrayBuffer: () => object.arrayBuffer(),
    };
  },
  head: async (key) => {
    const object = await bucket.head(key);
    if (object === null) return null;
    return { size: object.size, customMetadata: object.customMetadata ?? {} };
  },
});

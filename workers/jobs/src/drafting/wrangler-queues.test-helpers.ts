// The queue consumers of workers/jobs/wrangler.jsonc as the tests read them (the file's text through Vite's `?raw`
// import, as workers/edge/src/link-limit.test.ts; a workerd test has no file system). JSONC as wrangler reads it: line
// and block comments, trailing commas, string-aware.
import wranglerText from '../../wrangler.jsonc?raw';

const stripJsonc = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
};

export interface QueueConsumerConfig {
  queue: string;
  max_retries?: number;
}

/** Every queue consumer of every env block of the jobs Worker. */
export const wranglerConsumers = (): QueueConsumerConfig[] => {
  const cfg = JSON.parse(stripJsonc(wranglerText)) as {
    env?: Record<string, { queues?: { consumers?: QueueConsumerConfig[] } }>;
  };
  return Object.values(cfg.env ?? {}).flatMap((e) => e.queues?.consumers ?? []);
};

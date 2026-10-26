// An item's images (R5-10, R5-66 e, R5-68 c; AT-M1-32): each is fetched through the API client and shown as a `data:`
// URL held in this component's state only (never stored). A 404 or unusable image shows one neutral line with its alt
// text; a network failure, 429 or 503 is retried with backoff (at most 4 tries), then the same line shows with
// "Try again". Nothing says why (the edge answers every refusal the same way).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CandidateApi } from '../api';
import { COPY } from '../copy';
import { ui } from '../ui';
import { loadItemImage, type ImageLoad } from './media';
import styles from './Test.module.css';

interface Props {
  api: Pick<CandidateApi, 'media'>;
  sessionToken: string;
  media: { hash: string; alt: string }[];
}

/** `undefined` while loading. */
type Loaded = Record<string, ImageLoad | undefined>;

export function ItemImages({ api, sessionToken, media }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({});
  const alive = useRef(true);
  const key = media.map((m) => m.hash).join(',');

  const load = useCallback(
    (hash: string) => {
      setLoaded((l) => ({ ...l, [hash]: undefined }));
      void loadItemImage(api, sessionToken, hash, { alive: () => alive.current }).then((res) => {
        if (alive.current) setLoaded((l) => ({ ...l, [hash]: res }));
      });
    },
    [api, sessionToken],
  );

  useEffect(() => {
    alive.current = true;
    const hashes = key === '' ? [] : key.split(',');
    for (const hash of new Set(hashes)) load(hash);
    return () => {
      alive.current = false;
    };
  }, [load, key]);

  return (
    <div className={styles.images}>
      {media.map((m, k) => {
        const res = loaded[m.hash];
        if (res === undefined) return null;
        if (res.kind === 'ok') {
          return <img key={`${m.hash}-${k}`} className={styles.image} src={res.url} alt={m.alt} />;
        }
        return (
          <div key={`${m.hash}-${k}`}>
            <p className={ui.muted}>{COPY.test.imageUnavailable(m.alt)}</p>
            {res.kind === 'failed' ? (
              <button
                type="button"
                className={ui.secondary}
                data-testid="image-retry"
                onClick={() => load(m.hash)}
              >
                {COPY.test.retry}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

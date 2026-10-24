// An item's images (R5-10, R5-66 e; AT-M1-32): each is fetched once through the API client and shown as a `data:`
// URL held in this component's state only (never stored). A refused or unusable image shows one neutral line with
// its alt text; nothing says why (the edge answers every refusal the same way).
import { useEffect, useState } from 'react';
import type { CandidateApi } from '../api';
import { COPY } from '../copy';
import { ui } from '../ui';
import { itemImageUrl } from './media';
import styles from './Test.module.css';

interface Props {
  api: Pick<CandidateApi, 'media'>;
  sessionToken: string;
  media: { hash: string; alt: string }[];
}

/** `undefined` while loading, `null` when it cannot be shown. */
type Loaded = Record<string, string | null | undefined>;

export function ItemImages({ api, sessionToken, media }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({});
  const key = media.map((m) => m.hash).join(',');

  useEffect(() => {
    let alive = true;
    const hashes = key === '' ? [] : key.split(',');
    for (const hash of new Set(hashes)) {
      void itemImageUrl(api, sessionToken, hash).then((url) => {
        if (alive) setLoaded((l) => ({ ...l, [hash]: url }));
      });
    }
    return () => {
      alive = false;
    };
  }, [api, sessionToken, key]);

  return (
    <div className={styles.images}>
      {media.map((m, k) => {
        const url = loaded[m.hash];
        if (url === undefined) return null;
        if (url === null) {
          return (
            <p key={`${m.hash}-${k}`} className={ui.muted}>
              {COPY.test.imageUnavailable(m.alt)}
            </p>
          );
        }
        return <img key={`${m.hash}-${k}`} className={styles.image} src={url} alt={m.alt} />;
      })}
    </div>
  );
}

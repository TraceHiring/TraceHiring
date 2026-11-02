// The demo outbox (specs/d1-demo-slice.md §6.1). Present only in non-production builds: routes.tsx and the nav
// load this module behind the build flag, so a production build tree-shakes the whole module (AT-D18).
import { OutboxListResponse } from '@trace/shared/contracts/d1';
import { useEffect, useMemo } from 'react';
import type { ApiClient } from '../api/client';
import { useApi } from '../api/runtime';
import { formatTime } from '../common/format';
import { CardPoller, usePoller } from '../common/poller';
import ui from '../common/Ui.module.css';

type Entry = OutboxListResponse['entries'][number];

export const sortOutbox = (entries: readonly Entry[]): Entry[] =>
  [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

/** Polls the list every 3 s for as long as the screen is open. */
export function createOutboxPoller(api: ApiClient): CardPoller<OutboxListResponse> {
  return new CardPoller<OutboxListResponse>({
    fetchCard: () => api.call({ method: 'GET', path: '/demo-outbox', schema: OutboxListResponse }),
    isFinal: () => false,
    slowAfterMs: Number.POSITIVE_INFINITY,
  });
}

export function OutboxView({ data }: { data: OutboxListResponse | null }) {
  const entries = data === null ? [] : sortOutbox(data.entries);
  return (
    <section className={ui.stack}>
      <p className={ui.banner} role="note">
        Demo outbox: messages are not sent
      </p>
      <h2 className={ui.title}>Demo outbox</h2>
      {data === null ? (
        <p role="status">Loading...</p>
      ) : entries.length === 0 ? (
        <p>No messages yet.</p>
      ) : (
        <table className={ui.table}>
          <caption className={ui.note}>Newest first. Updates every 3 seconds.</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Kind</th>
              <th scope="col">Candidate</th>
              <th scope="col">Message</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatTime(entry.createdAt)}</td>
                <td>{entry.kind === 'invite' ? 'Invitation' : 'One-time code'}</td>
                <td>{entry.candidateLabel}</td>
                <td className={ui.mono}>{entry.bodyText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Route `/demo-outbox`. */
export default function OutboxRoute() {
  const api = useApi();
  const poller = useMemo(() => (api === null ? null : createOutboxPoller(api)), [api]);
  useEffect(() => {
    poller?.start();
    return () => {
      poller?.stop();
    };
  }, [poller]);
  if (poller === null) return <p role="alert">Sign in to see the outbox.</p>;
  return <OutboxLoaded poller={poller} />;
}

function OutboxLoaded({ poller }: { poller: CardPoller<OutboxListResponse> }) {
  const { state } = usePoller(poller);
  return <OutboxView data={state.kind === 'value' ? state.value : null} />;
}

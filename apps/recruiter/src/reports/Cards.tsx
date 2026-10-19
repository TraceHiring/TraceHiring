// The two result cards (specs/d1-demo-slice.md §6.1). Both use the same shell, so width, height and visual weight
// are identical by construction. Each view takes only its own poller snapshot: the quality card never sees an
// integrity value and the integrity card never sees the score (rule 1).
import type { IntegrityCard, QualityCard } from '@trace/shared/contracts/d1';
import { useId, type ReactNode } from 'react';
import { usePoller, type CardPoller, type PollSnapshot } from '../common/poller';
import styles from './Report.module.css';
import { BAND_LABEL, type ReadyIntegrity } from './labels';
import { bundledRuleTable, permilleAsPercent } from './rule-table';

function CardShell({
  region,
  title,
  children,
}: {
  region: 'quality-card' | 'integrity-card';
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles.card} data-region={region} aria-labelledby={id}>
      <h3 id={id} className={styles.overline}>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The wait and retry lines shared by both cards. */
function Waiting<T>({ snapshot, pendingText }: { snapshot: PollSnapshot<T>; pendingText: string }) {
  const { state, slow } = snapshot;
  return (
    <>
      <p className={styles.headline} data-headline role="status">
        {state.kind === 'loading' ? 'Loading...' : state.kind === 'unavailable' ? '-' : pendingText}
      </p>
      {state.kind === 'unavailable' && (
        <p className={styles.note}>Not available right now. Retrying.</p>
      )}
      {slow && <p className={styles.note}>Taking longer than usual</p>}
    </>
  );
}

type ReadyQuality = Extract<QualityCard, { state: 'ready' }>;

function QualityReady({ card }: { card: ReadyQuality }) {
  return (
    <>
      <p className={styles.note}>
        Grader {card.graderModelId} · rubric {card.rubricVersion} · scoring {card.scoringVersion} ·
        not affected by integrity signals
      </p>
      <p className={styles.headline} data-headline>
        {card.score} <span className={styles.headlineUnit}>/ 100</span>
      </p>
      {card.sections.map((section) => {
        const percent = Math.round(section.scoreHundredths / 100);
        return (
          <p key={section.sectionId} className={styles.sectionRow}>
            <span>{section.name}</span>
            <meter
              className={styles.meter}
              min={0}
              max={100}
              value={percent}
              aria-label={`${section.name}, ${percent} out of 100`}
            />
            <span className={styles.rowValue}>{percent}</span>
          </p>
        );
      })}
    </>
  );
}

export function QualityCardView({ snapshot }: { snapshot: PollSnapshot<QualityCard> }) {
  const { state } = snapshot;
  return (
    <CardShell region="quality-card" title="Answer Quality">
      {state.kind === 'value' && state.value.state === 'ready' ? (
        <QualityReady card={state.value} />
      ) : (
        <Waiting snapshot={snapshot} pendingText={state.kind === 'value' ? 'Scoring...' : ''} />
      )}
    </CardShell>
  );
}

/** The bundled rule table the card names, row by row; the fallback line when this build has no such table. */
function RuleTableView({ version }: { version: string }) {
  const table = bundledRuleTable(version);
  if (table === null) {
    return <p className={styles.note}>Rule table not available in this build</p>;
  }
  return (
    <>
      <p className={styles.note}>Families: {table.families.join(', ')}</p>
      <p className={styles.note}>
        Coverage floor {permilleAsPercent(table.coverageFloorPermille)} · Photo missing factor{' '}
        {permilleAsPercent(table.coveragePhotoMissingFactorPermille)}
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Kinds</th>
            <th scope="col">Family</th>
            <th scope="col">Tier</th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {table.rules.map((rule) => (
            <tr key={rule.id}>
              <th scope="row" className={styles.mono}>
                {rule.id}
              </th>
              <td>{rule.kinds.join(', ')}</td>
              <td>{rule.family}</td>
              <td>{rule.tier}</td>
              <td>{rule.severity}</td>
              <td>{rule.validated ? 'Validated' : 'Context only'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function IntegrityReady({ card }: { card: ReadyIntegrity }) {
  const [first, ...more] = card.reasons;
  return (
    <>
      <p className={`${styles.band} ${styles[`band_${card.band}`] ?? ''}`} data-headline>
        {BAND_LABEL[card.band]}
      </p>
      <p className={styles.stats}>
        <span>Evidence strength {card.evidenceStrength.toFixed(2)}</span>
        <span>Coverage {Math.round(card.coveragePct)}%</span>
      </p>
      {first !== undefined && <p>{first}</p>}
      {more.length > 0 && (
        <ul className={styles.reasons}>
          {more.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <details className={styles.disclosure}>
        <summary>How the band is set</summary>
        <p>
          Rule table {card.ruleTableVersion}, engine {card.engineVersion}. The same inputs always
          give the same band. Client-reported (T3) signals can reach Review only; untrusted input is
          hard evidence. Signals that have not been validated are shown as context only.
        </p>
        <RuleTableView version={card.ruleTableVersion} />
      </details>
    </>
  );
}

export function IntegrityCardView({ snapshot }: { snapshot: PollSnapshot<IntegrityCard> }) {
  const { state } = snapshot;
  const card = state.kind === 'value' ? state.value : null;
  return (
    <CardShell region="integrity-card" title="Integrity Signals">
      {card?.state === 'ready' ? (
        <IntegrityReady card={card} />
      ) : card?.state === 'not_used_below_cutoff' ? (
        <>
          <p className={styles.headline} data-headline>
            Not reviewed (below cutoff)
          </p>
          <p>Integrity signals for candidates below the cutoff are not used in any decision</p>
        </>
      ) : (
        <Waiting snapshot={snapshot} pendingText={card === null ? '' : 'Pending'} />
      )}
    </CardShell>
  );
}

export function QualityCardPanel({ poller }: { poller: CardPoller<QualityCard> }) {
  return <QualityCardView snapshot={usePoller(poller)} />;
}

export function IntegrityCardPanel({ poller }: { poller: CardPoller<IntegrityCard> }) {
  return <IntegrityCardView snapshot={usePoller(poller)} />;
}

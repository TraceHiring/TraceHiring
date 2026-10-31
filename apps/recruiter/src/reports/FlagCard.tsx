// One flag as evidence (specs/d1-demo-slice.md §6.1, plan §5 F): rule, observed value, time, tier note, status
// "Pending review". It has no buttons: D1 has no confirm, overturn or decision path (rule 2).
import { formatOffset } from '../common/format';
import styles from './Report.module.css';
import { FAMILY_LABEL, observedText, tierNote, type ReadyIntegrity } from './labels';

export type Flag = ReadyIntegrity['flags'][number];

export function FlagCard({ flag, index }: { flag: Flag; index: number }) {
  return (
    <article className={styles.flagCard} aria-label={`Flag ${index}: ${flag.ruleId}`}>
      <h4 className={styles.flagTitle}>
        Flag {index} · {FAMILY_LABEL[flag.family]}
      </h4>
      <p className={styles.flagStatus}>Pending review</p>
      <dl className={styles.facts}>
        <dt>Rule</dt>
        <dd className={styles.mono}>{flag.ruleId}</dd>
        <dt>Observed</dt>
        <dd>
          {observedText(flag.observed)}
          {flag.count > 1 ? ` · ${flag.count} events` : ''}
        </dd>
        <dt>At</dt>
        <dd>
          <span className={styles.mono}>{formatOffset(flag.atMs)}</span>{' '}
          <span className={styles.muted}>({flag.atMs} ms into the session)</span>
        </dd>
        <dt>Events</dt>
        <dd className={styles.mono}>{flag.signalSeqs.map((seq) => `#${seq}`).join(', ')}</dd>
        <dt>Evidence tier</dt>
        <dd>{tierNote(flag)}</dd>
      </dl>
    </article>
  );
}

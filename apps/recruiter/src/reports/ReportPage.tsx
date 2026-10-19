// The report page (specs/d1-demo-slice.md §6.1, design screen 01 minus everything M6 owns). Three calls, three
// pollers; each panel subscribes only to its own poller. There is no button that changes a candidate's status.
import type { IntegrityCard, ReportMetaResponse } from '@trace/shared/contracts/d1';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { useApi } from '../api/runtime';
import { formatTime } from '../common/format';
import { errorText } from '../common/messages';
import { usePoller, type CardPoller } from '../common/poller';
import { IntegrityCardPanel, QualityCardPanel } from './Cards';
import { EvidenceTimeline } from './EvidenceTimeline';
import { FlagCard } from './FlagCard';
import { StartPhotoPanel } from './StartPhotoPanel';
import { FAMILIES, FAMILY_LABEL, type ReadyIntegrity } from './labels';
import { ReportController } from './report-controller';
import styles from './Report.module.css';

export const INFO_LINE =
  'Nothing is decided automatically. Signals are observations, not proof of misconduct. A person makes every decision.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ReportHeaderView({
  meta,
  errorCode = null,
}: {
  meta: ReportMetaResponse | null;
  /** A terminal failure of the header call: the fixed text for it replaces "Loading...". */
  errorCode?: string | null;
}) {
  if (errorCode !== null) {
    return (
      <header className={styles.header}>
        <h2>Report</h2>
        <p role="alert">{errorText(errorCode)}</p>
      </header>
    );
  }
  if (meta === null) {
    return (
      <header className={styles.header}>
        <h2>Report</h2>
        <p role="status">Loading...</p>
      </header>
    );
  }
  const { report, versions } = meta;
  return (
    <header className={styles.header}>
      <h2>{report.label}</h2>
      <ul className={styles.meta}>
        <li>{report.testName}</li>
        <li>Version {report.testVersion}</li>
        <li>Submitted {formatTime(report.submittedAt)}</li>
        <li>
          Receipt <span className={styles.mono}>{report.receiptRefPrefix}</span>
        </li>
        <li>
          Consent text hash <span className={styles.mono}>{report.noticeHashPrefix}</span>
        </li>
        {versions.quality !== null && (
          <li>
            Rubric {versions.quality.rubricVersion} · scoring {versions.quality.scoringVersion}
          </li>
        )}
        <li>Ruleset {versions.integrity.rulesetVersion}</li>
      </ul>
    </header>
  );
}

function ReportHeader({ poller }: { poller: CardPoller<ReportMetaResponse> }) {
  const { state } = usePoller(poller);
  return (
    <ReportHeaderView
      meta={state.kind === 'value' ? state.value : null}
      errorCode={state.kind === 'terminal' ? state.code : null}
    />
  );
}

export function SignalsByFamilyTable({ card }: { card: ReadyIntegrity }) {
  return (
    <section className={styles.panel} aria-labelledby="signals-title">
      <h3 id="signals-title">Signals by family</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Family</th>
            <th scope="col">Flags</th>
            <th scope="col">Context events</th>
          </tr>
        </thead>
        <tbody>
          {FAMILIES.map((family) => {
            const row = card.signalsByFamily.find((entry) => entry.family === family);
            return (
              <tr key={family}>
                <th scope="row">{FAMILY_LABEL[family]}</th>
                <td>{row?.flagCount ?? 0}</td>
                <td>{row?.contextCount ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Shown only for a `ready` integrity card (rule 6): signals, timeline, flag cards and the start photo. */
export function IntegrityEvidenceView({
  card,
  photo,
}: {
  card: ReadyIntegrity;
  photo: React.ReactNode;
}) {
  return (
    <div data-region="integrity-evidence" className={styles.page}>
      <SignalsByFamilyTable card={card} />
      <section className={styles.panel} aria-labelledby="timeline-title">
        <h3 id="timeline-title">Evidence timeline</h3>
        <EvidenceTimeline timeline={card.timeline} />
      </section>
      <section className={styles.panel} aria-labelledby="flags-title">
        <h3 id="flags-title">Flags</h3>
        {card.flags.length === 0 ? (
          <p>No flags.</p>
        ) : (
          <div className={styles.flags}>
            {card.flags.map((flag, index) => (
              <FlagCard key={`${flag.ruleId}-${flag.atMs}`} flag={flag} index={index + 1} />
            ))}
          </div>
        )}
      </section>
      {photo}
    </div>
  );
}

function IntegrityEvidence({ controller }: { controller: ReportController }) {
  const { state } = usePoller(controller.integrity);
  const card: IntegrityCard | null = state.kind === 'value' ? state.value : null;
  if (card?.state !== 'ready') return null;
  return (
    <IntegrityEvidenceView
      card={card}
      photo={<StartPhotoPanel controller={controller.photo} photoMissing={card.photoMissing} />}
    />
  );
}

/** The page for one controller (tests pass their own; the route builds it from the signed-in api). */
export function ReportPage({ controller }: { controller: ReportController }) {
  useEffect(() => {
    controller.start();
    return () => {
      controller.stop();
    };
  }, [controller]);
  // A terminal header answer (not found, sign-in needed) ends the page: the cards have stopped and are not drawn.
  const ended = usePoller(controller.meta).state.kind === 'terminal';
  return (
    <div className={styles.page}>
      <ReportHeader poller={controller.meta} />
      <p className={styles.info}>{INFO_LINE}</p>
      {!ended && (
        <>
          <div className={styles.cards}>
            <QualityCardPanel poller={controller.quality} />
            <IntegrityCardPanel poller={controller.integrity} />
          </div>
          <IntegrityEvidence controller={controller} />
        </>
      )}
    </div>
  );
}

/** Route `/reports/:reportId`. */
export function ReportRoute() {
  const { reportId } = useParams();
  const api = useApi();
  const controller = useMemo(
    () =>
      api !== null && reportId !== undefined && UUID.test(reportId)
        ? new ReportController(api, reportId)
        : null,
    [api, reportId],
  );
  if (controller === null) return <p role="alert">Report not found.</p>;
  return <ReportPage controller={controller} />;
}

// The current section's header on a v2 test screen (R5-9, R5-24, R5-59 e, R5-66 c, g): its name, its own timer
// (the server's `deadlineAt` through the server-clock offset), its rules (order, paste, drop) and "Finish this
// section" with a confirm that says finishing is final. Neutral copy only: a closed section is never worded as
// suspicion. Expiry is handled by the screen, not here (the deadline may pass while another section is shown).
import { COPY } from '../copy';
import { ui } from '../ui';
import { formatRemaining, remainingMs, useNow } from './clock';
import type { SectionInfo } from './sections';
import styles from './Test.module.css';

function SectionTimer({ deadlineAtMs, offsetMs }: { deadlineAtMs: number; offsetMs: number }) {
  const now = useNow();
  return (
    <div className={styles.timer}>
      <span className={styles.timerLabel}>{COPY.test.sectionTimeLeft}</span>
      <span role="timer" className={styles.sectionTimerValue} data-testid="section-timer">
        {formatRemaining(remainingMs(deadlineAtMs, offsetMs, now))}
      </span>
    </div>
  );
}

interface Props {
  section: SectionInfo;
  of: number;
  offsetMs: number;
  /** Whether "Finish this section" is offered (an open section of a test with more than one). */
  canFinish: boolean;
  confirming: boolean;
  onAsk(): void;
  onConfirm(): void;
  onCancel(): void;
}

export function SectionBar(props: Props) {
  const { section, of, offsetMs, canFinish, confirming } = props;
  const open = section.state === 'open';
  return (
    <div className={styles.section}>
      <div className={styles.bar}>
        <p className={styles.sectionTitle}>
          {COPY.test.section(section.index + 1, of, section.title)}
        </p>
        {open && section.deadlineAtMs !== undefined ? (
          <SectionTimer deadlineAtMs={section.deadlineAtMs} offsetMs={offsetMs} />
        ) : null}
      </div>
      {open ? (
        <ul className={ui.list}>
          {section.navigation === 'forward_only' ? <li>{COPY.test.forwardOnly}</li> : null}
          {section.pasteRule === 'blocked' ? <li>{COPY.test.pasteBlocked}</li> : null}
          {section.pasteRule === 'allowed_logged' ? <li>{COPY.test.pasteAllowed}</li> : null}
          {section.pasteRule !== undefined ? <li>{COPY.test.dropBlocked}</li> : null}
        </ul>
      ) : (
        <p className={ui.text}>
          {section.state === 'closed' ? COPY.test.sectionClosed : COPY.test.sectionNotOpen}
        </p>
      )}
      {open && canFinish ? (
        confirming ? (
          <div className={styles.confirm}>
            <h2 className={ui.h2}>{COPY.test.finishTitle}</h2>
            <p className={ui.text}>{COPY.test.finishBody}</p>
            <div className={ui.actions}>
              <button type="button" className={ui.button} onClick={props.onConfirm}>
                {COPY.test.finishConfirm}
              </button>
              <button type="button" className={ui.secondary} onClick={props.onCancel}>
                {COPY.test.finishCancel}
              </button>
            </div>
          </div>
        ) : (
          <div className={ui.actions}>
            <button type="button" className={ui.secondary} onClick={props.onAsk}>
              {COPY.test.finishSection}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}

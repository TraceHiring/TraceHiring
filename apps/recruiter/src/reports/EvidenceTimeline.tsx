// Evidence timeline (specs/d1-demo-slice.md §6.1): one lane per signal family over session time, flag markers
// (diamonds) and context markers (circles), plus a keyboard-reachable event list that is the accessible
// equivalent of the picture. Positions are SVG attributes, not style attributes (the CSP allows no inline style).
import { formatOffset } from '../common/format';
import styles from './Report.module.css';
import {
  FAMILIES,
  FAMILY_LABEL,
  SIGNAL_LABEL,
  laneOf,
  observedText,
  type ReadyIntegrity,
} from './labels';

type Entry = ReadyIntegrity['timeline'][number];

const LABEL_W = 132;
const TRACK_W = 440;
const LANE_H = 28;
const WIDTH = LABEL_W + TRACK_W + 16;
const HEIGHT = FAMILIES.length * LANE_H + 24;

function entryText(entry: Entry): string {
  const kind = entry.entryKind === 'flag' ? 'Flag' : 'Context';
  const rule = entry.ruleId === null ? '' : ` · rule ${entry.ruleId}`;
  const times = entry.count > 1 ? ` ×${entry.count}` : '';
  return `${SIGNAL_LABEL[entry.signalKind]}${times} · ${kind}${rule}`;
}

export function EvidenceTimeline({ timeline }: { timeline: readonly Entry[] }) {
  const maxMs = Math.max(60_000, ...timeline.map((entry) => entry.atMs));
  const x = (atMs: number): number => Math.round(LABEL_W + (atMs / maxMs) * TRACK_W);
  return (
    <div className={styles.timeline}>
      <svg
        className={styles.timelineSvg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Evidence timeline by signal family. The event list below has the same entries."
      >
        {FAMILIES.map((family, lane) => {
          const y = lane * LANE_H + LANE_H / 2;
          return (
            <g key={family}>
              <text className={styles.laneLabel} x={0} y={y + 4}>
                {FAMILY_LABEL[family]}
              </text>
              <line
                className={styles.laneTrack}
                x1={LABEL_W}
                x2={LABEL_W + TRACK_W}
                y1={y}
                y2={y}
              />
              {timeline
                .filter((entry) => laneOf(entry) === family)
                .map((entry) =>
                  entry.entryKind === 'flag' ? (
                    <polygon
                      key={entry.position}
                      className={styles.markerFlag}
                      points={`${x(entry.atMs)},${y - 7} ${x(entry.atMs) + 7},${y} ${x(entry.atMs)},${y + 7} ${x(entry.atMs) - 7},${y}`}
                    >
                      <title>{`${entryText(entry)} at ${formatOffset(entry.atMs)}`}</title>
                    </polygon>
                  ) : (
                    <circle
                      key={entry.position}
                      className={styles.markerContext}
                      cx={x(entry.atMs)}
                      cy={y}
                      r={5}
                    >
                      <title>{`${entryText(entry)} at ${formatOffset(entry.atMs)}`}</title>
                    </circle>
                  ),
                )}
            </g>
          );
        })}
        <text className={styles.laneLabel} x={LABEL_W} y={HEIGHT - 4}>
          0:00
        </text>
        <text className={styles.laneLabel} x={LABEL_W + TRACK_W} y={HEIGHT - 4} textAnchor="end">
          {formatOffset(maxMs)}
        </text>
      </svg>
      <p className={styles.legend}>Diamond: flag. Circle: context only.</p>
      {timeline.length === 0 ? (
        <p>No signal events were recorded.</p>
      ) : (
        <details className={styles.eventScroll} open>
          <summary>Event list ({timeline.length})</summary>
          <ol className={styles.eventList}>
            {timeline.map((entry) => (
              <li key={entry.position} className={styles.eventItem}>
                <span className={styles.mono}>{formatOffset(entry.atMs)}</span>{' '}
                <span className={styles.muted}>({entry.atMs} ms)</span> ·{' '}
                {FAMILY_LABEL[laneOf(entry)]} · {entryText(entry)} · {observedText(entry.observed)}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

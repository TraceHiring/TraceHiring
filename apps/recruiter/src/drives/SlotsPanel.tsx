// The slots of a scheduled drive (specs/m2-scheduling-invites.md §3.2 slots, §5 SlotsCreateRequest, §6.1): booked of
// capacity in IST, in cursor pages, and a form that creates slots by generator or by list while the drive is a draft or
// published. Candidates never see these counts (E25); this is the staff view.
import type { SlotView } from '@trace/shared/contracts/m2';
import ui from '../common/Ui.module.css';
import { PagerControls } from './PagerControls';
import type { SlotForm, SlotHow } from './slot-form';
import { SLOT_STATUS_LABEL } from './texts';
import { formatIst } from './time';
import type { PagerState } from './use-pager';
import { driveErrorText } from './messages';

export interface SlotsPanelProps {
  state: PagerState<SlotView>;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious(): void;
  onNext(): void;
  /** False once the drive is closed or cancelled: the list stays, the form goes. */
  canCreate: boolean;
  form: SlotForm;
  problems: readonly string[];
  error: string | null;
  notice: string | null;
  busy: boolean;
  onForm(patch: Partial<SlotForm>): void;
  onCreate(): void;
}

function SlotTable({ rows }: { rows: readonly SlotView[] }) {
  if (rows.length === 0) return <p className={ui.note}>No slots yet.</p>;
  return (
    <table className={ui.table}>
      <thead>
        <tr>
          <th scope="col">Starts (IST)</th>
          <th scope="col">Booked</th>
          <th scope="col">Status</th>
          <th scope="col">Lobby opens</th>
          <th scope="col">Start window</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((slot) => (
          <tr key={slot.id}>
            <th scope="row">{formatIst(slot.startsAt)}</th>
            <td>{`${String(slot.booked)} of ${String(slot.capacity)}`}</td>
            <td>
              {slot.status === 'open' && slot.booked >= slot.capacity
                ? 'Full'
                : SLOT_STATUS_LABEL[slot.status]}
            </td>
            <td>{`${String(slot.lobbyOpensMinutes)} minutes before`}</td>
            <td>{`${String(slot.startWindowMinutes)} minutes`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SlotFormView(props: SlotsPanelProps) {
  const { form } = props;
  return (
    <form
      className={ui.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!props.busy) props.onCreate();
      }}
    >
      <h4 className={ui.subtitle}>Add slots</h4>
      <label className={ui.field}>
        <span className={ui.label}>Add slots by</span>
        <select
          className={ui.select}
          value={form.how}
          onChange={(e) => {
            props.onForm({
              how: (e.target.value === 'list' ? 'list' : 'generator') satisfies SlotHow,
            });
          }}
        >
          <option value="generator">Generator (evenly spaced)</option>
          <option value="list">List of times</option>
        </select>
      </label>
      {form.how === 'generator' ? (
        <>
          <label className={ui.field}>
            <span className={ui.label}>First slot (IST)</span>
            <input
              className={ui.input}
              type="datetime-local"
              value={form.first}
              onChange={(e) => {
                props.onForm({ first: e.target.value });
              }}
            />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Number of slots</span>
            <input
              className={ui.input}
              type="text"
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              value={form.count}
              onChange={(e) => {
                props.onForm({ count: e.target.value });
              }}
            />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>Minutes between slots</span>
            <input
              className={ui.input}
              type="text"
              inputMode="numeric"
              maxLength={5}
              autoComplete="off"
              value={form.interval}
              onChange={(e) => {
                props.onForm({ interval: e.target.value });
              }}
            />
          </label>
        </>
      ) : (
        <label className={ui.field}>
          <span className={ui.label}>Slot times (one per line, IST)</span>
          <textarea
            className={ui.textarea}
            rows={5}
            value={form.lines}
            onChange={(e) => {
              props.onForm({ lines: e.target.value });
            }}
          />
        </label>
      )}
      <label className={ui.field}>
        <span className={ui.label}>Seats per slot</span>
        <input
          className={ui.input}
          type="text"
          inputMode="numeric"
          maxLength={6}
          autoComplete="off"
          value={form.seats}
          onChange={(e) => {
            props.onForm({ seats: e.target.value });
          }}
        />
      </label>
      {form.how === 'list' && (
        <p className={ui.note}>
          Write each time as 2026-11-03 10:00, and add a comma and a number to give that slot its
          own seats.
        </p>
      )}
      {props.problems.length > 0 && (
        <div role="alert" className={ui.alert}>
          <ul>
            {props.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {props.error !== null && (
        <p role="alert" className={ui.alert}>
          {driveErrorText(props.error)}
        </p>
      )}
      <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={props.busy}>
        Create slots
      </button>
    </form>
  );
}

export function SlotsPanel(props: SlotsPanelProps) {
  const { state } = props;
  return (
    <section className={ui.stack} aria-label="Slots">
      <h3 className={ui.subtitle}>Slots</h3>
      {state.kind === 'loading' && <p role="status">Loading slots...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {driveErrorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && <SlotTable rows={state.rows} />}
      <PagerControls
        hasPrevious={props.hasPrevious}
        hasNext={props.hasNext}
        of="slots"
        onPrevious={props.onPrevious}
        onNext={props.onNext}
      />
      {props.notice !== null && <p role="status">{props.notice}</p>}
      {props.canCreate && <SlotFormView {...props} />}
    </section>
  );
}

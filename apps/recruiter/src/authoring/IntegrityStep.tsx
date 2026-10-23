// The integrity step of the test editor, screen 04 (specs/m1-test-authoring.md §6.6, §6.10; R5-6, R5-22, R5-24):
// presets, one control per catalog setting (a radio group or a select, never a checkbox), "Locked by admin" and the
// always-locked settings, "What candidates will see" from the shared renderer, and the static "Data and review" panel
// that follows the plan, not the design's numbers. Nothing here can turn a detector into a flag (rule 3): every value is
// one of the catalog's own, and the focus signals are described as context only. The A2+A5 switch mounts the step in the
// editor; until then it is rendered by tests and the guard registry.
import {
  INTEGRITY_SETTING_VALUES,
  type IntegritySettingsView,
  type PresetKey,
  type SettingKey,
} from '@trace/shared/contracts/m1';
import { useCallback, useState } from 'react';
import type { ApiClient } from '../api/client';
import { getIntegritySettings, putIntegritySettings } from '../api/endpoints';
import { errorText } from '../common/messages';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';
import {
  PRESET_INFO,
  PRESET_KEYS,
  SETTING_INFO,
  SETTING_ORDER,
  applyPreset,
  candidatePreview,
  fromIntegrityView,
  lockOf,
  setSetting,
  takesEffectLater,
  toIntegrityRequest,
  valueLabel,
  type IntegrityState,
} from '../settings/integrity-model';

/** The plan's values (R5-6; plan-conflicts #7, #8), never the design's 90 days / 2 business days. Copy only. */
export function DataAndReviewPanel() {
  return (
    <section className={ui.panel} aria-labelledby="data-and-review">
      <h4 id="data-and-review" className={ui.subtitle}>
        Data and review
      </h4>
      <dl className={ui.stack}>
        <div>
          <dt className={ui.label}>Flag media</dt>
          <dd>Stills and clips kept for a flag are deleted 30 days after the decision.</dd>
        </div>
        <div>
          <dt className={ui.label}>Candidate reply window</dt>
          <dd>72 hours</dd>
        </div>
        <div>
          <dt className={ui.label}>Review time</dt>
          <dd>5 business days</dd>
        </div>
        <div>
          <dt className={ui.label}>Integrity review</dt>
          <dd>Integrity is reviewed for candidates above your cutoff only.</dd>
        </div>
        <div>
          <dt className={ui.label}>Automatic action</dt>
          <dd>Integrity results are never acted on automatically.</dd>
        </div>
      </dl>
    </section>
  );
}

export interface StepMessage {
  kind: 'ok' | 'error';
  text: string;
}

function SettingRow({
  settingKey,
  state,
  readOnly,
  onSet,
}: {
  settingKey: SettingKey;
  state: IntegrityState;
  readOnly: boolean;
  onSet(key: SettingKey, value: string): void;
}) {
  const info = SETTING_INFO[settingKey];
  const lock = lockOf(state, settingKey);
  return (
    <li className={ui.panel}>
      <div className={ui.stack}>
        <label className={ui.field}>
          <span className={ui.label}>{info.label}</span>
          <select
            className={ui.select}
            value={state.values[settingKey]}
            disabled={readOnly || lock !== undefined}
            onChange={(e) => {
              onSet(settingKey, e.target.value);
            }}
          >
            {INTEGRITY_SETTING_VALUES[settingKey].map((value) => (
              <option key={value} value={value}>
                {valueLabel(settingKey, value)}
              </option>
            ))}
          </select>
        </label>
        <p className={ui.note}>{info.description}</p>
        <p className={ui.row}>
          {lock === 'admin' && <span className={ui.note}>Locked by admin</span>}
          {lock === 'always' && <span className={ui.note}>Always locked</span>}
          {info.note !== undefined && <span className={ui.note}>{info.note}</span>}
          {takesEffectLater(settingKey) && lock !== 'always' && (
            <span className={ui.note}>Takes effect when available</span>
          )}
        </p>
      </div>
    </li>
  );
}

export function IntegrityStepView({
  state,
  readOnly,
  busy,
  message,
  onPreset,
  onSet,
  onSave,
}: {
  state: IntegrityState;
  readOnly: boolean;
  busy: boolean;
  message: StepMessage | null;
  onPreset(preset: PresetKey): void;
  onSet(key: SettingKey, value: string): void;
  onSave(): void;
}) {
  return (
    <section className={ui.stack} data-region="integrity-step">
      <h3 className={ui.subtitle}>Integrity settings</h3>
      <p className={ui.note}>
        Choose a preset, then adjust. Settings freeze when you publish; later changes create a new
        version.
      </p>
      <fieldset className={ui.fieldset}>
        <legend className={ui.label}>Preset</legend>
        {PRESET_KEYS.map((preset) => (
          <div key={preset} className={ui.stack}>
            <label className={ui.choice}>
              <input
                type="radio"
                name="integrity-preset"
                checked={state.presetKey === preset}
                disabled={readOnly}
                onChange={() => {
                  onPreset(preset);
                }}
              />
              <span>{PRESET_INFO[preset].label}</span>
            </label>
            <p className={ui.note}>{PRESET_INFO[preset].description}</p>
          </div>
        ))}
        {state.presetKey === null && <p className={ui.note}>Custom settings</p>}
        {SETTING_ORDER.some((k) => lockOf(state, k) === 'admin') && (
          <p className={ui.note}>
            Settings locked by an admin keep their value when you choose a preset.
          </p>
        )}
      </fieldset>
      <ul className={ui.items}>
        {SETTING_ORDER.map((key) => (
          <SettingRow key={key} settingKey={key} state={state} readOnly={readOnly} onSet={onSet} />
        ))}
      </ul>
      <section className={ui.panel} aria-labelledby="what-candidates-see">
        <h4 id="what-candidates-see" className={ui.subtitle}>
          What candidates will see
        </h4>
        <ul>
          {candidatePreview(state).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <DataAndReviewPanel />
      {!readOnly && (
        <div className={ui.row}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={busy}
            onClick={onSave}
          >
            Save settings
          </button>
        </div>
      )}
      {message !== null && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={message.kind === 'error' ? ui.alert : ui.note}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

function Loaded({
  api,
  testId,
  view,
  readOnly,
}: {
  api: ApiClient;
  testId: string;
  view: IntegritySettingsView;
  readOnly: boolean;
}) {
  const [state, setState] = useState<IntegrityState>(() => fromIntegrityView(view));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<StepMessage | null>(null);
  const save = async () => {
    const built = toIntegrityRequest(state);
    if (!built.ok) {
      setMessage({ kind: 'error', text: errorText('bad_request') });
      return;
    }
    setBusy(true);
    const result = await putIntegritySettings(api, testId, built.request);
    setBusy(false);
    if (result.ok) {
      setState(fromIntegrityView(result.data));
      setMessage({ kind: 'ok', text: 'Settings saved.' });
    } else {
      setMessage({ kind: 'error', text: errorText(result.code) });
    }
  };
  return (
    <IntegrityStepView
      state={state}
      readOnly={readOnly}
      busy={busy}
      message={message}
      onPreset={(preset) => {
        setState((s) => applyPreset(s, preset));
      }}
      onSet={(key, value) => {
        setState((s) => setSetting(s, key, value));
      }}
      onSave={() => void save()}
    />
  );
}

/** Loads `GET …/tests/:testId/integrity` and saves with `PUT` (draft only; `readOnly` for a published version). */
export function IntegrityStep({
  api,
  testId,
  readOnly = false,
}: {
  api: ApiClient;
  testId: string;
  readOnly?: boolean;
}) {
  const load = useCallback(() => getIntegritySettings(api, testId), [api, testId]);
  const [state] = useResource(load);
  if (state.kind === 'loading') return <p role="status">Loading...</p>;
  if (state.kind === 'error') {
    return (
      <p role="alert" className={ui.alert}>
        {errorText(state.code)}
      </p>
    );
  }
  return <Loaded api={api} testId={testId} view={state.data} readOnly={readOnly} />;
}

// `/settings/integrity` (admin; specs/m1-test-authoring.md §6.6, screen 04, AT-M1-16): the org's integrity locks.
// An admin locks any setting that is not always locked to one of its own values; the test editor then shows it as
// locked by admin and the server refuses a different value. The always-locked settings (the review scope, accommodations,
// ID verification) are listed with their one value and have no control. Screen access is UX only: the server and RLS
// decide, and a lock needs a two-step sign-in (aal2).
import type { IntegrityLockView, SettingKey } from '@trace/shared/contracts/m1';
import { ALWAYS_LOCKED_SETTINGS, INTEGRITY_SETTING_VALUES } from '@trace/shared/contracts/m1';
import { useEffect, useState } from 'react';
import { createIntegrityLock, deleteIntegrityLock, listIntegrityLocks } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { formatTime } from '../common/format';
import { errorText } from '../common/messages';
import ui from '../common/Ui.module.css';
import { INTEGRITY_PRESETS, SETTING_INFO, lockableKeys, valueLabel } from './integrity-model';

export interface IntegrityLocksViewProps {
  status: 'loading' | 'ready' | 'error';
  locks: readonly IntegrityLockView[];
  /** The value picked for each unlocked setting; the Standard preset's value until the admin picks. */
  drafts: Partial<Record<SettingKey, string>>;
  busy: boolean;
  /** An api failure code, shown as fixed text. */
  error: string | null;
  onDraft(key: SettingKey, value: string): void;
  onLock(key: SettingKey): void;
  onUnlock(key: SettingKey): void;
}

export function IntegrityLocksView(props: IntegrityLocksViewProps) {
  const lockFor = (key: SettingKey) => props.locks.find((l) => l.settingKey === key);
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Integrity settings</h2>
      <p className={ui.note}>
        A locked setting keeps the same value in every new test, and the test editor shows it as
        locked by admin. Tests that are already published do not change.
      </p>
      {props.status === 'loading' && <p role="status">Loading...</p>}
      {props.error !== null && (
        <p role="alert" className={ui.alert}>
          {errorText(props.error)}
        </p>
      )}
      {props.status === 'ready' && (
        <>
          <table className={ui.table}>
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Lock</th>
                <th scope="col">Since</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {lockableKeys().map((key) => {
                const label = SETTING_INFO[key].label;
                const lock = lockFor(key);
                if (lock !== undefined) {
                  return (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      <td>{`Locked to ${valueLabel(key, lock.lockedValue)}`}</td>
                      <td>{formatTime(lock.lockedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className={ui.button}
                          disabled={props.busy}
                          onClick={() => {
                            props.onUnlock(key);
                          }}
                        >
                          {`Remove lock on ${label}`}
                        </button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td>
                      <select
                        className={ui.select}
                        aria-label={`Lock value for ${label}`}
                        value={props.drafts[key] ?? INTEGRITY_PRESETS.standard[key]}
                        disabled={props.busy}
                        onChange={(e) => {
                          props.onDraft(key, e.target.value);
                        }}
                      >
                        {INTEGRITY_SETTING_VALUES[key].map((value) => (
                          <option key={value} value={value}>
                            {valueLabel(key, value)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>Not locked</td>
                    <td>
                      <button
                        type="button"
                        className={ui.button}
                        disabled={props.busy}
                        onClick={() => {
                          props.onLock(key);
                        }}
                      >
                        {`Lock ${label}`}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3 className={ui.subtitle}>Always locked</h3>
          <p className={ui.note}>These settings have one value and cannot be changed or locked.</p>
          <ul className={ui.items}>
            {ALWAYS_LOCKED_SETTINGS.map((key) => (
              <li key={key} className={ui.panel}>
                <span className={ui.label}>{SETTING_INFO[key].label}</span>
                {`: ${valueLabel(key, INTEGRITY_SETTING_VALUES[key][0])}. Always locked.`}
                <p className={ui.note}>{SETTING_INFO[key].description}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function IntegrityLocksRoute() {
  const api = useApi();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [locks, setLocks] = useState<IntegrityLockView[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<SettingKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (api === null) return;
    let live = true;
    void listIntegrityLocks(api).then((result) => {
      if (!live) return;
      if (result.ok) {
        setLocks(result.data.locks);
        setStatus('ready');
      } else {
        setError(result.code);
        setStatus('error');
      }
    });
    return () => {
      live = false;
    };
  }, [api]);

  const lock = async (key: SettingKey) => {
    if (api === null) return;
    setBusy(true);
    setError(null);
    const result = await createIntegrityLock(api, {
      settingKey: key,
      lockedValue: drafts[key] ?? INTEGRITY_PRESETS.standard[key],
    });
    setBusy(false);
    if (result.ok) {
      setLocks((current) => [...current.filter((l) => l.settingKey !== key), result.data]);
    } else {
      setError(result.code);
    }
  };
  const unlock = async (key: SettingKey) => {
    if (api === null) return;
    setBusy(true);
    setError(null);
    const result = await deleteIntegrityLock(api, key);
    setBusy(false);
    if (result.ok) setLocks((current) => current.filter((l) => l.settingKey !== key));
    else setError(result.code);
  };

  return (
    <IntegrityLocksView
      status={status}
      locks={locks}
      drafts={drafts}
      busy={busy}
      error={error}
      onDraft={(key, value) => {
        setDrafts((d) => ({ ...d, [key]: value }));
      }}
      onLock={(key) => void lock(key)}
      onUnlock={(key) => void unlock(key)}
    />
  );
}

export default IntegrityLocksRoute;

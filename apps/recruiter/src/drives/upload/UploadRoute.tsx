// `/drives/:driveId/upload` (specs/m2-scheduling-invites.md §6.2, M2-6, M2-7, R2-12, R5-20, R5-59): picks a CSV, checks it
// in this browser (the file never leaves the device, only rows are sent), computes its SHA-256 with WebCrypto and runs
// the upload through the api client. The parsed rows live in memory for this screen only: nothing from the file goes
// to the console, browser storage or the address bar, and the rows are dropped when the upload ends.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useApi } from '../../api/runtime';
import { checkInviteBytes, refusalBeforeRead } from './file';
import { InviteUploadRun, uploadApiFor, type RunInput } from './run';
import { UploadView, type Screen, type UploadHandlers } from './UploadView';

/** The SHA-256 of the file bytes as lower-case hex (WebCrypto). */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function UploadRoute() {
  const api = useApi();
  const { driveId = '' } = useParams();
  const [screen, setScreen] = useState<Screen>({ kind: 'choose', refusal: null, reading: false });
  const checked = useRef<RunInput | null>(null);
  const run = useRef<InviteUploadRun | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const picked = useRef(0);

  const forget = () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    run.current = null;
    checked.current = null;
  };
  // Leaving the screen ends an upload that is still open (whoever was invited stays invited) and drops the rows.
  useEffect(
    () => () => {
      void run.current?.cancel();
      unsubscribe.current?.();
    },
    [],
  );

  const onFile = (file: File | null) => {
    if (file === null) return;
    forget();
    picked.current += 1;
    const mine = picked.current;
    const early = refusalBeforeRead(file.name, file.size);
    if (early !== null) {
      setScreen({ kind: 'choose', refusal: early, reading: false });
      return;
    }
    setScreen({ kind: 'choose', refusal: null, reading: true });
    void (async () => {
      let bytes: Uint8Array<ArrayBuffer>;
      let fileSha256: string;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
        fileSha256 = await sha256Hex(bytes);
      } catch {
        if (mine === picked.current)
          setScreen({ kind: 'choose', refusal: 'not_csv', reading: false });
        return;
      }
      if (mine !== picked.current) return;
      const result = checkInviteBytes(file.name, bytes);
      if (!result.ok) {
        setScreen({ kind: 'choose', refusal: result.refusal, reading: false });
        return;
      }
      checked.current = {
        fileSha256,
        rowsInFile: result.rowsInFile,
        rows: result.rows,
        issues: result.issues,
      };
      setScreen({
        kind: 'checked',
        rowsInFile: result.rowsInFile,
        sendable: result.rows.length,
        issues: result.issues,
      });
    })();
  };

  const onStart = () => {
    const input = checked.current;
    if (api === null || input === null || driveId === '') return;
    const started = new InviteUploadRun(uploadApiFor(api, driveId), input);
    run.current = started;
    checked.current = null;
    unsubscribe.current = started.subscribe(() => {
      setScreen({ kind: 'run', run: started.getState() });
    });
    setScreen({ kind: 'run', run: started.getState() });
    void started.start();
  };

  const handlers: UploadHandlers = {
    onFile,
    onStart,
    onChooseAnother: () => {
      void run.current?.cancel();
      forget();
      picked.current += 1;
      setScreen({ kind: 'choose', refusal: null, reading: false });
    },
    onCancel: () => void run.current?.cancel(),
    onRetry: () => {
      const current = run.current;
      if (current === null) return;
      void (current.getState().phase === 'failed' ? current.start() : current.retry());
    },
    onMarkDifferent: (rowNo) => void run.current?.markDifferentPerson(rowNo),
    onFinish: () => void run.current?.finish(),
  };

  return <UploadView driveId={driveId} screen={screen} handlers={handlers} />;
}

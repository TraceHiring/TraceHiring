// `/bank/import` (spec §6.9, ABH-9): pick a Trace template file (.xlsx or .docx, plus an optional images .zip for an
// .xlsx), check it in the browser (the worker unzips it under the R5-48 caps, the page parses it), see every bad row,
// then start: the job is created, images and rows are sent, and the user finishes or cancels. The role gate is in
// routes.tsx (staff); the server decides. The heading shows in every state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/runtime';
import { downloadErrorCsv, downloadTemplate } from './csv-download';
import { errorCsv } from './error-csv';
import { ImportView, type ImportHandlers, type Screen } from './ImportView';
import { parseImport, type ParsedImport } from './parse';
import { ImportSession, importApiFor, type RunState } from './run';
import { createImportWorker, type CreateWorker } from './worker-client';

/** A checked or running import carries the name of the file it was made from (not whatever is selected now). */
type Flow =
  | { step: 'choose'; checking: boolean; failure: string | null }
  | { step: 'checked'; parsed: ParsedImport; fileName: string }
  | { step: 'run'; parsed: ParsedImport; fileName: string; state: RunState };

const START: Flow = { step: 'choose', checking: false, failure: null };

interface Selection {
  file: File | null;
  zip: File | null;
}

/** `createWorker` is only for tests; the app passes nothing and gets the bundled worker. */
export function ImportRoute({
  createWorker = createImportWorker,
}: {
  createWorker?: CreateWorker;
}) {
  const api = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [flow, setFlow] = useState<Flow>(START);
  const session = useRef<ImportSession | null>(null);
  /** What is selected right now; a check result is kept only if it was made for exactly this (X4). */
  const selected = useRef<Selection>({ file: null, zip: null });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Choosing a file while a check runs drops that check: its answer belongs to a file that is not selected any more.
  const pick = useCallback((which: 'file' | 'zip', picked: File | null) => {
    selected.current = { ...selected.current, [which]: picked };
    if (which === 'file') setFile(picked);
    else setZip(picked);
    setFlow((now) => (now.step === 'choose' && now.checking ? START : now));
  }, []);

  const check = useCallback(() => {
    if (file === null) return;
    const made: Selection = { file, zip };
    const stale = (): boolean =>
      !live.current || selected.current.file !== made.file || selected.current.zip !== made.zip;
    setFlow({ step: 'choose', checking: true, failure: null });
    parseImport({ file, imagesZip: zip }, { createWorker })
      .then((outcome) => {
        if (stale()) return;
        setFlow(
          outcome.ok
            ? { step: 'checked', parsed: outcome.parsed, fileName: file.name }
            : { step: 'choose', checking: false, failure: outcome.code },
        );
      })
      .catch(() => {
        if (stale()) return;
        setFlow({ step: 'choose', checking: false, failure: 'worker_failed' });
      });
  }, [file, zip, createWorker]);

  const start = useCallback(
    (parsed: ParsedImport, fileName: string) => {
      if (api === null) {
        setFlow({ step: 'choose', checking: false, failure: 'unauthorized' });
        return;
      }
      const next = new ImportSession(parsed, importApiFor(api), {
        onChange: (state) => {
          if (live.current) setFlow({ step: 'run', parsed, fileName, state });
        },
      });
      session.current = next;
      void next.start();
    },
    [api],
  );

  const reset = useCallback(() => {
    session.current = null;
    selected.current = { file: null, zip: null };
    setFile(null);
    setZip(null);
    setFlow(START);
  }, []);

  const issuesNow = (): Parameters<typeof errorCsv>[0] =>
    flow.step === 'run' ? flow.state.issues : flow.step === 'checked' ? flow.parsed.issues : [];

  const handlers: ImportHandlers = {
    onFile: (picked) => {
      pick('file', picked);
    },
    onZip: (picked) => {
      pick('zip', picked);
    },
    onCheck: check,
    onStart: () => {
      if (flow.step === 'checked') start(flow.parsed, flow.fileName);
    },
    onChooseAnother: reset,
    onTryAgain: () => {
      void session.current?.resume();
    },
    onFinish: () => {
      void session.current?.complete();
    },
    onCancel: () => {
      void session.current?.cancel();
    },
    onDownloadErrors: () => {
      downloadErrorCsv(errorCsv(issuesNow()));
    },
    onDownloadTemplate: (kind) => {
      downloadTemplate(kind);
    },
  };

  let screen: Screen;
  if (flow.step === 'choose') {
    screen = {
      kind: 'choose',
      fileName: file?.name ?? null,
      zipName: zip?.name ?? null,
      checking: flow.checking,
      failure: flow.failure,
    };
  } else if (flow.step === 'checked') {
    const { parsed } = flow;
    screen = {
      kind: 'checked',
      sourceKind: parsed.sourceKind,
      fileName: flow.fileName,
      rowsRead: parsed.rowsRead,
      rowsReady: parsed.rows.length,
      imagesInFile: parsed.imagesInFile,
      issues: parsed.issues,
    };
  } else {
    screen = {
      kind: 'run',
      sourceKind: flow.parsed.sourceKind,
      fileName: flow.fileName,
      rowsRead: flow.parsed.rowsRead,
      state: flow.state,
    };
  }
  return <ImportView screen={screen} handlers={handlers} />;
}

export default ImportRoute;

// `/bank/import` (spec §6.9, ABH-9): pick a Trace template file (.xlsx or .docx, plus an optional images .zip for an
// .xlsx), check it in the browser (the worker unzips it under the R5-48 caps, the page parses it), see every bad row,
// then start: the job is created, images and rows are sent, and the user finishes or cancels. The role gate is in
// routes.tsx (staff); the server decides. The heading shows in every state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/runtime';
import { downloadErrorCsv } from './csv-download';
import { errorCsv } from './error-csv';
import { ImportView, type ImportHandlers, type Screen } from './ImportView';
import { parseImport, type ParsedImport } from './parse';
import { ImportSession, importApiFor, type RunState } from './run';
import { createImportWorker, type CreateWorker } from './worker-client';

type Flow =
  | { step: 'choose'; checking: boolean; failure: string | null }
  | { step: 'checked'; parsed: ParsedImport }
  | { step: 'run'; parsed: ParsedImport; state: RunState };

const START: Flow = { step: 'choose', checking: false, failure: null };

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
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const check = useCallback(() => {
    if (file === null) return;
    setFlow({ step: 'choose', checking: true, failure: null });
    void parseImport({ file, imagesZip: zip }, { createWorker }).then((outcome) => {
      if (!live.current) return;
      setFlow(
        outcome.ok
          ? { step: 'checked', parsed: outcome.parsed }
          : { step: 'choose', checking: false, failure: outcome.code },
      );
    });
  }, [file, zip, createWorker]);

  const start = useCallback(
    (parsed: ParsedImport) => {
      if (api === null) {
        setFlow({ step: 'choose', checking: false, failure: 'unauthorized' });
        return;
      }
      const next = new ImportSession(parsed, importApiFor(api), {
        onChange: (state) => {
          if (live.current) setFlow({ step: 'run', parsed, state });
        },
      });
      session.current = next;
      void next.start();
    },
    [api],
  );

  const reset = useCallback(() => {
    session.current = null;
    setFile(null);
    setZip(null);
    setFlow(START);
  }, []);

  const issuesNow = (): Parameters<typeof errorCsv>[0] =>
    flow.step === 'run' ? flow.state.issues : flow.step === 'checked' ? flow.parsed.issues : [];

  const handlers: ImportHandlers = {
    onFile: setFile,
    onZip: setZip,
    onCheck: check,
    onStart: () => {
      if (flow.step === 'checked') start(flow.parsed);
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
      fileName: file?.name ?? '',
      rowsRead: parsed.rowsRead,
      rowsReady: parsed.rows.length,
      imagesInFile: parsed.imagesInFile,
      issues: parsed.issues,
    };
  } else {
    screen = {
      kind: 'run',
      sourceKind: flow.parsed.sourceKind,
      fileName: file?.name ?? '',
      rowsRead: flow.parsed.rowsRead,
      state: flow.state,
    };
  }
  return <ImportView screen={screen} handlers={handlers} />;
}

export default ImportRoute;

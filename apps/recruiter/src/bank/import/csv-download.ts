// Saves a file the page made itself (spec §6.9): the error list (made in the browser from the codes) and the two Trace
// template files. The only place in the import code that makes a Blob URL; each Blob is made on the page from fixed
// content, never from a file the user picked, and its URL is revoked right after the click. Nothing is sent anywhere.
import { ERROR_CSV_NAME } from './error-csv';
import {
  TEMPLATE_FILES,
  TEMPLATE_MIME,
  buildTemplateFile,
  type TemplateKind,
} from './template-files';

export interface DownloadEnv {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createLink(): { href: string; download: string; click(): void };
}

const browserEnv = (): DownloadEnv => ({
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => {
    URL.revokeObjectURL(url);
  },
  createLink: () => document.createElement('a'),
});

function save(blob: Blob, name: string, env: DownloadEnv): void {
  const url = env.createObjectURL(blob);
  try {
    const link = env.createLink();
    link.href = url;
    link.download = name;
    link.click();
  } finally {
    env.revokeObjectURL(url);
  }
}

export function downloadErrorCsv(csv: string, env: DownloadEnv = browserEnv()): void {
  save(new Blob([csv], { type: 'text/csv;charset=utf-8' }), ERROR_CSV_NAME, env);
}

/** The Trace template of this kind, trace-items-v1.xlsx or trace-items-v1.docx. */
export function downloadTemplate(kind: TemplateKind, env: DownloadEnv = browserEnv()): void {
  save(
    new Blob([buildTemplateFile(kind)], { type: TEMPLATE_MIME[kind] }),
    TEMPLATE_FILES[kind],
    env,
  );
}

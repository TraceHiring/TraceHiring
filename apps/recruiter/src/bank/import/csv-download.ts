// Saves the error list as a file (spec §6.9: made in the browser from the codes). The only place in the import code
// that makes a Blob URL, and the Blob is plain text that is revoked at once; nothing is sent anywhere.
import { ERROR_CSV_NAME } from './error-csv';

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

export function downloadErrorCsv(csv: string, env: DownloadEnv = browserEnv()): void {
  const url = env.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  try {
    const link = env.createLink();
    link.href = url;
    link.download = ERROR_CSV_NAME;
    link.click();
  } finally {
    env.revokeObjectURL(url);
  }
}

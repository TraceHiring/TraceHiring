// Captions and pauses for the D1 recording (specs/d1-demo-slice.md §7.3). Only in record mode (E2E_RECORD=1):
// `caption(page, step)` puts a fixed banner with the step name at the top of the page, and `pause(page)` holds the
// frame for 3 s. Outside record mode both do nothing. A caption is a step name, never a value read from the run
// (no email, code, token or link). Text checks read the page without the banner (support/candidate-ui.ts
// `visibleText`), and the banner is aria-hidden, so it never counts as page content.
import type { Page } from '@playwright/test';

export const RECORDING = process.env['E2E_RECORD'] === '1';
const PAUSE_MS = 3_000;

/** Shows `text` in the banner (record mode only); the banner is re-created after a navigation. */
export const caption = async (page: Page, text: string): Promise<void> => {
  if (!RECORDING || page.isClosed()) return;
  await page
    .evaluate((value) => {
      let banner = document.getElementById('e2e-caption');
      if (banner === null) {
        banner = document.createElement('div');
        banner.id = 'e2e-caption';
        banner.setAttribute('aria-hidden', 'true');
        Object.assign(banner.style, {
          position: 'fixed',
          top: '0',
          left: '0',
          right: '0',
          zIndex: '2147483647',
          padding: '8px 16px',
          font: '600 16px/1.4 system-ui, sans-serif',
          color: '#ffffff',
          background: 'rgba(17, 24, 39, 0.88)',
          pointerEvents: 'none',
        });
        document.body.appendChild(banner);
      }
      banner.textContent = value;
    }, text)
    .catch(() => undefined);
};

/** Holds the frame for 3 s in record mode (two cards, the Review flag, the below-cutoff card, the reviewer view). */
export const pause = async (page: Page): Promise<void> => {
  if (!RECORDING || page.isClosed()) return;
  await page.waitForTimeout(PAUSE_MS);
};

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App, PRODUCT_NAME } from './App';
import { APP_VERSION } from './version';

describe('candidate App shell', () => {
  it('renders the product name and the version', () => {
    const html = renderToString(<App />);
    expect(PRODUCT_NAME).toBe('Trace');
    expect(html).toMatch(/<h1[^>]*>Trace<\/h1>/);
    expect(APP_VERSION).toMatch(/^[0-9a-f]{7,40}$|^dev$/);
    expect(html).toContain(`Version ${APP_VERSION}`);
  });

  it('has a main landmark and no inline style (CSP style-src self, spec §10.3)', () => {
    const html = renderToString(<App />);
    expect(html).toMatch(/^<main[ >]/);
    expect(html).not.toMatch(/\sstyle=/);
  });
});

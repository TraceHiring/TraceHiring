import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App, APP_VERSION, PRODUCT_NAME } from './App';

describe('candidate App shell', () => {
  it('renders the product name and the version', () => {
    const html = renderToString(<App />);
    expect(PRODUCT_NAME).toBe('Trace');
    expect(html).toContain('<h1>Trace</h1>');
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(html).toContain(APP_VERSION);
  });
});

import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from './App';
import { routes } from './routes';

function renderAt(path: string): string {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return renderToString(<RouterProvider router={router} />);
}

describe('recruiter App shell', () => {
  it('renders the product name at "/"', () => {
    const html = renderAt('/');
    expect(PRODUCT_NAME).toBe('Trace');
    expect(html).toContain('<h1>Trace</h1>');
    expect(html).toContain('Recruiter workspace');
  });

  it('renders the health route at "/health"', () => {
    const html = renderAt('/health');
    expect(html).toContain('<h1>Trace</h1>');
    expect(html).toContain('Status: ok');
  });
});

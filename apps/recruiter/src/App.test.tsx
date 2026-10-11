import { renderToString } from 'react-dom/server';
import {
  createMemoryRouter,
  createStaticHandler,
  createStaticRouter,
  RouterProvider,
  StaticRouterProvider,
} from 'react-router';
import type { RouteObject } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from './App';
import { routes } from './routes';
import { APP_VERSION } from './version';

function renderAt(path: string): string {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return renderToString(<RouterProvider router={router} />);
}

/** Renders `table` at `path` the way a server would, so loader errors reach the error element. */
async function renderStatic(table: RouteObject[], path: string): Promise<string> {
  const { query, dataRoutes } = createStaticHandler(table);
  const context = await query(new Request(`http://localhost${path}`));
  if (context instanceof Response) throw new Error('unexpected redirect');
  const router = createStaticRouter(dataRoutes, context);
  return renderToString(<StaticRouterProvider router={router} context={context} hydrate={false} />);
}

describe('recruiter App shell', () => {
  it('renders the product name and the version at "/"', () => {
    const html = renderAt('/');
    expect(PRODUCT_NAME).toBe('Trace');
    expect(html).toMatch(/<h1[^>]*>Trace<\/h1>/);
    expect(html).toContain('Recruiter workspace');
    expect(html).toContain(`Version ${APP_VERSION}`);
  });

  it('renders the health route at "/health"', () => {
    const html = renderAt('/health');
    expect(html).toMatch(/<h1[^>]*>Trace<\/h1>/);
    expect(html).toContain('Status: ok');
  });

  it('has no inline style (CSP style-src self, spec §10.3)', () => {
    expect(renderAt('/')).not.toMatch(/\sstyle=/);
    expect(renderAt('/health')).not.toMatch(/\sstyle=/);
  });

  it('shows a generic message, never the error text, when a route throws', async () => {
    const secret = `${'q7w8e9'}@${'example'}.test`;
    const root = routes[0];
    expect(root?.errorElement).toBeDefined();
    // The real root route (layout and error element) with one extra child whose loader throws.
    const table: RouteObject[] = [
      {
        path: '/',
        element: root?.element,
        errorElement: root?.errorElement,
        children: [
          {
            path: 'boom',
            loader: () => {
              throw new Error(`failed for ${secret}`);
            },
            element: <p>never rendered</p>,
          },
        ],
      },
    ];
    const html = await renderStatic(table, '/boom');
    expect(html).toContain('Something went wrong');
    expect(html).not.toContain(secret);
    expect(html).not.toContain('failed for');
    expect(html).not.toContain('never rendered');
  });
});

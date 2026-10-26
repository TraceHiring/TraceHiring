// Helpers for the happy-dom behaviour tests of the A5c screens (React 19 `act`, no testing-library): mount, click,
// type, select, and an ApiClient over a routed fake fetch that records every call. Synthetic data only.
import { act, type ReactElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { ApiClient } from '../api/client';
import { ApiContext, OrgInfoContext, type OrgInfo } from '../api/runtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const ORG = '11111111-1111-4111-8111-111111111111';
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export interface Call {
  method: string;
  /** Path below `/v1/orgs/:orgId`, without the query. */
  path: string;
  query: string;
  body: unknown;
}
export type Reply = { status?: number; body?: unknown };
export type Routes = Record<string, (call: Call) => Reply>;

/** An api client over a fake fetch. A route is keyed `METHOD /path`; an unknown route answers 404 not_found. */
export function fakeApi(routes: Routes): { api: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const api = new ApiClient({
    origin: 'https://trace-api-staging.example-sub.workers.dev',
    orgId: ORG,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: (url, init) => {
      const u = new URL(url);
      const path = u.pathname.replace(`/v1/orgs/${ORG}`, '');
      const call: Call = {
        method: init.method ?? 'GET',
        path,
        query: u.search,
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      const route = routes[`${call.method} ${path}`];
      const reply: Reply =
        route === undefined ? { status: 404, body: { error: { code: 'not_found' } } } : route(call);
      const status = reply.status ?? 200;
      return Promise.resolve(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify(reply.body), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
      );
    },
  });
  return { api, calls };
}

export interface Mounted {
  container: HTMLElement;
  unmount(): Promise<void>;
}

export const info = (roles: string[]): OrgInfo => ({
  orgId: ORG,
  orgName: 'Synthetic Staffing',
  userId: uuid(7),
  roles,
});

/** Mounts `element` in a router (at `at`) with the api and the org info of the given roles. */
export async function mountScreen(
  element: ReactElement,
  api: ApiClient | null,
  roles: string[] = ['admin'],
  at = '/',
): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const tree: ReactNode = (
    <MemoryRouter initialEntries={[at]}>
      <OrgInfoContext value={info(roles)}>
        <ApiContext value={api}>{element}</ApiContext>
      </OrgInfoContext>
    </MemoryRouter>
  );
  await act(async () => {
    root.render(tree);
  });
  await settle();
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Lets pending promises run inside act. */
export const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
};

export const click = async (el: Element): Promise<void> => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};

export const typeInto = async (
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> => {
  await act(async () => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

export const choose = async (el: HTMLSelectElement, value: string): Promise<void> => {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

export const button = (root: ParentNode, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  if (found === undefined) throw new Error(`no button "${label}"`);
  return found;
};

/** The control inside the <label> whose first <span> reads exactly `label`. */
export const field = <T extends HTMLElement>(root: ParentNode, label: string): T => {
  const lab = [...root.querySelectorAll('label')].find(
    (l) => l.querySelector('span')?.textContent === label,
  );
  const el = lab?.querySelector('input, select, textarea');
  if (el === null || el === undefined) throw new Error(`no field "${label}"`);
  return el as unknown as T;
};

export const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

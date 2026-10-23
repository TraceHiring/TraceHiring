// A small DOM harness for the M1 bank and library screens: mounts a screen under happy-dom with a router, an
// api client and the signed-in org, and drives it like a person (type, choose, click) with a fake fetch behind it.
// Test files using it start with `// @vitest-environment happy-dom`. Synthetic data only.
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ApiClient } from '../../api/client';
import { ApiContext, OrgInfoContext, type OrgInfo } from '../../api/runtime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface Mounted {
  container: HTMLElement;
  text(): string;
  settle(): Promise<void>;
  click(target: Element): Promise<void>;
  type(target: Element, value: string): Promise<void>;
  choose(target: Element, value: string): Promise<void>;
  submit(form: Element): Promise<void>;
  button(label: string | RegExp): HTMLButtonElement;
  maybeButton(label: string | RegExp): HTMLButtonElement | null;
  field(label: string | RegExp): Control;
  links(): string[];
  unmount(): void;
}

const matches = (text: string, label: string | RegExp): boolean =>
  typeof label === 'string' ? text.trim() === label : label.test(text);

const nameOf = (el: Element): string => el.getAttribute('aria-label') ?? el.textContent;

export async function mountScreen(
  screen: ReactNode,
  options: {
    api: ApiClient | null;
    info: OrgInfo | null;
    at?: string;
    path?: string;
    /** More routes in the same app, so a screen can navigate to another one. */
    extra?: { path: string; element: ReactNode }[];
  },
): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const tree = (
    <MemoryRouter initialEntries={[options.at ?? '/']}>
      <OrgInfoContext value={options.info}>
        <ApiContext value={options.api}>
          <Routes>
            <Route path={options.path ?? '*'} element={screen} />
            {(options.extra ?? []).map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Routes>
        </ApiContext>
      </OrgInfoContext>
    </MemoryRouter>
  );
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        // setImmediate, so a test that fakes setTimeout (polling) can still settle.
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
      });
    }
  };
  const mounted: Mounted = {
    container,
    text: () => container.textContent.replace(/\s+/g, ' '),
    settle,
    click: async (target) => {
      await act(async () => {
        (target as HTMLElement).click();
      });
      await settle();
    },
    type: async (target, value) => {
      await act(async () => {
        const proto =
          target instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(target, value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    choose: async (target, value) => {
      await act(async () => {
        if (target instanceof HTMLInputElement) {
          target.click();
          return;
        }
        (target as HTMLSelectElement).value = value;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    submit: async (form) => {
      await act(async () => {
        (form as HTMLFormElement).requestSubmit();
      });
      await settle();
    },
    button: (label) => {
      const found = [...container.querySelectorAll('button')].find((el) =>
        matches(nameOf(el), label),
      );
      if (found === undefined) throw new Error(`no button "${String(label)}"`);
      return found;
    },
    maybeButton: (label) =>
      [...container.querySelectorAll('button')].find((el) => matches(nameOf(el), label)) ?? null,
    field: (label) => {
      const wrapper = [...container.querySelectorAll('label')].find((el) =>
        matches(el.querySelector('span')?.textContent ?? el.textContent, label),
      );
      const control = wrapper?.querySelector('input, textarea, select');
      if (control === null || control === undefined) throw new Error(`no field "${String(label)}"`);
      return control as Control;
    },
    links: () => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? ''),
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
  await act(async () => {
    root.render(tree);
  });
  await settle();
  return mounted;
}

/** The first element of `selector` inside `scope`, or a loud failure. */
export function pick<T extends Element = HTMLElement>(scope: ParentNode, selector: string): T {
  const found = scope.querySelector<T>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

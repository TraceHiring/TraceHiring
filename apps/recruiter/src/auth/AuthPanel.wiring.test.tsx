// AT-B11 (specs/m0b-tenancy.md §7), the wiring side: which form and which button calls which
// `AuthFlow` method, with which arguments, in which order. There is no DOM here (no jsdom), so the
// view is called as a function with a fixed `useId`, its element tree is walked, and the real
// `onSubmit` / `onClick` props are called with a stub event that reads from a built `FormData`.
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { OrgRow } from '@trace/shared/contracts/tenancy';
import {
  AuthView,
  buttonHandlers,
  fields,
  formHandlers,
  type AuthActions,
  type ReadForm,
} from './AuthPanel';
import type { AuthState } from './flow';
import { ORG_A, ORG_B, org } from './testing/fake-supabase';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useId: () => 'test-id' };
});

const EMAIL = 'recruiter.three@example.test';
const SECRET_WORD = 'synthetic-pass-phrase';
const ACME = org(ORG_A, 'Acme Hiring') as OrgRow;
const BETA = org(ORG_B, 'Beta Hiring') as OrgRow;

function recorder() {
  const actions = {
    submitEmail: vi.fn(),
    submitOtp: vi.fn(),
    submitPassword: vi.fn(),
    submitTotp: vi.fn(),
    pickOrg: vi.fn(),
    retry: vi.fn(),
    signOut: vi.fn(),
  } satisfies AuthActions;
  /** Every action name that was called at all. */
  const called = (): string[] =>
    Object.entries(actions)
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([name]) => name);
  return { actions, called };
}

/** A `ReadForm` that answers with the given text fields, as the browser would for the form. */
function formOf(values: Record<string, string>): { read: ReadForm; marker: HTMLFormElement } {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.append(name, value);
  const marker = { synthetic: 'form' } as unknown as HTMLFormElement;
  return {
    marker,
    read: (form) => {
      expect(form).toBe(marker);
      return data;
    },
  };
}

function submitEvent(currentTarget: HTMLFormElement) {
  return { preventDefault: vi.fn(), currentTarget };
}

interface Host {
  type: string;
  props: { children?: ReactNode; onSubmit?: unknown; onClick?: unknown; disabled?: boolean };
}

/** The host elements (`form`, `button`, …) of a view, in document order; components are called. */
function hosts(node: ReactNode, out: Host[] = []): Host[] {
  if (Array.isArray(node)) {
    for (const child of node) hosts(child as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement<Host['props']>;
  if (typeof element.type === 'function') {
    return hosts((element.type as (props: unknown) => ReactNode)(element.props), out);
  }
  if (typeof element.type === 'string') out.push({ type: element.type, props: element.props });
  return hosts(element.props.children, out);
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((child) => textOf(child as ReactNode)).join('');
  return isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : '';
}

function view(state: AuthState, actions: AuthActions, read: ReadForm = () => new FormData()) {
  const tree = AuthView({ snapshot: { state, busy: false }, actions, readForm: read });
  const all = hosts(tree);
  return {
    forms: all.filter((host) => host.type === 'form'),
    button: (label: string): Host => {
      const found = all.find(
        (host) => host.type === 'button' && textOf(host.props.children) === label,
      );
      if (found === undefined) throw new Error(`no button labelled ${label}`);
      return found;
    },
  };
}

const submit = (form: Host | undefined, target: HTMLFormElement) => {
  const event = submitEvent(target);
  (form?.props.onSubmit as (e: typeof event) => void)(event);
  return event;
};
const click = (button: Host) => (button.props.onClick as () => void)();

describe('fields: the shared submit handler', () => {
  it('prevents the default submit and passes the named fields, in the order of the names', () => {
    const { read, marker } = formOf({ password: SECRET_WORD, email: EMAIL });
    const handler = vi.fn();
    const event = submitEvent(marker);
    fields(['email', 'password'], handler, read)(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledExactlyOnceWith(EMAIL, SECRET_WORD);
  });

  it('passes an empty string for a field that is missing or is not text', () => {
    const data = new FormData();
    data.append('upload', new Blob(['x']), 'x.txt');
    const handler = vi.fn();
    const marker = {} as HTMLFormElement;
    fields(['absent', 'upload'], handler, () => data)(submitEvent(marker));
    expect(handler).toHaveBeenCalledExactlyOnceWith('', '');
  });
});

describe('formHandlers: one handler per form, each calling its own action', () => {
  it('password form → submitPassword(email, password), in that order', () => {
    const { actions, called } = recorder();
    const { read, marker } = formOf({ email: EMAIL, password: SECRET_WORD });
    const event = submitEvent(marker);
    formHandlers(actions, read).password(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.submitPassword).toHaveBeenCalledExactlyOnceWith(EMAIL, SECRET_WORD);
    expect(called()).toEqual(['submitPassword']);
  });

  it('email form → submitEmail(email) only', () => {
    const { actions, called } = recorder();
    const { read, marker } = formOf({ email: EMAIL, password: SECRET_WORD });
    const event = submitEvent(marker);
    formHandlers(actions, read).email(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.submitEmail).toHaveBeenCalledExactlyOnceWith(EMAIL);
    expect(called()).toEqual(['submitEmail']);
  });

  it('email-code form → submitOtp(code) only', () => {
    const { actions, called } = recorder();
    const { read, marker } = formOf({ code: '246810' });
    const event = submitEvent(marker);
    formHandlers(actions, read).otp(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.submitOtp).toHaveBeenCalledExactlyOnceWith('246810');
    expect(called()).toEqual(['submitOtp']);
  });

  it('authenticator-code form → submitTotp(code) only', () => {
    const { actions, called } = recorder();
    const { read, marker } = formOf({ code: '135791' });
    const event = submitEvent(marker);
    formHandlers(actions, read).totp(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.submitTotp).toHaveBeenCalledExactlyOnceWith('135791');
    expect(called()).toEqual(['submitTotp']);
  });
});

describe('buttonHandlers: each button calls its own action', () => {
  it('retry, signOut and pickOrg(id) are bound to the matching action', () => {
    const { actions, called } = recorder();
    const buttons = buttonHandlers(actions);
    buttons.retry();
    expect(called()).toEqual(['retry']);
    buttons.signOut();
    expect(called()).toEqual(['retry', 'signOut']);
    buttons.pickOrg(ORG_B)();
    expect(actions.pickOrg).toHaveBeenCalledExactlyOnceWith(ORG_B);
    expect(actions.retry).toHaveBeenCalledTimes(1);
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('AuthView: the rendered forms and buttons use those handlers', () => {
  it('signed_out: the first form is the email-code form, the second the password form', () => {
    const { actions, called } = recorder();
    const { read, marker } = formOf({ email: EMAIL, password: SECRET_WORD });
    const { forms } = view({ kind: 'signed_out' }, actions, read);
    expect(forms).toHaveLength(2);
    const first = submit(forms[0], marker);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.submitEmail).toHaveBeenCalledExactlyOnceWith(EMAIL);
    expect(called()).toEqual(['submitEmail']);
    const second = submit(forms[1], marker);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
    expect(actions.submitPassword).toHaveBeenCalledExactlyOnceWith(EMAIL, SECRET_WORD);
    expect(called().sort()).toEqual(['submitEmail', 'submitPassword']);
  });

  it('code_sent: the form calls submitOtp(code); Start again calls signOut', () => {
    const { actions, called } = recorder();
    const { read, marker } = formOf({ code: '246810' });
    const { forms, button } = view({ kind: 'code_sent', email: EMAIL }, actions, read);
    expect(forms).toHaveLength(1);
    submit(forms[0], marker);
    expect(actions.submitOtp).toHaveBeenCalledExactlyOnceWith('246810');
    expect(called()).toEqual(['submitOtp']);
    click(button('Start again'));
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });

  for (const state of [
    { kind: 'totp_enrol', factorId: 'f', qrCode: null, secret: 'S' },
    { kind: 'totp_challenge', factorId: 'f' },
  ] as const) {
    it(`${state.kind}: the form calls submitTotp(code); Sign out calls signOut`, () => {
      const { actions, called } = recorder();
      const { read, marker } = formOf({ code: '135791' });
      const { forms, button } = view(state, actions, read);
      expect(forms).toHaveLength(1);
      submit(forms[0], marker);
      expect(actions.submitTotp).toHaveBeenCalledExactlyOnceWith('135791');
      expect(called()).toEqual(['submitTotp']);
      click(button('Sign out'));
      expect(actions.signOut).toHaveBeenCalledTimes(1);
    });
  }

  for (const kind of ['session_aal1', 'session_aal2'] as const)
    it(`${kind} with an error: Try again calls retry, Sign out calls signOut`, () => {
      const { actions, called } = recorder();
      const { button } = view({ kind, error: 'generic' }, actions);
      click(button('Try again'));
      expect(called()).toEqual(['retry']);
      click(button('Sign out'));
      expect(called().sort()).toEqual(['retry', 'signOut']);
    });

  it('org_picker: each org button calls pickOrg with that org id; Sign out calls signOut', () => {
    const { actions, called } = recorder();
    const { button } = view({ kind: 'org_picker', orgs: [ACME, BETA] }, actions);
    click(button(BETA.name));
    expect(actions.pickOrg).toHaveBeenLastCalledWith(BETA.id);
    click(button(ACME.name));
    expect(actions.pickOrg).toHaveBeenLastCalledWith(ACME.id);
    expect(actions.pickOrg).toHaveBeenCalledTimes(2);
    expect(called()).toEqual(['pickOrg']);
    click(button('Sign out'));
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });

  for (const state of [{ kind: 'no_org' }, { kind: 'signed_in', org: ACME }] as const)
    it(`${state.kind}: Sign out calls signOut and nothing else`, () => {
      const { actions, called } = recorder();
      click(view(state, actions).button('Sign out'));
      expect(called()).toEqual(['signOut']);
    });
});

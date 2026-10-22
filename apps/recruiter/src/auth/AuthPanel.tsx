// The recruiter sign-in screens (specs/m0b-tenancy.md §4.2, §4.6). `AuthView` renders one state of
// the flow and calls the flow's actions; it shows only the fixed messages below, never text from
// the server. The enrolment QR is the SVG data URL Supabase returns, shown as an <img>.
import { useContext, useId, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { AuthFlowContext } from './auth-context';
import styles from './AuthPanel.module.css';
import type { AuthErrorKind, AuthSnapshot } from './flow';

export const UNCONFIGURED_MESSAGE = 'Sign-in is not configured for this build';

/** The only error texts the sign-in screens show (§4.2: generic, never the server's). */
export const ERROR_MESSAGES: Readonly<Record<AuthErrorKind, string>> = {
  code: "That code didn't work. Try again.",
  generic: "That didn't work. Try again.",
  invalid_email: 'Enter a valid email address.',
  invalid_code: 'Enter the 6-digit code.',
  invalid_password: 'Passwords are 12 to 128 characters long.',
};

/** What the view may ask of the flow (`AuthFlow` implements it). */
export interface AuthActions {
  submitEmail(email: string): unknown;
  submitOtp(code: string): unknown;
  submitPassword(email: string, password: string): unknown;
  submitTotp(code: string): unknown;
  pickOrg(orgId: string): unknown;
  retry(): unknown;
  signOut(): unknown;
}

/** Reads a submitted form's fields; the browser's `FormData`, replaceable in tests (no DOM). */
export type ReadForm = (form: HTMLFormElement) => FormData;
const readFormData: ReadForm = (form) => new FormData(form);

/** A submit handler that passes the named fields' text to `handler`, in the order of `names`. */
export function fields(
  names: readonly string[],
  handler: (...values: string[]) => unknown,
  read: ReadForm = readFormData,
) {
  return (event: Pick<FormEvent<HTMLFormElement>, 'preventDefault' | 'currentTarget'>) => {
    event.preventDefault();
    const data = read(event.currentTarget);
    handler(
      ...names.map((name) => {
        const value = data.get(name);
        return typeof value === 'string' ? value : '';
      }),
    );
  };
}

/** The submit handler of each form on the sign-in screens, and the action it calls. */
export function formHandlers(actions: AuthActions, read?: ReadForm) {
  return {
    email: fields(['email'], (email) => actions.submitEmail(email), read),
    password: fields(
      ['email', 'password'],
      (email, password) => actions.submitPassword(email, password),
      read,
    ),
    otp: fields(['code'], (code) => actions.submitOtp(code), read),
    totp: fields(['code'], (code) => actions.submitTotp(code), read),
  };
}

/** The click handler of each button on the sign-in screens, and the action it calls. */
export function buttonHandlers(actions: AuthActions) {
  return {
    retry: () => void actions.retry(),
    signOut: () => void actions.signOut(),
    pickOrg: (orgId: string) => () => void actions.pickOrg(orgId),
  };
}

function ErrorLine({ error }: { error: AuthErrorKind | undefined }) {
  if (error === undefined) return null;
  return (
    <p role="alert" className={styles.alert}>
      {ERROR_MESSAGES[error]}
    </p>
  );
}

function Button({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type={onClick ? 'button' : 'submit'}
      className={styles.button}
      disabled={busy}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CodeForm({
  busy,
  label,
  submit,
  onSubmit,
}: {
  busy: boolean;
  label: string;
  submit: string;
  onSubmit: ReturnType<typeof fields>;
}) {
  const id = useId();
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        className={styles.input}
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        required
      />
      <Button busy={busy}>{submit}</Button>
    </form>
  );
}

export function AuthView({
  snapshot,
  actions,
  readForm,
}: {
  snapshot: AuthSnapshot;
  actions: AuthActions;
  /** Only tests pass this (no DOM there); the page reads the real form. */
  readForm?: ReadForm;
}) {
  const { state, busy } = snapshot;
  const forms = formHandlers(actions, readForm);
  const buttons = buttonHandlers(actions);
  const otpEmailId = useId();
  const passwordEmailId = useId();
  const passwordId = useId();
  const signOut = (label = 'Sign out') => (
    <Button busy={busy} onClick={buttons.signOut}>
      {label}
    </Button>
  );

  switch (state.kind) {
    case 'unconfigured':
      return (
        <section className={styles.panel}>
          <p>{UNCONFIGURED_MESSAGE}</p>
        </section>
      );
    case 'starting':
      return (
        <section className={styles.panel}>
          <p role="status">Checking your sign-in…</p>
        </section>
      );
    case 'signed_out':
      return (
        <section className={styles.panel}>
          <h2 className={styles.heading}>Sign in</h2>
          <ErrorLine error={state.error} />
          <form className={styles.form} onSubmit={forms.email}>
            <label className={styles.label} htmlFor={otpEmailId}>
              Work email
            </label>
            <input
              className={styles.input}
              id={otpEmailId}
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
            />
            <Button busy={busy}>Email me a code</Button>
          </form>
          <form className={styles.form} onSubmit={forms.password}>
            <p className={styles.note}>
              Or sign in with a password. You will also need an authenticator app.
            </p>
            <label className={styles.label} htmlFor={passwordEmailId}>
              Work email
            </label>
            <input
              className={styles.input}
              id={passwordEmailId}
              name="email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
            />
            <label className={styles.label} htmlFor={passwordId}>
              Password
            </label>
            <input
              className={styles.input}
              id={passwordId}
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
            />
            <Button busy={busy}>Sign in with password</Button>
          </form>
        </section>
      );
    case 'code_sent':
      return (
        <section className={styles.panel}>
          <h2 className={styles.heading}>Check your email</h2>
          <p>We sent a 6-digit code to {state.email}.</p>
          <ErrorLine error={state.error} />
          <CodeForm busy={busy} label="Code" submit="Verify code" onSubmit={forms.otp} />
          {signOut('Start again')}
        </section>
      );
    case 'session_aal1':
    case 'session_aal2':
      return (
        <section className={styles.panel}>
          {state.error === undefined ? (
            <p role="status">Checking your organisations…</p>
          ) : (
            <>
              <ErrorLine error={state.error} />
              <Button busy={busy} onClick={buttons.retry}>
                Try again
              </Button>
            </>
          )}
          {signOut()}
        </section>
      );
    case 'totp_enrol':
      return (
        <section className={styles.panel}>
          <h2 className={styles.heading}>Set up two-step sign-in</h2>
          <p>Scan this QR code with your authenticator app, or type the key into the app.</p>
          {state.qrCode !== null && (
            <img
              className={styles.qr}
              src={state.qrCode}
              alt="QR code for your authenticator app"
              width={200}
              height={200}
            />
          )}
          <p>
            Key: <code className={styles.manualKey}>{state.secret}</code>
          </p>
          <ErrorLine error={state.error} />
          <CodeForm
            busy={busy}
            label="6-digit code from the app"
            submit="Verify and continue"
            onSubmit={forms.totp}
          />
          {signOut()}
        </section>
      );
    case 'totp_challenge':
      return (
        <section className={styles.panel}>
          <h2 className={styles.heading}>Two-step sign-in</h2>
          <ErrorLine error={state.error} />
          <CodeForm
            busy={busy}
            label="6-digit code from your authenticator app"
            submit="Verify"
            onSubmit={forms.totp}
          />
          {signOut()}
        </section>
      );
    case 'no_org':
      return (
        <section className={styles.panel}>
          <p>
            You don&apos;t have access to an organisation in Trace. Ask your organisation&apos;s
            admin to add you.
          </p>
          {signOut()}
        </section>
      );
    case 'org_picker':
      return (
        <section className={styles.panel}>
          <h2 className={styles.heading}>Choose an organisation</h2>
          <ul className={styles.orgs}>
            {state.orgs.map((org) => (
              <li key={org.id}>
                <Button busy={busy} onClick={buttons.pickOrg(org.id)}>
                  {org.name}
                </Button>
              </li>
            ))}
          </ul>
          {signOut()}
        </section>
      );
    case 'signed_in':
      return (
        <section className={styles.panel}>
          <p>Signed in to {state.org.name}</p>
          {signOut()}
        </section>
      );
  }
}

/** The flow from the context, re-rendered on every change. */
export function AuthPanel() {
  const flow = useContext(AuthFlowContext);
  const snapshot = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  return <AuthView snapshot={snapshot} actions={flow} />;
}

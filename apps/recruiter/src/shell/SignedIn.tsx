// The signed-in layout: nav by role, then the matched screen. It builds the api client for the signed-in org
// (token read from the current session on every call) and reads the caller's roles for link gating only.
import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { ApiClient } from '../api/client';
import {
  ApiContext,
  OrgInfoContext,
  RuntimeContext,
  type OrgInfo,
  type Runtime,
} from '../api/runtime';
import { AuthFlowContext } from '../auth/auth-context';
import ui from '../common/Ui.module.css';
import { NO_ACCESS_TEXT, hasAccess, navFor, type NavItem } from './nav';
import { loadOrgInfo } from './org-info';

/** Nav and content; pure, so every role's view can be rendered in tests. */
export function SignedInView({
  info,
  extraNav,
  children,
}: {
  info: OrgInfo;
  extraNav: NavItem | null;
  children: React.ReactNode;
}) {
  const items = navFor(info.roles, extraNav);
  return (
    <div>
      <nav className={ui.nav} aria-label="Main">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className={ui.navLink ?? ''}>
            {item.label}
          </NavLink>
        ))}
        <span className={ui.note}>{info.orgName}</span>
      </nav>
      {hasAccess(info.roles) ? children : <p role="status">{NO_ACCESS_TEXT}</p>}
    </div>
  );
}

type Loaded =
  { kind: 'loading' } | { kind: 'ready'; info: OrgInfo; api: ApiClient } | { kind: 'failed' };

function Ready({
  runtime,
  org,
  extraNav,
}: {
  runtime: Runtime;
  org: { id: string; name: string };
  extraNav: NavItem | null;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const api = useMemo(
    () =>
      new ApiClient({
        origin: runtime.origin,
        orgId: org.id,
        getAccessToken: runtime.getAccessToken,
        fetch: runtime.fetch,
      }),
    [runtime, org.id],
  );
  useEffect(() => {
    let live = true;
    void loadOrgInfo(runtime.supabase, org).then((info) => {
      if (live) setLoaded(info === null ? { kind: 'failed' } : { kind: 'ready', info, api });
    });
    return () => {
      live = false;
    };
  }, [runtime, org, api]);

  if (loaded.kind === 'loading') return <p role="status">Checking your access...</p>;
  if (loaded.kind === 'failed') {
    return <p role="alert">Your access could not be checked. Reload the page to try again.</p>;
  }
  return (
    <OrgInfoContext value={loaded.info}>
      <ApiContext value={loaded.api}>
        <SignedInView info={loaded.info} extraNav={extraNav}>
          <Outlet />
        </SignedInView>
      </ApiContext>
    </OrgInfoContext>
  );
}

/** Layout route for every screen that needs a signed-in organisation. */
export function SignedInGate({ extraNav }: { extraNav: NavItem | null }) {
  const flow = useContext(AuthFlowContext);
  const snapshot = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  const runtime = useContext(RuntimeContext);
  const { state } = snapshot;
  if (state.kind !== 'signed_in') {
    return (
      <p>
        Sign in to continue. <Link to="/">Go to sign in</Link>
      </p>
    );
  }
  if (runtime === null) return <p>Sign-in is not configured for this build</p>;
  return <Ready runtime={runtime} org={state.org} extraNav={extraNav} />;
}

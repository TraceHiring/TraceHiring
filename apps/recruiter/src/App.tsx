import { useEffect } from 'react';
import { Outlet, useRouteError } from 'react-router';
import { PRODUCT_NAME } from '@trace/shared';
import styles from './App.module.css';
import { reportAppError } from './error-reporting';
import { APP_VERSION } from './version';

// Recruiter shell (spec m0-foundations §1, §2): the product name, the matched route and the build
// version. Errors go to the injected reporter through error-reporting.ts, never to the screen.
export { PRODUCT_NAME };

/** Root layout route: product name, then the matched child route. */
export function App() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{PRODUCT_NAME}</h1>
      <Outlet />
      <p className={styles.version}>{`Version ${APP_VERSION}`}</p>
    </main>
  );
}

export function HomePage() {
  return <p>Recruiter workspace</p>;
}

export function HealthPage() {
  return <p>Status: ok</p>;
}

/** Error element for the root route: reports the error, shows a message that carries none of it. */
export function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    reportAppError(error);
  }, [error]);
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{PRODUCT_NAME}</h1>
      <p role="alert">Something went wrong. Reload the page to try again.</p>
    </main>
  );
}

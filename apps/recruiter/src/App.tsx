import { Outlet } from 'react-router';

// Placeholder shell (spec m0-foundations §14, S1). The S2 stream replaces it.
export const PRODUCT_NAME = 'Trace';

/** Root layout route: product name, then the matched child route. */
export function App() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <Outlet />
    </main>
  );
}

export function HomePage() {
  return <p>Recruiter workspace</p>;
}

export function HealthPage() {
  return <p>Status: ok</p>;
}

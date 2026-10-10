import { version } from '../package.json';

// Placeholder shell (spec m0-foundations §14, S1). The S2 stream replaces it.
export const PRODUCT_NAME = 'Trace';
export const APP_VERSION: string = version;

export function App() {
  return (
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>Version {APP_VERSION}</p>
    </main>
  );
}

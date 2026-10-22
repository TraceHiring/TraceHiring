import styles from './App.module.css';
import { APP_VERSION } from './version';

// Candidate shell (spec m0-foundations §1, §2): the product name and the build version. No
// camera, no third-party telemetry and no error reporting (CLAUDE.md rule 8, build-notes Q17).
export const PRODUCT_NAME = 'Trace';

export function App() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{PRODUCT_NAME}</h1>
      <p className={styles.version}>{`Version ${APP_VERSION}`}</p>
    </main>
  );
}

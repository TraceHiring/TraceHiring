import '@trace/ui/tokens.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readBoot } from './boot';
import { log } from './log';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

// Read (and clear) the link fragment once, before React renders (a StrictMode double render must not see it twice).
const boot = readBoot();

createRoot(container).render(
  <StrictMode>
    <App boot={boot} />
  </StrictMode>,
);

log.info('app.start');

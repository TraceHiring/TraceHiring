import '@trace/ui/tokens.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { RuntimeContext, type Runtime } from './api/runtime';
import { AuthFlowContext } from './auth/auth-context';
import { AuthFlow } from './auth/flow';
import { browserSessionStorage, createRecruiterSupabase } from './auth/supabase-client';
import { initErrorReporting, installGlobalErrorReporting } from './error-reporting';
import { routes } from './routes';
import { currentAccessToken } from './shell/org-info';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

// Sentry only when the build has a DSN (d1 AT-D22); window errors go through the adapter either way.
// Each callee gets only the fields it reads, as static member reads that Vite inlines: passing the whole
// environment object would put one naming every VITE_* key of the build (the demo flag too) into the entry chunk.
initErrorReporting({ VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN });
installGlobalErrorReporting(window);

const router = createBrowserRouter(routes);

// No client (state `unconfigured`) unless both build variables are set (specs/m0b-tenancy.md §2.7).
const storage = browserSessionStorage(window);
const supabase = createRecruiterSupabase(
  {
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  },
  storage,
);
const authFlow = new AuthFlow(supabase, storage);
void authFlow.start();

// The signed-in screens need the api origin (VITE_API_ORIGIN) as well as the Supabase client; without both the
// shell says the build is not configured.
const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim() ?? '';
const runtime: Runtime | null =
  supabase !== null && apiOrigin !== ''
    ? {
        origin: apiOrigin,
        fetch: (url, init) => window.fetch(url, init),
        getAccessToken: () => currentAccessToken(supabase),
        supabase,
      }
    : null;

createRoot(container).render(
  <StrictMode>
    <AuthFlowContext value={authFlow}>
      <RuntimeContext value={runtime}>
        <RouterProvider router={router} />
      </RuntimeContext>
    </AuthFlowContext>
  </StrictMode>,
);

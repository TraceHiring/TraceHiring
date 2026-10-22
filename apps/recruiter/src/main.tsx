import '@trace/ui/tokens.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AuthFlowContext } from './auth/auth-context';
import { AuthFlow } from './auth/flow';
import { browserSessionStorage, createRecruiterSupabase } from './auth/supabase-client';
import { installGlobalErrorReporting } from './error-reporting';
import { routes } from './routes';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

installGlobalErrorReporting(window);

const router = createBrowserRouter(routes);

// No client (state `unconfigured`) unless both build variables are set (specs/m0b-tenancy.md §2.7).
const storage = browserSessionStorage(window);
const authFlow = new AuthFlow(createRecruiterSupabase(import.meta.env, storage), storage);
void authFlow.start();

createRoot(container).render(
  <StrictMode>
    <AuthFlowContext value={authFlow}>
      <RouterProvider router={router} />
    </AuthFlowContext>
  </StrictMode>,
);

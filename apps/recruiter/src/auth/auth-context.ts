// The sign-in flow the recruiter app renders. main.tsx provides the real one; without a provider
// (tests of the shell, or no build variables) the app sees a flow with no client: `unconfigured`.
import { createContext } from 'react';
import { AuthFlow } from './flow';
import { createMemoryStorage } from './supabase-client';

export const AuthFlowContext = createContext<AuthFlow>(new AuthFlow(null, createMemoryStorage()));

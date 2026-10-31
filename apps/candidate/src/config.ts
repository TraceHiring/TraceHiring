// The edge origin this build talks to, or null when the build has none that is safe to use (the app then shows the
// `unavailable` step and calls nothing; it never guesses an origin).
import { resolveEdgeOrigin } from './api';

export const EDGE_ORIGIN: string | null = resolveEdgeOrigin(import.meta.env.VITE_EDGE_ORIGIN);

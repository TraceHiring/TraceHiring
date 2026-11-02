// Build-time variables the app reads (vite/client types come from tsconfig `types`).
interface ImportMetaEnv {
  /** The commit SHA of this build, set by CI; absent locally (spec §9.3). */
  readonly VITE_APP_VERSION?: string;
  /** The Supabase project URL; set only for the staging build (specs/m0b-tenancy.md §2.7). */
  readonly VITE_SUPABASE_URL?: string;
  /** The public `sb_publishable_…` key; set only for the staging build (m0b §2.7). */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The Sentry DSN, a public value; set only for the staging build (d1 AT-D22, m0 §7.3). */
  readonly VITE_SENTRY_DSN?: string;
  /** The api Worker origin; set only for the staging build (d1 spec §7.1). */
  readonly VITE_API_ORIGIN?: string;
  /** "1" in a build that shows the demo outbox (only with VITE_TRACE_ENV dev or staging); unset otherwise (d1 AT-D18). */
  readonly VITE_DEMO_OUTBOX?: string;
  /** The deploy flavour; the outbox is on only when it is exactly "dev" or "staging" (d1 §7.1, AT-D18). */
  readonly VITE_TRACE_ENV?: string;
}

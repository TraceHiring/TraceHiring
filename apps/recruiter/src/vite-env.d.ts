// Build-time variables the app reads (vite/client types come from tsconfig `types`).
interface ImportMetaEnv {
  /** The commit SHA of this build, set by CI; absent locally (spec §9.3). */
  readonly VITE_APP_VERSION?: string;
}

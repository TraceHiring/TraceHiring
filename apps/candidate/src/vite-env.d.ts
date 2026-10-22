// Build-time variables the app reads (vite/client types come from tsconfig `types`).
interface ImportMetaEnv {
  /** The commit SHA of this build, set by CI; absent locally (spec §9.3). */
  readonly VITE_APP_VERSION?: string;
  /**
   * The edge Worker's origin (specs/d1-demo-slice.md §4.7): the staging edge in the staging build, 127.0.0.1 in the
   * e2e-local build. Anything that is not an https origin (or http on 127.0.0.1 / localhost) makes the app fail closed.
   */
  readonly VITE_EDGE_ORIGIN?: string;
}

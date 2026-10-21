// Hand-written Env augmentation for the services/api secrets (security review bindings F6; spec L-10). They are
// Worker secrets set by an operator, never vars and never in git, so `wrangler types` does not list them. Every one
// is optional: code guards each and fails closed (503 `unavailable`), never `!`.
export {};

declare global {
  interface Env {
    /**
     * Staging: the Hyperdrive binding of the login role api_login (a binding, set in wrangler.jsonc env.staging; ADR-031
     * amendment 1). Every use runs `SET LOCAL ROLE trace_api` in a transaction. Wins over API_DB_URL.
     */
    API_DB?: Hyperdrive;
    /** The local stack only (wrangler dev, e2e-local): api_login's URL on a loopback host; refused anywhere else. */
    API_DB_URL?: string;
    /** The ES256 private JWK; tokens are signed under its own `kid` (security review wave0-rest S4). */
    CANDIDATE_TOKEN_PRIVATE_JWK?: string;
    /** HMAC-SHA-256 key for the 5-minute media links (spec §6.2 R3-4). */
    MEDIA_LINK_HMAC_KEY?: string;
  }
}

# ADR-028: M0 runtime libraries (zod, Hono, React Router)

- **Status:** Accepted (2026-10-11). Default of build-notes Q13 ("Can-default"), written in M0a S1.1 as spec `specs/m0-foundations.md` §1 item 9 and §3 D1 require.
- **Source:** `docs/build-notes.md` Q13 and §3 "Toolchain" (Routing/HTTP row); spec §3 D1, §4 pins.

## Context
CLAUDE.md: "Do not add a framework, database or vendor without a new ADR." Build-notes Q13 splits libraries into dev/test tooling, which needs no ADR (Vitest, ESLint, Prettier, pgTAP, Playwright, axe-core, gitleaks, lefthook, commitlint), and runtime libraries, which ship to users and so get an ADR. M0 needs three runtime libraries:
- request and contract validation shared by apps, Workers and the API;
- HTTP routing on Cloudflare Workers (`workers/edge`, `workers/jobs`, `services/api`, ADR-027);
- client-side routing in the recruiter app.

## Decision
| Need | Library | Pin (spec §4) | Where |
| --- | --- | --- | --- |
| Schemas and runtime validation | **zod** | 4.6.5 | `@trace/shared` contracts (§9.4), every Worker and app |
| HTTP routing on Workers | **Hono** | 4.13.13 | `workers/edge`, `workers/jobs`, `services/api` |
| Client routing | **React Router**, library (data-router) mode, no SSR | 8.4.0 | `apps/recruiter` (and `apps/candidate` if it needs routes) |

Versions live in the pnpm `catalog:` (`pnpm-workspace.yaml`) so every workspace uses the same one; Dependabot groups updates by catalog entry.

No ORM: data access is supabase-js plus SQL (build-notes Q13).

## Rejected alternatives, and why
- **itty-router or raw `fetch` handlers:** less middleware (CORS, request IDs, error mapping) and weaker typing; we would rebuild Hono's features by hand.
- **React Router framework mode, Remix or Next.js:** bring SSR and a server runtime that Trace does not need (static apps on Cloudflare Pages, spec §3 D1), and add weight to the candidate bundle (150 KB budget, D3).
- **TanStack Router:** capable, but React Router is the default named in build-notes Q13, and nothing in M0 needs more.
- **valibot or io-ts instead of zod:** zod is already implied by build-order ("zod schemas" in `packages/shared`). If the candidate bundle budget is threatened, revisit with a measurement.

## Consequences
- Contracts are written once in `@trace/shared` with zod and imported by both sides.
- Workers expose routes through Hono; health handlers follow the §9.3 contract.
- Each later runtime library still needs its own ADR: an i18n library (M3), headless UI primitives (only if hand-rolled ones fail accessibility), Excel/Word parsers (M1).

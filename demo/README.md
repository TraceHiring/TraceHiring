# Trace demo prototype (D1 preview)

**Live:** https://tracehiring.tech (root, founder request 2026-10-11) and https://demo.tracehiring.tech (Cloudflare Custom Domain on the `trace-demo` Worker; added 2026-10-11 at the founder's explicit request, overriding the earlier "no DNS changes on tracehiring.tech" rule for this one subdomain only) and https://trace-demo.abhayraj.workers.dev (workers.dev subdomain `abhayraj`, confirmed 2026-10-11)

A self-contained demo slice of Trace, built on 2026-10-11 at the founder's request so the product can be shown live.
It runs on **staging only, with synthetic data only**. It is **not** the M0a production skeleton: it sits beside the
autopilot milestones and does not replace any milestone gate.

- **Stack:** React + Vite (static assets) and one Cloudflare Worker, with one Durable Object (`DemoStore`) holding all demo state.
  No Supabase, no auth and no real vendors. The grader is a mock (`mock-grader-v1`).
- **Flows:** the recruiter builds a test, invites, and triages by score; the candidate gets consent, an 18+ check, a start photo, a server-held timer, autosave and integrity events; the reviewer works the evidence timeline, confirms or overturns flags, sends a notice with a 72 h window, and a different reviewer makes the final call. There is also analytics and an audit log.
- **Product rules kept:** two separate results; no automatic rejection; a deterministic, versioned band engine (T3 capped at Review unless the input is untrusted); notice plus a 72 h window, with the second-reviewer rule enforced in the API; the candidate projection holds only the candidate's own data; under-18s are blocked; no gaze, emotion, AI-likeness or IP flags.
- **Known demo shortcuts:** no real auth (an "Acting as" switcher instead); no RLS; media is stored as small data URLs in the DO, with no R2 and no signed links; no background blur.

```bash
cd demo && npm install && npm run build && npx wrangler dev   # local
cd demo && npm run deploy                                     # staging workers.dev
bash demo/smoke.sh https://trace-demo.abhayraj.workers.dev # API smoke test
```

## Automated E2E (D1 exit gate)

```bash
node demo/e2e/e2e.mjs https://tracehiring.tech   # 17 steps; resets demo data before and after
```

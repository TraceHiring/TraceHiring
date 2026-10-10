# Trace security guidance (read by the security-guidance plugin)
- Multi-tenant: every table has org_id + RLS with per-operation policies; evidence scoped to assigned candidates.
- Candidate PII (name, phone, email, DOB, answers, stills, audio, accommodations) must never appear in logs, Sentry, PostHog, LLM prompts with identity, test fixtures or error messages.
- Service-role keys only in server workers. Never in apps/* or candidate-facing Workers/Durable Objects.
- Media: private R2, 5-minute signed URLs, every view audited, Client Viewer never gets media.
- Razorpay and inbound webhooks: verify HMAC signature with constant-time compare before parsing; idempotent by event id.
- LLM grader: answer as delimited data, schema-validated output, injection detector raises Review.
- Never add code that rejects a candidate on integrity automatically, blends quality with integrity, infers emotion, or shows AI-likeness of text.
- Under-18 candidates are blocked server-side.

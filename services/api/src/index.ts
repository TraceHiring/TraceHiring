// Placeholder entrypoint (specs/m0-foundations.md §14 S1). The S3 stream replaces it with Hono and GET /health.
// This file stays a thin Workers adapter; module code lives in src/modules/ (ADR-027).
export default {
  fetch(): Response {
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

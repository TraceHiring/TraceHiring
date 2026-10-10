// Placeholder entrypoint (specs/m0-foundations.md §14 S1). The S3 stream replaces it with Hono and GET /health.
export default {
  fetch(): Response {
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

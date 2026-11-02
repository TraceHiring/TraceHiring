// Baseline for bundle-size comparison (no driver).
export default {
  async fetch(): Promise<Response> {
    return Response.json({ ok: true });
  },
};

// Spike api Worker: RPC lives only on the named entrypoint; the default (HTTP) entrypoint answers /health only.
import { WorkerEntrypoint } from 'cloudflare:workers';

export class CandidateRpc extends WorkerEntrypoint {
  async ping(who: string): Promise<string> {
    return `pong to ${who}`;
  }
  async whoami(): Promise<{ service: string; entrypoint: string }> {
    return { service: 'd1-spike-api', entrypoint: 'CandidateRpc' };
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/health') return new Response('ok');
    return new Response('not found', { status: 404 });
  },
};

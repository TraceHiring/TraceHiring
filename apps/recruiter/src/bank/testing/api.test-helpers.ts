// A fake fetch behind a real ApiClient, for the M1 bank and library screens. Synthetic data only.
import { ApiClient, type FetchLike } from '../../api/client';
import type { OrgInfo } from '../../api/runtime';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '77777777-7777-4777-8777-777777777777';

export interface FakeCall {
  method: string;
  /** The path below `/v1/orgs/:orgId`. */
  path: string;
  query: Record<string, string>;
  body: unknown;
}
export interface FakeAnswer {
  status?: number;
  body: unknown;
}
/** Answers a call, or returns undefined for "no such route" (a 404 not_found). */
export type Handler = (call: FakeCall) => FakeAnswer | undefined;

export function fakeApi(handler: Handler): { api: ApiClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const parsed = new URL(url);
    const call: FakeCall = {
      method: init.method ?? 'GET',
      path: parsed.pathname.replace(`/v1/orgs/${ORG_ID}`, ''),
      query: Object.fromEntries(parsed.searchParams.entries()),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const answer = handler(call);
    if (answer === undefined) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const api = new ApiClient({
    origin: 'https://trace-api-staging.example-sub.workers.dev',
    orgId: ORG_ID,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fetchImpl,
  });
  return { api, calls };
}

export const failure = (status: number, code: string): FakeAnswer => ({
  status,
  body: { error: { code } },
});

export const info = (...roles: string[]): OrgInfo => ({
  orgId: ORG_ID,
  orgName: 'Synthetic Staffing',
  userId: USER_ID,
  roles,
});

// The recruiter app's one door to services/api (specs/d1-demo-slice.md §6.2). Every response is parsed with its
// zod contract from @trace/shared/contracts/d1; a body that fails parsing is `invalid_response`, never shown raw.
// Nothing here logs, and no failure carries the response body, the URL or the token: only a constant code.
import { ApiError } from '@trace/shared/contracts/d1';

/** The part of `fetch` the client uses; tests pass a fake. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Constant failure codes: the api's own `{ error: { code } }` or one of these client-side ones. */
export type ApiFailureCode = string;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ApiFailureCode };

interface Schema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export interface CallOptions<T> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path below `/v1/orgs/:orgId`, starting with a slash. */
  path: string;
  schema: Schema<T>;
  body?: unknown;
}

export interface ApiClientOptions {
  /** The api Worker origin (VITE_API_ORIGIN), no trailing slash needed. */
  origin: string;
  orgId: string;
  getAccessToken(): Promise<string | null>;
  fetch: FetchLike;
}

const fail = (code: ApiFailureCode): { ok: false; code: ApiFailureCode } => ({ ok: false, code });

async function readJson(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text()) as unknown;
  } catch {
    return undefined;
  }
}

export class ApiClient {
  readonly orgId: string;
  private readonly origin: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly doFetch: FetchLike;

  constructor(options: ApiClientOptions) {
    this.orgId = options.orgId;
    this.origin = options.origin.replace(/\/+$/, '');
    this.getAccessToken = options.getAccessToken;
    this.doFetch = options.fetch;
  }

  /** Calls `/v1/orgs/:orgId{path}` as the signed-in user and parses the answer with `schema`. */
  async call<T>(options: CallOptions<T>): Promise<ApiResult<T>> {
    let token: string | null;
    try {
      token = await this.getAccessToken();
    } catch {
      token = null;
    }
    if (token === null || token === '') return fail('unauthorized');
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    };
    const init: RequestInit = {
      method: options.method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    let res: Response;
    try {
      res = await this.doFetch(`${this.origin}/v1/orgs/${this.orgId}${options.path}`, init);
    } catch {
      return fail('network');
    }
    const body = await readJson(res);
    if (!res.ok) {
      const error = ApiError.safeParse(body);
      return fail(error.success ? error.data.error.code : 'unavailable');
    }
    const parsed = options.schema.safeParse(body);
    return parsed.success ? { ok: true, data: parsed.data } : fail('invalid_response');
  }

  /**
   * Fetches a single-use media link once (rule 8): only from the api origin, with no credentials, no
   * Authorization header and no referrer. The URL is never logged, stored or put in an error.
   */
  async fetchImageBytes(url: string): Promise<ApiResult<ArrayBuffer>> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return fail('unavailable');
    }
    if (target.origin !== new URL(this.origin).origin || !target.pathname.startsWith('/media/')) {
      return fail('unavailable');
    }
    let res: Response;
    try {
      res = await this.doFetch(target.href, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      return fail('network');
    }
    if (!res.ok) {
      const error = ApiError.safeParse(await readJson(res));
      return fail(error.success ? error.data.error.code : 'unavailable');
    }
    if (res.headers.get('content-type')?.split(';')[0]?.trim() !== 'image/jpeg') {
      return fail('unavailable');
    }
    try {
      return { ok: true, data: await res.arrayBuffer() };
    } catch {
      return fail('network');
    }
  }
}

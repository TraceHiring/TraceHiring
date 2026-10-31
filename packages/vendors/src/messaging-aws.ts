// SigV4-signed HTTPS POST to AWS for the SES v2 and KMS adapters (ADR-034; specs/m2-scheduling-invites.md M2-16).
// aws4fetch's AwsV4Signer signs; the caller's injected fetch sends (no global fetch, no retries here: the messaging
// consumer and the api own retry policy). The signing time comes from an injected clock, so tests pin the signature.
// Endpoints are fixed strings in the callers, never built from input (no SSRF surface). Nothing here logs or puts a
// credential, header or body into an error.
import { AwsV4Signer } from 'aws4fetch';

/** The one AWS region of Trace (M2-3, M2-15; build-notes 2026-10-31 g). */
export const AWS_REGION = 'ap-south-1';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** The fetch the adapters take (a Worker passes `fetch`; tests pass a recorder). */
export type AwsFetch = (
  url: string,
  init: { method: 'POST'; headers: Headers; body: string; signal?: AbortSignal },
) => Promise<Response>;

/** `YYYYMMDDTHHMMSSZ` for a Date (the SigV4 x-amz-date). */
export const amzDate = (d: Date): string => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

/** True when the credentials are two non-empty single-line strings (and a session token, if any, likewise). */
export function validCredentials(c: Partial<AwsCredentials>): boolean {
  const ok = (v: unknown) =>
    typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/\s/.test(v);
  return (
    ok(c.accessKeyId) &&
    ok(c.secretAccessKey) &&
    (c.sessionToken === undefined || ok(c.sessionToken))
  );
}

export async function signedAwsPost(args: {
  url: string;
  service: 'ses' | 'kms';
  headers: Record<string, string>;
  body: string;
  credentials: AwsCredentials;
  now: () => Date;
  fetch: AwsFetch;
  timeoutMs: number;
}): Promise<Response> {
  const { credentials } = args;
  const signer = new AwsV4Signer({
    method: 'POST',
    url: args.url,
    headers: args.headers,
    body: args.body,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
    service: args.service,
    region: AWS_REGION,
    datetime: amzDate(args.now()),
  });
  const signed = await signer.sign();
  return args.fetch(signed.url.toString(), {
    method: 'POST',
    headers: signed.headers,
    body: args.body,
    signal: AbortSignal.timeout(args.timeoutMs),
  });
}

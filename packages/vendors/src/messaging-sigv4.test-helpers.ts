// Test-only helpers for the SigV4 request-shape tests (AT-M2-11, AT-M2-33; ADR-034): an independent reference
// implementation of AWS Signature Version 4 on node:crypto (not aws4fetch), synthetic credentials built at run time
// (no secret-shaped literal in source: gitleaks runs on commit), and a recording fetch. No network anywhere.
import { createHash, createHmac } from 'node:crypto';

/** Synthetic credentials, assembled at run time. They match no real key format. */
export const testCredentials = (): { accessKeyId: string; secretAccessKey: string } => ({
  accessKeyId: ['TEST', 'ACCESS', 'ID', 'SYNTHETIC'].join('_'),
  secretAccessKey: Array.from({ length: 40 }, (_, i) => 'synthetic'[i % 9]).join(''),
});

/** The fixed signing time of every SigV4 test: 2026-10-31 12:00:00 UTC. */
export const FIXED_DATE = new Date(Date.UTC(2026, 9, 31, 12, 0, 0));
export const FIXED_AMZ_DATE = '20261031T120000Z';

const sha256Hex = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

export interface ReferenceSignInput {
  method: string;
  host: string;
  path: string;
  /** Lower-case names of the signed headers other than host, with their values. */
  signedHeaders: Record<string, string>;
  body: string;
  region: string;
  service: string;
  amzDate: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** AWS SigV4 (header form) per the AWS documentation, written independently of aws4fetch. */
export function referenceSigV4(input: ReferenceSignInput): {
  canonicalRequest: string;
  stringToSign: string;
  authorization: string;
} {
  const headers: Record<string, string> = { host: input.host, ...input.signedHeaders };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${(headers[n] ?? '').trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method,
    input.path,
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.body),
  ].join('\n');
  const day = input.amzDate.slice(0, 8);
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, sha256Hex(canonicalRequest)].join(
    '\n',
  );
  const kDate = hmac(`AWS4${input.secretAccessKey}`, day);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    canonicalRequest,
    stringToSign,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch double: records each request (headers lower-cased) and answers with `respond`. */
export function recordingFetch(respond: (req: RecordedRequest) => Response | Promise<Response>): {
  fetch: (
    url: string,
    init: { method: string; headers: Headers; body: string },
  ) => Promise<Response>;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const headers: Record<string, string> = {};
      init.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const req = { url, method: init.method, headers, body: init.body };
      calls.push(req);
      return respond(req);
    },
  };
}

export const jsonResponse = (
  status: number,
  body: unknown,
  contentType = 'application/json',
): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });

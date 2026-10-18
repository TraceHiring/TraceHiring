// Security review R3 #1 (docs/reviews/D1-security-review-r3.md; ADR-031, B0-SEC1): the trace_api connection never
// runs without TLS to a non-local host. postgres.js takes TLS only from the URL's sslmode unless `ssl` is passed, and
// `prefer` falls back to plaintext, so the api decides the mode itself and refuses a weak one (503 `unavailable`).
import { describe, expect, it } from 'vitest';
import { apiDbSsl, openApiDb } from './api-db.js';

// Built at run time; no credential-shaped literal sits in the repo.
const url = (host: string, query = '') =>
  `${['postgres', 'ql'].join('')}://${'api'}_login:${'x'.repeat(8)}@${host}:6543/postgres${query}`;

describe('trace_api connection TLS (security review R3 #1)', () => {
  it('a non-local host without sslmode gets require', () => {
    expect(apiDbSsl(url('db.example.test'))).toBe('require');
  });

  it.each(['require', 'verify-full'])('a non-local host keeps sslmode=%s', (mode) => {
    expect(apiDbSsl(url('db.example.test', `?sslmode=${mode}`))).toBe(mode);
  });

  it.each(['disable', 'allow', 'prefer', 'verify-ca', 'bogus'])(
    'a non-local host with sslmode=%s is refused',
    (mode) => {
      expect(apiDbSsl(url('db.example.test', `?sslmode=${mode}`))).toBeNull();
      expect(openApiDb(url('db.example.test', `?sslmode=${mode}`))).toBeNull();
    },
  );

  it('two sslmode values or another query parameter are refused', () => {
    expect(apiDbSsl(url('db.example.test', '?sslmode=require&sslmode=disable'))).toBeNull();
    expect(apiDbSsl(url('db.example.test', '?sslmode=require&host=127.0.0.1'))).toBeNull();
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'the local stack on %s may run without TLS',
    (host) => {
      expect(apiDbSsl(url(host))).toBe(false);
    },
  );

  it('an unparsable or non-postgres URL is refused', () => {
    expect(apiDbSsl('not a url')).toBeNull();
    expect(apiDbSsl('https://db.example.test/')).toBeNull();
    expect(openApiDb('not a url')).toBeNull();
  });
});

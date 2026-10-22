// The db-test harness connects to the local stack only (DB review #3, security review #1): operatorUrl is a pure
// function of the environment and refuses, before any connection, a JOBS_TEST_DB_URL whose host is not local.
// No database is touched here. URLs are assembled at run time from synthetic parts (no credential literal).
import { describe, expect, it } from 'vitest';
import { operatorUrl } from './harness.js';

const scheme = ['postgres', 'ql'].join('');
const urlOn = (host: string): string => `${scheme}://synthetic_user:synthetic_pw@${host}/postgres`;

describe('operatorUrl (local database only)', () => {
  it('with no override it is the local stack on 127.0.0.1:54322', () => {
    expect(new URL(operatorUrl({})).host).toBe('127.0.0.1:54322');
    expect(new URL(operatorUrl({ JOBS_TEST_DB_URL: '' })).host).toBe('127.0.0.1:54322');
  });

  it.each(['127.0.0.1:54322', 'localhost:5432', 'LOCALHOST:5432'])(
    'accepts the local host %s',
    (host) => {
      expect(operatorUrl({ JOBS_TEST_DB_URL: urlOn(host) })).toBe(urlOn(host));
    },
  );

  it.each([
    'db.example.supabase.co:5432',
    'aws-0-ap-south-1.pooler.supabase.com:6543',
    '10.0.0.5:5432',
    '127.0.0.2:5432',
    'localhost.example.com:5432',
    '[::2]:5432',
    // postgres.js could never dial it (it splits the host on ":"); the guard is @trace/workers-http's (I-1).
    '[::1]:54322',
    // Chat E3 re-review finding 2 (the L-1 shape): postgres.js would dial the first, remote host.
    'db.example.test:5432,x@127.0.0.1:54322',
  ])('refuses the non-local host %s before connecting', (host) => {
    expect(() => operatorUrl({ JOBS_TEST_DB_URL: urlOn(host) })).toThrow(
      /^db-test: JOBS_TEST_DB_URL must name a local database$/,
    );
  });

  it('refuses an override that is not a URL, without echoing it', () => {
    let message = '';
    try {
      operatorUrl({ JOBS_TEST_DB_URL: 'not a url synthetic_pw' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe('db-test: JOBS_TEST_DB_URL must name a local database');
  });
});

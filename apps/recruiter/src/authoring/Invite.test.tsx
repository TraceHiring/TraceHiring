// The invite form (specs/d1-demo-slice.md §6.1, rule 9, D1-1, D1-12): only an @example.test address, the age answer
// defaults to unknown, "No" shows "Blocked: under 18" and no link, a link is shown once with Copy, and there is no
// name or phone field.
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, type FetchLike } from '../api/client';
import { InviteFormView, InviteResultView, ageToRequest, submitInvitation } from './InvitePage';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEST = '22222222-2222-4222-8222-222222222222';
const INVITE_URL = 'https://candidate.example.test/i#tokentokentoken';
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => undefined;

function setup(response: unknown, status = 200) {
  const calls: { path: string; body: unknown }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({
      path: new URL(url).pathname,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const api = new ApiClient({
    origin: 'https://trace-api-staging.example-sub.workers.dev',
    orgId: ORG,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fetchImpl,
  });
  return { api, calls };
}

const CREATED = {
  invitationId: '33333333-3333-4333-8333-333333333333',
  label: 'Candidate 4',
  status: 'sent',
  inviteUrl: INVITE_URL,
};
const BLOCKED = { ...CREATED, status: 'blocked_age', inviteUrl: null };

describe('ageToRequest', () => {
  it('maps Yes, No, Not sure and no answer to true, false, null, null', () => {
    expect(ageToRequest('yes')).toBe(true);
    expect(ageToRequest('no')).toBe(false);
    expect(ageToRequest('unsure')).toBeNull();
    expect(ageToRequest('')).toBeNull();
  });
});

describe('InviteFormView', () => {
  const out = renderToString(<InviteFormView busy={false} error={null} onSubmit={noop} />);

  it('asks for the contact email with the @example.test helper and the three age answers', () => {
    expect(plain(out)).toContain('@example.test');
    expect(plain(out)).toContain('This candidate is 18 or older');
    for (const label of ['Yes', 'No', 'Not sure']) expect(plain(out)).toContain(label);
  });

  it('has no answer selected by default (unknown)', () => {
    expect(out).not.toMatch(/checked/);
  });

  it('has no name or phone field', () => {
    expect(out).not.toMatch(/name="(?:name|phone|mobile|tel)"|type="tel"/i);
    expect(plain(out)).not.toMatch(/phone|mobile|full name|first name/i);
  });
});

describe('InviteResultView', () => {
  it('shows the label, the link and a Copy button', () => {
    const out = renderToString(
      <InviteResultView
        result={{ ...CREATED, status: 'sent' } as never}
        onCopy={noop}
        onAnother={noop}
      />,
    );
    const text = plain(out);
    expect(text).toContain('Candidate 4');
    expect(text).toContain(INVITE_URL);
    expect(out).toMatch(/<button[^>]*>Copy link<\/button>/);
    expect(text).toContain('shown only once');
  });

  it('for "No" shows the label and "Blocked: under 18" and no link or Copy', () => {
    const out = renderToString(
      <InviteResultView result={BLOCKED as never} onCopy={noop} onAnother={noop} />,
    );
    const text = plain(out);
    expect(text).toContain('Candidate 4');
    expect(text).toContain('Blocked: under 18');
    expect(text).not.toContain('http');
    expect(out).not.toMatch(/Copy/);
  });
});

describe('submitInvitation', () => {
  it('sends the typed answer: Yes true, No false, Not sure and none null', async () => {
    for (const [answer, expected] of [
      ['yes', true],
      ['no', false],
      ['unsure', null],
      ['', null],
    ] as const) {
      const { api, calls } = setup(answer === 'no' ? BLOCKED : CREATED);
      const res = await submitInvitation(api, TEST, { email: 'a.b@example.test', age: answer });
      expect(res.ok).toBe(true);
      expect(calls[0]?.body).toEqual({
        contactEmail: 'a.b@example.test',
        adultConfirmedByInviter: expected,
      });
    }
  });

  it('refuses any address that is not @example.test without a request', async () => {
    const { api, calls } = setup(CREATED);
    for (const email of ['someone@gmail.com', 'x@example.test.evil.com', '', 'no at sign']) {
      const res = await submitInvitation(api, TEST, { email, age: 'yes' });
      expect(res).toEqual({ ok: false, code: 'invalid_email' });
    }
    expect(calls).toHaveLength(0);
  });

  it('never yields a link for a blocked invitation, even if a bad response carried one', async () => {
    const { api } = setup({ ...BLOCKED, inviteUrl: INVITE_URL });
    const res = await submitInvitation(api, TEST, { email: 'a@example.test', age: 'no' });
    expect(res).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('keeps the link out of the console', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(noop);
    const { api } = setup(CREATED);
    await submitInvitation(api, TEST, { email: 'a@example.test', age: 'yes' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// The two M1 queue messages (spec m1 §6.4, M1-20, R5-13; Wave 2 lead scaffolding): services/api produces them and
// workers/jobs consumes them, so both sides parse one schema. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { AdminQueueMessage, AuthoringQueueMessage } from './contracts-m1.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = String.fromCharCode(64);

const draft = {
  v: 1,
  kind: 'ai_draft',
  jobId: id(1),
  orgId: id(2),
  workspaceId: id(3),
  format: 'mcq',
  skillKey: 'queues',
  difficulty: 0.5,
  count: 5,
  topic: '[synthetic] retry queues',
};

const invite = {
  v: 1,
  kind: 'member_invite',
  inviteId: id(4),
  orgId: id(2),
  email: `member${at}example.test`,
  displayName: 'Synthetic Member',
};

describe('AuthoringQueueMessage (§6.4)', () => {
  it('accepts the §6.4 message', () => {
    expect(AuthoringQueueMessage.parse(draft)).toEqual(draft);
  });
  it.each([
    ['an unknown key', { ...draft, extra: 1 }],
    ['another version', { ...draft, v: 2 }],
    ['a count of 11', { ...draft, count: 11 }],
    ['a topic over 500 characters', { ...draft, topic: 'x'.repeat(501) }],
    ['an empty topic', { ...draft, topic: '' }],
    ['a bad org id', { ...draft, orgId: 'org' }],
    ['a difficulty of 1.5', { ...draft, difficulty: 1.5 }],
  ])('refuses %s', (_name, message) => {
    expect(AuthoringQueueMessage.safeParse(message).success).toBe(false);
  });
});

describe('AdminQueueMessage (M1-20)', () => {
  it('accepts the invite message', () => {
    expect(AdminQueueMessage.parse(invite)).toEqual(invite);
  });
  it.each([
    ['an unknown key (roles live on the invite row)', { ...invite, roles: ['admin'] }],
    ['a bad email', { ...invite, email: 'member' }],
    ['an empty display name', { ...invite, displayName: '' }],
    ['another kind', { ...invite, kind: 'ai_draft' }],
  ])('refuses %s', (_name, message) => {
    expect(AdminQueueMessage.safeParse(message).success).toBe(false);
  });
});

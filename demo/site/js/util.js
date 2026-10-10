// Formatting and small helpers shared by every view.
export const HOUR = 3600 * 1000;

const clockFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const clockSecFmt = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export const fmtClock = (t) => clockFmt.format(new Date(t));
export const fmtClockSec = (t) => clockSecFmt.format(new Date(t));
export const fmtDateTime = (t) => dateFmt.format(new Date(t));

/** 125000 -> "02:05" ; negative clamps to 00:00. */
export function fmtMmSs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 200000000 -> "2 d 7 h" style countdown. */
export function fmtLong(ms) {
  if (ms <= 0) return 'elapsed';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function randomToken(prefix, length = 20) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}${out}`;
}

export function shortRef() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `TR-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`;
}

/** FNV-1a 32-bit. Used to compare copied text without storing it. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic PRNG (mulberry32) so the "server" schedules stills reproducibly per session. */
export function seededRandom(seedText) {
  let a = parseInt(fnv1a(seedText), 16);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wordCount(text) {
  const words = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}

export const REVIEWERS = {
  R1: 'Reviewer R1 · Riya (demo)',
  R2: 'Reviewer R2 · Ravi (demo)',
};

export const ORG_NAME = 'Demo Staffing Co.';
export const RECRUITER_NAME = 'Recruiter · Meera (demo)';

export function actorLabel(actor) {
  if (actor === 'R1' || actor === 'R2') return REVIEWERS[actor];
  if (actor === 'recruiter') return RECRUITER_NAME;
  if (actor === 'candidate') return 'Candidate';
  if (actor === 'system') return 'Trace (system)';
  return actor;
}

/** What a candidate sees about who acted: role and organisation only, never a name (plan §2). */
export function actorRoleOnly(actor) {
  if (actor === 'R1' || actor === 'R2') return `Reviewer · ${ORG_NAME}`;
  if (actor === 'recruiter') return `Recruiter · ${ORG_NAME}`;
  if (actor === 'candidate') return 'You';
  return 'Trace (system)';
}

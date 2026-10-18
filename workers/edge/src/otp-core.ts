// The InviteOtpDO logic (specs/d1-demo-slice.md §4.2, §4.3, §4.8 RT-6). One object per invitation
// (`idFromName(invitation_id)`, never an IP, Q47). It issues a 6-digit code valid 10 minutes, stored salted-hashed;
// a new challenge replaces the old; resend after 30 s and at most 3 codes per 10 minutes; the 5th wrong code since the
// last success or the end of the last lock, whichever code it was for, locks for 15 minutes (counted per invitation, so
// a new code does not reset it, SEC-3); the compare is constant-time. A successful verify consumes the challenge and stores the hash
// of a fresh lobby nonce, so a new login kills the previous lobby token. Lobby requests check that hash and count
// against a per-route limit here too. Storage is the object's synchronous SQLite-backed KV; every decision is made in
// one synchronous block after the async hashing, so concurrent calls cannot interleave a read and a write.
import { base64UrlEncode, constantTimeEqual, sha256Hex } from './encoding.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_AFTER_MS = 30 * 1000;
export const ISSUE_WINDOW_MS = 10 * 60 * 1000;
export const ISSUES_PER_WINDOW = 3;
/** Wrong codes per invitation (across codes) before the lock; a right code or the end of a lock resets the count. */
export const FAILURES_BEFORE_LOCK = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const PHOTO_UPLOADS_PER_SESSION = 3;
export const RATE_WINDOW_MS = 60 * 1000;

/** Per-invitation request limits per minute (§4.2): lobby steps 10/min, session start 6/min. */
export const LOBBY_LIMITS = {
  age: 10,
  notice: 10,
  consent: 10,
  photo: 10,
  start: 6,
} as const;
export type LobbyBucket = keyof typeof LOBBY_LIMITS;

/** The slice of `ctx.storage.kv` this logic uses (a Map-backed fake implements it in tests). */
export interface SyncKvLike {
  get<T = unknown>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
  delete(key: string): boolean;
}

interface Challenge {
  id: string;
  salt: string;
  hash: string;
  issuedAt: number;
  expiresAt: number;
}

interface RateWindow {
  start: number;
  n: number;
}

const K = {
  challenge: 'otp:challenge',
  issues: 'otp:issues',
  lockUntil: 'otp:lock_until',
  failures: 'otp:failures',
  lobbyNonce: 'lobby:nonce_hash',
  photoUploads: 'photo:uploads',
  photosClosed: 'photo:closed',
  rate: (bucket: LobbyBucket) => `rate:${bucket}`,
} as const;

export type Refusal =
  | {
      ok: false;
      error: 'otp_locked' | 'resend_too_soon' | 'rate_limited';
      retryAfterSeconds: number;
    }
  | { ok: false; error: 'otp_wrong' | 'token_invalid' | 'superseded' };

export type IssueResult =
  | {
      ok: true;
      code: string;
      challengeId: string;
      resendAfterSeconds: number;
      expiresInSeconds: number;
    }
  | Refusal;
/** `lockedNow` is set only on the wrong attempt that creates the lock (the route logs `otp.locked` once, SR-7). */
export type VerifyResult =
  | { ok: true; nonce: string }
  | Refusal
  | { ok: false; error: 'otp_locked'; retryAfterSeconds: number; lockedNow: true };
export type GateResult = { ok: true } | Refusal;
/** A photo upload slot, or why not: the 3 uploads are used (`rate_limited`) or the session started (`closed`). */
export type PhotoSlot = { ok: true; n: number } | { ok: false; error: 'rate_limited' | 'closed' };

export interface OtpCoreDeps {
  /** Epoch milliseconds (the object's own clock). */
  now?: () => number;
  /** Fills a buffer with random bytes. */
  random?: (bytes: Uint8Array) => Uint8Array;
}

const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

export class OtpCore {
  readonly #kv: SyncKvLike;
  readonly #now: () => number;
  readonly #random: (bytes: Uint8Array) => Uint8Array;

  constructor(kv: SyncKvLike, deps: OtpCoreDeps = {}) {
    this.#kv = kv;
    this.#now = deps.now ?? (() => Date.now());
    this.#random = deps.random ?? ((bytes) => crypto.getRandomValues(bytes));
  }

  /** A uniform 6-digit code (rejection sampling, no modulo bias). */
  #newCode(): string {
    const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
    for (;;) {
      const word = new DataView(this.#random(new Uint8Array(4)).buffer).getUint32(0);
      if (word < limit) return String(word % 1_000_000).padStart(6, '0');
    }
  }

  #token(bytes: number): string {
    return base64UrlEncode(this.#random(new Uint8Array(bytes)));
  }

  #locked(now: number): Refusal | null {
    const until = this.#kv.get<number>(K.lockUntil);
    if (until !== undefined && until > now) {
      return { ok: false, error: 'otp_locked', retryAfterSeconds: seconds(until - now) };
    }
    return null;
  }

  /** Issues a new challenge (the old one stops working), or refuses with the wait. */
  async issue(): Promise<IssueResult> {
    const code = this.#newCode();
    const salt = this.#token(16);
    const id = this.#token(16);
    const hash = await sha256Hex(`${salt}:${code}`);
    // From here on, synchronous: read, decide, write.
    const now = this.#now();
    const locked = this.#locked(now);
    if (locked !== null) return locked;
    const issues = (this.#kv.get<number[]>(K.issues) ?? []).filter(
      (t) => t > now - ISSUE_WINDOW_MS && t <= now,
    );
    const last = issues.length > 0 ? Math.max(...issues) : undefined;
    if (last !== undefined && now - last < RESEND_AFTER_MS) {
      return {
        ok: false,
        error: 'resend_too_soon',
        retryAfterSeconds: seconds(last + RESEND_AFTER_MS - now),
      };
    }
    if (issues.length >= ISSUES_PER_WINDOW) {
      const oldest = Math.min(...issues);
      return {
        ok: false,
        error: 'rate_limited',
        retryAfterSeconds: seconds(oldest + ISSUE_WINDOW_MS - now),
      };
    }
    const challenge: Challenge = {
      id,
      salt,
      hash,
      issuedAt: now,
      expiresAt: now + CODE_TTL_MS,
    };
    this.#kv.put(K.challenge, challenge);
    this.#kv.put(K.issues, [...issues, now]);
    return {
      ok: true,
      code,
      challengeId: id,
      resendAfterSeconds: RESEND_AFTER_MS / 1000,
      expiresInSeconds: CODE_TTL_MS / 1000,
    };
  }

  /** Checks a code against the current challenge. A success rotates the lobby nonce and returns the raw nonce. */
  async verify(code: string): Promise<VerifyResult> {
    if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code))
      return { ok: false, error: 'otp_wrong' };
    const before = this.#kv.get<Challenge>(K.challenge);
    const nonce = this.#token(24);
    const nonceHash = await sha256Hex(nonce);
    const candidate = await sha256Hex(`${before?.salt ?? ''}:${code}`);
    // From here on, synchronous.
    const now = this.#now();
    const locked = this.#locked(now);
    if (locked !== null) return locked;
    const challenge = this.#kv.get<Challenge>(K.challenge);
    if (challenge === undefined || before === undefined || challenge.id !== before.id) {
      return { ok: false, error: 'otp_wrong' };
    }
    if (challenge.expiresAt <= now) {
      this.#kv.delete(K.challenge);
      return { ok: false, error: 'otp_wrong' };
    }
    if (constantTimeEqual(candidate, challenge.hash)) {
      this.#kv.delete(K.challenge);
      this.#kv.delete(K.failures);
      this.#kv.put(K.lobbyNonce, nonceHash);
      return { ok: true, nonce };
    }
    // Wrong code: counted per invitation, across codes (SEC-3).
    const failures = (this.#kv.get<number>(K.failures) ?? 0) + 1;
    if (failures >= FAILURES_BEFORE_LOCK) {
      this.#kv.delete(K.challenge);
      this.#kv.delete(K.failures); // the end of this lock starts a fresh count
      this.#kv.put(K.lockUntil, now + LOCK_MS);
      return { ok: false, error: 'otp_locked', retryAfterSeconds: LOCK_MS / 1000, lockedNow: true };
    }
    this.#kv.put(K.failures, failures);
    return { ok: false, error: 'otp_wrong' };
  }

  /**
   * One lobby request: the token's nonce must be the current one (a newer login answers `superseded`, none stored
   * answers `token_invalid`), then the route's per-minute limit counts it. A stale token never uses the budget.
   */
  async lobbyGate(nonce: string, bucket: LobbyBucket): Promise<GateResult> {
    if (!Object.hasOwn(LOBBY_LIMITS, bucket)) return { ok: false, error: 'token_invalid' };
    if (typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 128) {
      return { ok: false, error: 'token_invalid' };
    }
    const presented = await sha256Hex(nonce);
    const now = this.#now();
    const stored = this.#kv.get<string>(K.lobbyNonce);
    if (stored === undefined) return { ok: false, error: 'token_invalid' };
    if (!constantTimeEqual(presented, stored)) return { ok: false, error: 'superseded' };
    const key = K.rate(bucket);
    const window = this.#kv.get<RateWindow>(key);
    const current =
      window !== undefined && now >= window.start && now - window.start < RATE_WINDOW_MS
        ? window
        : { start: now, n: 0 };
    if (current.n >= LOBBY_LIMITS[bucket]) {
      return {
        ok: false,
        error: 'rate_limited',
        retryAfterSeconds: seconds(current.start + RATE_WINDOW_MS - now),
      };
    }
    this.#kv.put(key, { start: current.start, n: current.n + 1 });
    return { ok: true };
  }

  /** Ends the lobby token (called when a session token is granted, §4.3). */
  clearLobbyNonce(): void {
    this.#kv.delete(K.lobbyNonce);
  }

  /**
   * Closes the start photo step for good (set-once; SEC-1). Session start (stream C1b) calls it on the invitation's
   * object before it reads the stored photo, so an upload still in progress can no longer take a slot and overwrite it.
   */
  closePhotos(): void {
    this.#kv.put(K.photosClosed, true);
  }

  #photoSlots(): number[] {
    const slots = this.#kv.get<unknown>(K.photoUploads);
    return Array.isArray(slots) ? slots.filter((n): n is number => typeof n === 'number') : [];
  }

  /**
   * Takes one of the 3 photo uploads of this invitation's session; `n` is its number (1..3), the lowest one free.
   * The slots in use are stored as their numbers, so a release gives back exactly the slot it names.
   */
  takePhotoSlot(): PhotoSlot {
    if (this.#kv.get<boolean>(K.photosClosed) === true) return { ok: false, error: 'closed' };
    const used = this.#photoSlots();
    if (used.length >= PHOTO_UPLOADS_PER_SESSION) return { ok: false, error: 'rate_limited' };
    let n = 1;
    while (used.includes(n)) n += 1;
    this.#kv.put(K.photoUploads, [...used, n]);
    return { ok: true, n };
  }

  /** Gives back slot `n` after its upload failed to store (SEC-4). A slot not in use is a no-op. */
  releasePhotoSlot(n: number): void {
    const used = this.#photoSlots();
    if (!used.includes(n)) return;
    this.#kv.put(
      K.photoUploads,
      used.filter((slot) => slot !== n),
    );
  }
}

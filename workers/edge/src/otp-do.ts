// InviteOtpDO (specs/d1-demo-slice.md §4.2 Durable Objects, R-9): SQLite-backed, `idFromName(invitation_id)` with the
// id from api's link-token lookup or from verified claims only. It lives in the edge Worker, which holds no database
// credential. Reached only over the DO RPC stub from this Worker (no fetch route). The logic is OtpCore over the
// object's synchronous KV (tested on a Map-backed fake: the test pool has no OTP binding).
import type { OtpPurpose } from '@trace/shared/contracts/candidate';
import { DurableObject } from 'cloudflare:workers';
import {
  OtpCore,
  type GateResult,
  type IssueResult,
  type LobbyBucket,
  type PhotoSlot,
  type PortalBucket,
  type VerifyResult,
} from './otp-core.js';

/** What the edge routes call on the object (the RPC stub and the test fake both have this shape). */
export interface OtpApi {
  /** M2 R5-19: the purpose is bound to the challenge here (default `lobby`). */
  issue(purpose?: OtpPurpose): Promise<IssueResult>;
  /** Undoes the current issue when its code could not be sent (SR-2). */
  releaseIssue(challengeId: string): void | Promise<void>;
  /** Answers the stored purpose; `allowed` refuses a challenge of another purpose (`lobby_closed`) untouched. */
  verify(code: string, allowed?: readonly OtpPurpose[]): Promise<VerifyResult>;
  lobbyGate(nonce: string, bucket: LobbyBucket): Promise<GateResult>;
  /** M2 R5-24: the portal nonce and the per-invitation portal limits. */
  portalGate(nonce: string, bucket: PortalBucket): Promise<GateResult>;
  clearLobbyNonce(): void | Promise<void>;
  takePhotoSlot(): PhotoSlot | Promise<PhotoSlot>;
  /** Gives back the slot of an upload whose R2 put failed (SEC-4). */
  releasePhotoSlot(n: number): void | Promise<void>;
  /** Set-once: no photo slot after this (session start calls it before reading the photo, SEC-1). */
  closePhotos(): void | Promise<void>;
}

export class InviteOtpDO extends DurableObject<Env> implements OtpApi {
  readonly #core: OtpCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#core = new OtpCore(ctx.storage.kv);
  }

  override fetch(): Promise<Response> {
    return Promise.resolve(new Response(null, { status: 404 }));
  }

  issue(purpose?: OtpPurpose): Promise<IssueResult> {
    return this.#core.issue(purpose);
  }

  releaseIssue(challengeId: string): void {
    this.#core.releaseIssue(challengeId);
  }

  verify(code: string, allowed?: readonly OtpPurpose[]): Promise<VerifyResult> {
    return this.#core.verify(code, allowed);
  }

  lobbyGate(nonce: string, bucket: LobbyBucket): Promise<GateResult> {
    return this.#core.lobbyGate(nonce, bucket);
  }

  portalGate(nonce: string, bucket: PortalBucket): Promise<GateResult> {
    return this.#core.portalGate(nonce, bucket);
  }

  clearLobbyNonce(): void {
    this.#core.clearLobbyNonce();
  }

  takePhotoSlot(): PhotoSlot {
    return this.#core.takePhotoSlot();
  }

  releasePhotoSlot(n: number): void {
    this.#core.releasePhotoSlot(n);
  }

  closePhotos(): void {
    this.#core.closePhotos();
  }
}

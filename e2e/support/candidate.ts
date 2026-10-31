// The candidate side at the API level: the edge routes of specs/d1-demo-slice.md §4.2, called like the candidate
// app calls them (JSON, `Authorization: Bearer <lobby|session token>`, the raw link token in a body only). Tokens,
// link tokens and codes stay in variables; nothing here prints one.
import { createHash } from 'node:crypto';
import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { jsonOf, poll, sleep } from './http.js';

export interface SessionView {
  sessionId: string;
  state: 'in_progress' | 'submitted' | 'auto_submitted';
  startedAt: string;
  deadlineAt: string;
  streamId: string;
  items: {
    position: number;
    sectionId: string;
    kind: 'mcq' | 'written';
    servedAt: string | null;
  }[];
}
export interface ServedItem {
  position: number;
  kind: 'mcq' | 'written';
  options?: { id: string; label: string }[];
  maxChars?: number;
}
export interface Receipt {
  receiptRef: string;
  submittedAt: string;
}

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

export interface Edge {
  resolve(token: string): Promise<APIResponse>;
  otpRequest(token: string): Promise<APIResponse>;
  otpVerify(token: string, code: string): Promise<APIResponse>;
  lobbyPost(path: string, lobbyToken: string, data: unknown): Promise<APIResponse>;
  lobbyGet(path: string, lobbyToken: string): Promise<APIResponse>;
  photo(lobbyToken: string, jpeg: Buffer): Promise<APIResponse>;
  sessionPost(path: string, sessionToken: string, data: unknown): Promise<APIResponse>;
  sessionGet(path: string, sessionToken: string): Promise<APIResponse>;
}

export const edgeClient = (request: APIRequestContext, origin: string): Edge => {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  return {
    resolve: (token) => request.post(`${origin}/v1/invite/resolve`, { data: { token } }),
    otpRequest: (token) => request.post(`${origin}/v1/otp/request`, { data: { token } }),
    otpVerify: (token, code) => request.post(`${origin}/v1/otp/verify`, { data: { token, code } }),
    lobbyPost: (path, lobbyToken, data) =>
      request.post(`${origin}${path}`, { headers: bearer(lobbyToken), data }),
    lobbyGet: (path, lobbyToken) =>
      request.get(`${origin}${path}`, { headers: bearer(lobbyToken) }),
    photo: (lobbyToken, jpeg) =>
      request.put(`${origin}/v1/lobby/photo`, {
        headers: {
          ...bearer(lobbyToken),
          'content-type': 'image/jpeg',
          'x-photo-sha256': sha256Hex(jpeg),
        },
        data: jpeg,
      }),
    sessionPost: (path, sessionToken, data) =>
      request.post(`${origin}${path}`, { headers: bearer(sessionToken), data }),
    sessionGet: (path, sessionToken) =>
      request.get(`${origin}${path}`, { headers: bearer(sessionToken) }),
  };
};

/**
 * Asks for an OTP, waiting out the 30-second resend gap (429 `resend_too_soon` with Retry-After) when a code was
 * sent a moment ago. Gives up after `timeoutMs`.
 */
export const requestOtp = async (edge: Edge, token: string, timeoutMs = 75_000) =>
  poll('an OTP request the edge accepts', { timeoutMs, everyMs: 0 }, async () => {
    const res = await edge.otpRequest(token);
    if (res.status() === 429) {
      const after = Number(res.headers()['retry-after'] ?? '5');
      await sleep(Math.min(Math.max(Number.isFinite(after) ? after : 5, 1), 35) * 1000);
      return undefined;
    }
    return jsonOf<{ resendAfterSeconds: number; expiresInSeconds: number; channel: string }>(
      res,
      200,
      'OTP request',
    );
  });

/**
 * A real start photo: a 320x240 canvas drawn and encoded by Chromium with `toBlob('image/jpeg', 0.85)`, as the
 * candidate app does (spec §4.5). The raw bytes carry APP0 (JFIF) and an APP2 ICC profile, which the edge refuses;
 * strip them with stripJpegMetadata (support/jpeg.ts, spec rev 4i) before hashing and uploading. Synthetic pixels:
 * a gradient and an oval, no camera.
 */
export const canvasJpeg = async (page: Page): Promise<Buffer> => {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    const gradient = ctx.createLinearGradient(0, 0, 320, 240);
    gradient.addColorStop(0, '#334466');
    gradient.addColorStop(1, '#99aabb');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#ffcc66';
    ctx.beginPath();
    ctx.ellipse(160, 120, 60, 80, 0, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (blob === null) throw new Error('toBlob gave no JPEG');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
};

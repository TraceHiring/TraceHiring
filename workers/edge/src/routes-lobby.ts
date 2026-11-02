// Lobby routes (specs/d1-demo-slice.md §4.1 steps 3-4, §4.2): Bearer `lobby` token, then the nonce and the
// 10/min-per-invitation limit in InviteOtpDO, then api with the raw token (api re-verifies it and re-checks the step
// order: age before consent). An under-18 answer is 403 `not_eligible` and nothing else is created (rule 9).
import { AgeDeclareReq, ConsentReq, NoticeRes, OkRes } from '@trace/shared/contracts/candidate';
import type { Hono } from 'hono';
import {
  capBody,
  fail,
  handle,
  LOBBY_BODY_LIMIT,
  readJson,
  sendJson,
  type EdgeEnv,
} from './http.js';
import { lobbyAuth, rpc, type RouteDeps } from './route-support.js';

export const mountLobbyRoutes = (app: Hono<EdgeEnv>, deps: RouteDeps): void => {
  app.post(
    '/v1/lobby/age',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { lobbyToken } = await lobbyAuth(c, deps, 'age');
      const { adult } = await readJson(c, AgeDeclareReq);
      const out = await rpc(c, deps, 'ageDeclare', { lobbyToken, adult });
      if (out.blocked) return fail('not_eligible');
      return sendJson(c, OkRes, { ok: true });
    }),
  );

  app.get(
    '/v1/lobby/notice',
    handle(async (c) => {
      const { lobbyToken } = await lobbyAuth(c, deps, 'notice');
      const notice = await rpc(c, deps, 'noticeGet', { lobbyToken });
      return sendJson(c, NoticeRes, notice);
    }),
  );

  app.post(
    '/v1/lobby/consent',
    capBody(LOBBY_BODY_LIMIT),
    handle(async (c) => {
      const { lobbyToken } = await lobbyAuth(c, deps, 'consent');
      const body = await readJson(c, ConsentReq);
      await rpc(c, deps, 'consentRecord', { lobbyToken, ...body });
      return sendJson(c, OkRes, { ok: true });
    }),
  );
};

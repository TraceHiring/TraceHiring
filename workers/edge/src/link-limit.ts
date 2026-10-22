// Coarse volumetric limit for the three routes that reach api's database with a raw link token (specs/d1-demo-slice.md
// §4.2, §11 OPEN-13; C1a security review SEC-2): `invite/resolve`, `otp/request`, `otp/verify`. It protects the
// database from a loop of random tokens; it is never an integrity signal (rule 7). The Workers Rate Limiting binding
// `LINK_LIMITER` is asked with one constant key per route: never an IP, header, token, id or any value from the request,
// and nothing is recorded per candidate. Counts are per Cloudflare location and eventually consistent, so the cap is
// coarse by design. A refusal is 429 `rate_limited` (`Retry-After` = the 10 s period); a missing or failing limiter
// fails closed with 503 `unavailable`. Each log line carries the route label only and is written at most once per
// route per 10 s per isolate, so a flood does not flood Workers Logs. The OTP limits per invitation (InviteOtpDO, Q47)
// are separate and unchanged.
import { fail, type EdgeContext } from './http.js';
import { loggerFor, type RouteDeps } from './route-support.js';

/** The constant label of each limited route; the only value a log line carries. */
export type LinkRoute = 'resolve' | 'otp_request' | 'otp_verify';

/** One constant key per route (OPEN-13): a counter per route, shared by every caller. */
const LINK_LIMIT_KEYS: Readonly<Record<LinkRoute, string>> = {
  resolve: 'link:resolve',
  otp_request: 'link:otp_request',
  otp_verify: 'link:otp_verify',
};

/** The binding's period (wrangler.jsonc `simple.period`), sent as `Retry-After`. */
export const LINK_LIMIT_PERIOD_SECONDS = 10;
const LOG_EVERY_MS = 10_000;

/** Throws the edge's answer when the route's counter is spent (429) or the limiter cannot answer (503). */
export type LinkLimit = (c: EdgeContext, route: LinkRoute) => Promise<void>;

/**
 * The limiter check of one app. Call it after the body is capped and strictly parsed (a malformed body never counts)
 * and before any api call. The log throttle lives with the app, so it is per isolate.
 */
export const createLinkLimit = (deps: RouteDeps): LinkLimit => {
  const lastLogged = new Map<string, number>();
  /** True at most once per event and route per 10 s of the injected clock. */
  const shouldLog = (event: string, route: LinkRoute): boolean => {
    const now = deps.now().getTime();
    const slot = `${event}:${route}`;
    const last = lastLogged.get(slot);
    if (last !== undefined && now - last < LOG_EVERY_MS) return false;
    lastLogged.set(slot, now);
    return true;
  };

  return async (c, route) => {
    let success: unknown;
    try {
      const limiter = c.env.LINK_LIMITER;
      if (limiter === undefined) throw new Error('no limiter');
      success = (await limiter.limit({ key: LINK_LIMIT_KEYS[route] })).success;
      if (typeof success !== 'boolean') throw new Error('no outcome');
    } catch {
      if (shouldLog('error', route)) {
        loggerFor(c, deps).error('edge.rate_limiter_error', { route });
      }
      return fail('unavailable');
    }
    if (success) return;
    if (shouldLog('limited', route)) loggerFor(c, deps).warn('edge.rate_limited', { route });
    return fail('rate_limited', LINK_LIMIT_PERIOD_SECONDS);
  };
};

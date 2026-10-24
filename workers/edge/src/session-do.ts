// SessionDO (specs/d1-demo-slice.md §4.2 Durable Objects, §4.4, D1-4): SQLite-backed, `idFromName(invitation_id)` with
// the id from verified claims only. Reached only over the DO RPC stub from this Worker (no fetch route). A thin
// wrapper: the logic is SessionCore over the object's synchronous KV, its single alarm, the read-only package bucket
// (get only), the evidence bucket and the mirror queue (tested on fakes: the test pool has no SESSION binding).
// The object never reads Postgres and holds no secret.
import { DurableObject } from 'cloudflare:workers';
import type { ClientEvent, SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { edgeLogger } from './route-support.js';
import {
  SessionCore,
  type AttachResult,
  type EventsResult,
  type ItemResult,
  type MediaResult,
  type SessionApi,
  type SessionAuth,
  type StartInput,
  type StartResult,
  type SubmitResult,
} from './session-core.js';

export class SessionDO extends DurableObject<Env> implements SessionApi {
  readonly #core: SessionCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const storage = ctx.storage;
    this.#core = new SessionCore({
      kv: storage.kv,
      transaction: (fn) => storage.transactionSync(fn),
      alarm: {
        set: (atMs) => storage.setAlarm(atMs),
        clear: () => storage.deleteAlarm(),
      },
      packages: {
        get: async (key) => {
          const found = await env.PACKAGES?.get(key);
          if (found === undefined) throw new Error('packages_unbound');
          if (found === null) return null;
          return {
            size: found.size,
            bytes: async () => new Uint8Array(await found.arrayBuffer()),
          };
        },
      },
      evidence: {
        put: async (key, body, contentType) => {
          const bucket = env.EVIDENCE;
          if (bucket === undefined) throw new Error('evidence_unbound');
          await bucket.put(key, body, { httpMetadata: { contentType } });
        },
      },
      mirror: {
        send: async (message: SessionMirrorMessage) => {
          // MIRROR_TRANSPORT 'service' (DC-D2 fallback) has no binding on the edge yet: the send fails, the mirror
          // stays pending and the jobs sweep recovers the session from mirror.json.
          const queue = env.MIRROR_QUEUE;
          if (env.MIRROR_TRANSPORT !== 'queue' || queue === undefined) {
            throw new Error('mirror_transport_unavailable');
          }
          await queue.send(message, { contentType: 'json' });
        },
      },
      log: edgeLogger(env.VERSION),
    });
  }

  override fetch(): Promise<Response> {
    return Promise.resolve(new Response(null, { status: 404 }));
  }

  override async alarm(): Promise<void> {
    await this.#core.alarm();
  }

  start(input: StartInput): Promise<StartResult> {
    return this.#core.start(input);
  }

  attach(auth: SessionAuth): Promise<AttachResult> {
    return this.#core.attach(auth);
  }

  item(auth: SessionAuth, position: number, afterSeq?: number): Promise<ItemResult> {
    return this.#core.item(auth, position, afterSeq);
  }

  media(auth: SessionAuth, hash: string): Promise<MediaResult> {
    return this.#core.media(auth, hash);
  }

  events(
    auth: SessionAuth,
    batch: { streamId: string; events: ClientEvent[] },
  ): Promise<EventsResult> {
    return this.#core.events(auth, batch);
  }

  submit(
    auth: SessionAuth,
    request: { streamId: string; finalSeq: number },
  ): Promise<SubmitResult> {
    return this.#core.submit(auth, request);
  }
}

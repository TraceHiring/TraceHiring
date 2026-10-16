// Worker entry. workerd requires every named export of the main module to be a handler or a Durable Object class,
// so helpers (createHandler, signLink, TTL_SECONDS, types) live in ./handler.ts and are imported by the tests from there.
import { createHandler, MediaLinkDO, type Env } from './handler.ts';

export { MediaLinkDO };

const handler = createHandler();

export default {
  fetch: (req: Request, env: Env) => handler.fetch(req, env),
};

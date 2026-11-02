// `cloudflare:sockets` for the Node real-database tests (vitest.db.config.ts alias). Production code imports it as the
// default transport; these tests always inject a Node socket instead, so reaching this stub is a test bug.
export const connect = (): never => {
  throw new Error(
    'db-test: inject a ConnectFn (nodeConnect); cloudflare:sockets is not available in Node',
  );
};

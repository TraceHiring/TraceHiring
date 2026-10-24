// DC-D8: aggregate cpuTime per Worker and entry point from `wrangler tail --format json` files (a stream of
// pretty-printed JSON objects). Prints aggregates only: never logs, headers, bodies or query strings.
import { readFileSync } from 'node:fs';

const parseStream = (text) => {
  const out = [];
  let depth = 0,
    start = -1,
    inStr = false,
    esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth++ === 0) start = i;
    } else if (c === '}') {
      if (--depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          /* skip a partial object */
        }
        start = -1;
      }
    }
  }
  return out;
};

const ID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d{3,}|[A-Za-z0-9_-]{24,}/g;
const entry = (e) => {
  const ev = e.event ?? {};
  if (ev.request?.url) {
    const u = new URL(ev.request.url);
    return `${ev.request.method} ${u.pathname.replace(ID, ':id')}`;
  }
  if (ev.rpcMethod) return `rpc ${ev.rpcMethod}`;
  if (ev.queue) return `queue ${ev.queue} (batch ${ev.batchSize ?? '?'})`;
  if (ev.cron !== undefined) return `scheduled ${ev.cron}`;
  if (e.entrypoint) return `entrypoint ${e.entrypoint}`;
  return `other ${Object.keys(ev).sort().join(',') || e.eventType || '?'}`;
};
const pct = (s, p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];

const rows = [];
for (const file of process.argv.slice(2)) {
  const groups = new Map();
  for (const e of parseStream(readFileSync(file, 'utf8'))) {
    if (typeof e.cpuTime !== 'number') continue;
    const tag = (e.scriptTags ?? []).find((t) => t.startsWith('cf:service=')) ?? file;
    const k = `${tag.replace('cf:service=', '')} | ${e.executionModel ?? ''} | ${entry(e)}`;
    if (!groups.has(k)) groups.set(k, { cpu: [], wall: [], outcomes: new Map() });
    const g = groups.get(k);
    g.cpu.push(e.cpuTime);
    g.wall.push(e.wallTime ?? 0);
    g.outcomes.set(e.outcome, (g.outcomes.get(e.outcome) ?? 0) + 1);
  }
  for (const [k, g] of groups) {
    const c = [...g.cpu].sort((a, b) => a - b);
    const w = [...g.wall].sort((a, b) => a - b);
    rows.push({
      k,
      n: c.length,
      p50: pct(c, 50),
      p95: pct(c, 95),
      max: c.at(-1),
      over10: c.filter((x) => x > 10).length,
      wallP95: pct(w, 95),
      outcomes: [...g.outcomes].map(([o, n]) => `${o}:${n}`).join(' '),
    });
  }
}
rows.sort((a, b) => b.max - a.max);
console.log(
  '| Worker / model / entry point | n | CPU p50 ms | CPU p95 ms | CPU max ms | n > 10 ms | wall p95 ms | outcomes |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows)
  console.log(
    `| ${r.k} | ${r.n} | ${r.p50} | ${r.p95} | ${r.max} | ${r.over10} | ${r.wallP95} | ${r.outcomes} |`,
  );

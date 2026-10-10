import { useState } from 'react';
import { api } from '../../api';
import { ErrorNote } from '../../ui';

// ---------------------------------------------------------------------------
// Bulk invite
// ---------------------------------------------------------------------------

const SAMPLE_NAMES = [
  'Aarav Sharma', 'Priya Iyer', 'Rohan Mehta', 'Ananya Reddy', 'Vikram Singh',
  'Sneha Kulkarni', 'Arjun Nair', 'Kavya Menon', 'Rahul Verma', 'Ishita Banerjee',
];

function sampleText(): string {
  const stamp = Date.now().toString(36).slice(-4);
  return SAMPLE_NAMES.map((n) => {
    const [first, last] = n.toLowerCase().split(' ');
    return `${n}, ${first}.${last}.${stamp}@example.com`;
  }).join('\n');
}

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

interface ParsedLine { line: number; name: string; email: string }
interface InvalidLine { line: number; text: string; reason: string }

export function parseBulk(text: string): { valid: ParsedLine[]; invalid: InvalidLine[] } {
  const valid: ParsedLine[] = [];
  const invalid: InvalidLine[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  const split = (t: string) => t.split(/[,\t;]/).map((p) => p.trim().replace(/^"|"$/g, '').trim());
  const firstIdx = lines.findIndex((l) => l.trim());
  // Optional CSV header row: locate the name and email columns (any order, extra columns ignored).
  let nameCol = 0;
  let emailCol = 1;
  let headerIdx = -1;
  if (firstIdx >= 0) {
    const h = split(lines[firstIdx]).map((x) => x.toLowerCase());
    const e = h.findIndex((x) => /^e-?mail( address)?$/.test(x));
    const n = h.findIndex((x) => /^(candidate[ _]?)?(full[ _]?)?name$/.test(x));
    if (e >= 0 && n >= 0) { nameCol = n; emailCol = e; headerIdx = firstIdx; }
  }
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || i === headerIdx) return;
    const parts = split(t);
    const name = parts[nameCol] ?? '';
    const email = parts[emailCol] ?? '';
    let reason: string | null = null;
    if (parts.length < 2) reason = EMAIL_RE.test(t) ? 'Missing name' : 'Expected “Name, email”';
    else if (!name) reason = 'Missing name';
    else if (!email) reason = 'Missing email';
    else if (!EMAIL_RE.test(email)) reason = 'Invalid email';
    else if (seen.has(email.toLowerCase())) reason = 'Duplicate email';
    if (reason) invalid.push({ line: i + 1, text: t, reason });
    else {
      seen.add(email.toLowerCase());
      valid.push({ line: i + 1, name, email });
    }
  });
  return { valid, invalid };
}

interface BulkResult { name: string; email: string; link?: string; error?: string }

export function BulkInvite({ testId, onInvited }: { testId: string; onInvited: () => void }) {
  const [text, setText] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { valid, invalid } = parseBulk(text);
  const busy = progress !== null && progress.done < progress.total;

  async function run() {
    setError(null);
    setCopied(false);
    setResults([]);
    setProgress({ done: 0, total: valid.length });
    const out: BulkResult[] = [];
    for (let i = 0; i < valid.length; i++) {
      const c = valid[i];
      try {
        const r = await api.invite(testId, { name: c.name, email: c.email });
        out.push({ name: c.name, email: c.email, link: window.location.origin + r.link });
      } catch (e) {
        out.push({ name: c.name, email: c.email, error: (e as Error).message });
      }
      setResults([...out]);
      setProgress({ done: i + 1, total: valid.length });
    }
    onInvited();
  }

  async function copyAll() {
    const lines = results.filter((r) => r.link).map((r) => `${r.name}\t${r.email}\t${r.link}`).join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
    } catch {
      setError('Could not copy automatically — select the links in the table and copy them manually.');
    }
  }

  const ok = results.filter((r) => r.link).length;

  return (
    <div>
      <p className="caption muted" style={{ marginTop: 0 }}>
        One candidate per line as <span className="mono">Name, email</span> — or paste a CSV with a <span className="mono">name,email</span> header. Synthetic data only.
      </p>
      <textarea
        className="rc-bulk-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'name,email\nAarav Sharma, aarav.sharma@example.com'}
        disabled={busy}
        aria-label="Candidates to invite"
      />
      <div className="row gap8 wrap" style={{ marginTop: 8, alignItems: 'center' }}>
        <button onClick={() => setText(sampleText())} disabled={busy}>Load 10 sample candidates</button>
        <button className="primary" onClick={run} disabled={busy || valid.length === 0}>
          {busy ? 'Inviting…' : valid.length ? `Invite ${valid.length} candidate${valid.length === 1 ? '' : 's'}` : 'Invite candidates'}
        </button>
        <span className="caption muted">
          {valid.length} valid{invalid.length > 0 && <> · <span className="rc-bad">{invalid.length} invalid</span></>}
        </span>
      </div>

      {invalid.length > 0 && (
        <ul className="rc-invalid">
          {invalid.map((l) => (
            <li key={l.line}><span className="mono">Line {l.line}</span> — {l.reason}: <span className="muted">{l.text}</span></li>
          ))}
        </ul>
      )}

      {progress && (
        <div style={{ marginTop: 12 }}>
          <div className="caption">
            {busy ? `Inviting ${progress.done}/${progress.total}…` : `Done — ${ok} of ${progress.total} invited${ok < progress.total ? `, ${progress.total - ok} failed` : ''}.`}
          </div>
          <div className="rc-progress"><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
        </div>
      )}
      <ErrorNote error={error} />

      {results.length > 0 && (
        <>
          <div className="row gap8 wrap" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <strong style={{ fontSize: 14 }}>Invite links</strong>
            <button onClick={copyAll} disabled={busy || ok === 0}>{copied ? 'Copied' : 'Copy all links'}</button>
          </div>
          <div className="rc-table-wrap" style={{ marginTop: 8 }}>
            <table className="rc-table">
              <thead><tr><th>Candidate</th><th>Invite link</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.email}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      <div className="caption muted">{r.email}</div>
                    </td>
                    <td>
                      {r.link
                        ? <a className="mono rc-bulk-link" href={r.link} target="_blank" rel="noreferrer">{r.link}</a>
                        : <span className="rc-bad caption">{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

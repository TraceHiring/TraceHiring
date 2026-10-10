import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { AppShell, Card, ErrorNote } from '../../ui';
import type { Item, McqItem, TestSummary, WrittenItem } from '../../shared/types';
import './recruiter.css';

const newId = () => 'itm_' + Math.random().toString(36).slice(2, 10);

const blankMcq = (): McqItem => ({ id: newId(), kind: 'mcq', prompt: '', options: ['', '', '', ''], correctIndex: 0, points: 10 });
const blankWritten = (): WrittenItem => ({ id: newId(), kind: 'written', prompt: '', rubric: [], minWords: 40, points: 20 });

function sampleItems(): Item[] {
  return [
    {
      id: newId(), kind: 'mcq', points: 10, correctIndex: 1,
      prompt: 'A customer says their order shows "delivered" but they have not received it. What is the best first step?',
      options: ['Issue a full refund immediately', 'Apologise, verify the address and check the courier proof of delivery', 'Ask them to wait another week', 'Escalate to the legal team'],
    },
    {
      id: newId(), kind: 'mcq', points: 10, correctIndex: 2,
      prompt: 'Which of these is the most appropriate response time target for a priority-1 support ticket?',
      options: ['48 hours', '24 hours', '1 hour', 'Next business week'],
    },
    {
      id: newId(), kind: 'mcq', points: 10, correctIndex: 0,
      prompt: 'If 3 agents resolve 90 tickets in 6 hours, how many tickets does one agent resolve per hour on average?',
      options: ['5', '15', '30', '10'],
    },
    {
      id: newId(), kind: 'written', points: 20, minWords: 50,
      prompt: 'An angry customer has been charged twice for the same order. Write the reply you would send.',
      rubric: ['apologise', 'refund', 'timeline', 'reference'],
    },
  ];
}

export default function RecruiterHome() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = () => api.listTests().then(setTests).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function reset() {
    if (!window.confirm('Reset all demo data to the seeded state?')) return;
    setResetting(true);
    try {
      await api.reset();
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setResetting(false);
    }
  }

  return (
    <AppShell>
      <div className="rc-head">
        <div>
          <div className="overline">Recruiter workspace</div>
          <h1>Assessments</h1>
          <p className="muted">Answer Quality and Integrity Signals are kept as two separate results. Shortlist on quality; review integrity only for the shortlist.</p>
        </div>
        <div className="row gap8">
          <button onClick={reset} disabled={resetting}>{resetting ? 'Resetting…' : 'Reset demo data'}</button>
          <button className="primary" onClick={() => setBuilding((b) => !b)}>{building ? 'Close builder' : 'New assessment'}</button>
        </div>
      </div>
      <ErrorNote error={error} />
      {building && <Builder onCancel={() => setBuilding(false)} />}

      {tests === null && !error && <p className="muted">Loading assessments…</p>}
      {tests && tests.length === 0 && (
        <Card><div className="rc-empty">No assessments yet. Create one with “New assessment”.</div></Card>
      )}
      {tests && tests.length > 0 && (
        <div className="grid2">
          {tests.map((s) => (
            <Link key={s.test.id} to={`/recruiter/tests/${s.test.id}`} className="card rc-test-card">
              <div className="row between gap8">
                <span className="overline">{s.test.role}</span>
                <span className="tag">{s.test.mode === 'strict' ? 'Strict mode' : 'Standard mode'}</span>
              </div>
              <h3 style={{ marginTop: 6 }}>{s.test.title}</h3>
              <div className="caption muted">
                {Math.round(s.test.durationSec / 60)} min · {s.test.items.length} questions
              </div>
              <div className="rc-counts">
                <div className="rc-count"><div className="num">{s.invited}</div><div className="caption muted">Invited</div></div>
                <div className="rc-count"><div className="num">{s.submitted}</div><div className="caption muted">Submitted</div></div>
                <div className="rc-count"><div className="num">{s.shortlisted}</div><div className="caption muted">Shortlisted</div></div>
              </div>
              <div className="row gap8 wrap caption">
                <span className="muted">Ruleset</span>
                <span className="mono">{s.test.rulesetVersion}</span>
                {s.test.rulesetFrozen && <span className="tag" title="Ruleset froze when the first candidate started">frozen</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Builder({ onCancel }: { onCancel: () => void }) {
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [minutes, setMinutes] = useState(20);
  const [mode, setMode] = useState<'standard' | 'strict'>('standard');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (id: string, patch: Partial<McqItem> | Partial<WrittenItem>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? ({ ...x, ...patch } as Item) : x)));
  const remove = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));

  function loadSample() {
    setItems(sampleItems());
    if (!title) setTitle('Customer Support Associate — Screening');
    if (!role) setRole('Customer Support Associate');
  }

  function validate(): string | null {
    if (!title.trim()) return 'Give the assessment a title.';
    if (!role.trim()) return 'Add the role being hired for.';
    if (!(minutes > 0)) return 'Duration must be at least 1 minute.';
    if (items.length === 0) return 'Add at least one question (or load the sample questions).';
    for (const [i, it] of items.entries()) {
      if (!it.prompt.trim()) return `Question ${i + 1} needs a prompt.`;
      if (it.kind === 'mcq' && it.options.some((o) => !o.trim())) return `Question ${i + 1} needs all 4 options filled in.`;
      if (!(it.points > 0)) return `Question ${i + 1} needs points above 0.`;
    }
    return null;
  }

  async function create() {
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError(null);
    try {
      const t = await api.createTest({ title: title.trim(), role: role.trim(), durationSec: Math.round(minutes * 60), mode, items });
      nav(`/recruiter/tests/${t.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Card
      className="rc-builder"
      title="New assessment"
      actions={<button onClick={loadSample}>Load sample questions</button>}
    >
      <div className="rc-form-grid">
        <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sales Associate — Round 1" /></label>
        <label>Role<input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Sales Associate" /></label>
        <label>Duration (minutes)<input type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
        <label>Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as 'standard' | 'strict')}>
            <option value="standard">Standard</option>
            <option value="strict">Strict (fullscreen + camera stills)</option>
          </select>
        </label>
      </div>

      <div className="divider" />
      <div className="row between wrap gap8" style={{ marginBottom: 12 }}>
        <div className="overline">Questions ({items.length})</div>
        <div className="row gap8">
          <button onClick={() => setItems((xs) => [...xs, blankMcq()])}>+ Multiple choice</button>
          <button onClick={() => setItems((xs) => [...xs, blankWritten()])}>+ Written answer</button>
        </div>
      </div>

      {items.length === 0 && <div className="rc-empty caption">No questions yet. Add one above or load the sample set.</div>}
      {items.map((it, i) => (
        <div key={it.id} className="rc-item">
          <div className="row between gap8" style={{ marginBottom: 8 }}>
            <div className="row gap8">
              <strong>Q{i + 1}</strong>
              <span className="tag">{it.kind === 'mcq' ? 'Multiple choice' : 'Written'}</span>
            </div>
            <button className="danger" onClick={() => remove(it.id)}>Remove</button>
          </div>
          <label>Prompt
            <textarea value={it.prompt} onChange={(e) => update(it.id, { prompt: e.target.value })} />
          </label>
          {it.kind === 'mcq' ? (
            <div className="col gap8" style={{ marginTop: 10, alignItems: 'stretch' }}>
              <span className="caption muted">Options — select the correct one</span>
              {it.options.map((o, oi) => (
                <div key={oi} className="rc-opt">
                  <input
                    type="radio" name={`correct-${it.id}`} checked={it.correctIndex === oi}
                    onChange={() => update(it.id, { correctIndex: oi })} aria-label={`Mark option ${oi + 1} correct`}
                  />
                  <input
                    type="text" value={o} placeholder={`Option ${oi + 1}`}
                    onChange={(e) => update(it.id, { options: it.options.map((x, xi) => (xi === oi ? e.target.value : x)) })}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="rc-form-grid" style={{ marginTop: 10 }}>
              <label>Rubric keywords (comma-separated)
                <input
                  type="text" value={(it.rubric ?? []).join(', ')}
                  onChange={(e) => update(it.id, { rubric: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="apologise, refund, timeline"
                />
              </label>
              <label>Minimum words
                <input type="number" min={0} value={it.minWords} onChange={(e) => update(it.id, { minWords: Number(e.target.value) })} />
              </label>
            </div>
          )}
          <label style={{ marginTop: 10, maxWidth: 140 }}>Points
            <input className="rc-num" type="number" min={1} value={it.points} onChange={(e) => update(it.id, { points: Number(e.target.value) })} />
          </label>
        </div>
      ))}

      <ErrorNote error={error} />
      <div className="row gap8" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create assessment'}</button>
      </div>
    </Card>
  );
}

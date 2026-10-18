# Session plan — one big task per chat (Claude Max)

Founder, 2026-10-18: the account moved from Pro to **Max**. The old rule "work until 95% of the 5-hour window" was made for
Pro, where the window ran out before the context did. On Max the context fills first, and a long chat loses quality.
From now on: **one chat = one big task**. The chat ends when its task is done (merged, verified, tagged) and prints the
prompt for the next chat. This file is the roadmap; HANDOFF.md says which chat is next.

## How each chat runs
1. **Start:** fetch, read `docs/progress/RESUME-PROMPT.md` §3 steps 1-3, this file, `HANDOFF.md`; verify (5-line report).
   The repo wins over any handoff or memory.
2. **One task, with a "done when"** (below). The lead (Opus) orchestrates and stays light: it reads the summaries,
   decides, places lead-only files, runs the full checks and merges. Broad reading, writing and reviewing go to agents.
3. **Agents in parallel inside the chat:** up to **3 writers** (each in its own worktree reset to an exact SHA, strict
   directories) plus up to **3 read-only reviewers** at once. Opus for writers of code that touches rules 1-9 and for
   first reviews; Sonnet for mechanical writers and small re-reviews. Start the next stream's writer while the current
   stream is in review, when their directories do not overlap.
4. **Quality gates never change:** tests first; spec-reviewer + security-reviewer (+ database-reviewer for SQL) before any
   merge; every finding fixed or dispositioned in `docs/reviews/`; `--no-ff` merge; full `pnpm verify`
   (`npm_config_workspace_concurrency=1` on this machine); Linux CI green on PR #4; `cp/*` tag.
5. **Stop when:** the task is done, **or** context passes ~50%, **or** the 5-hour window passes 90% (start no new agent
   after 80%). Then the `trace-handoff` skill (STEP 5: handoff, LOG row, backup, gitleaks, push) and print the next
   chat's prompt (§4 of RESUME-PROMPT, with the task line from the table below).
6. **Parallel chats:** only for disjoint, docs-only or read-only work (for example writing the next milestone's spec draft).
   Never two chats that run `pnpm verify`, `db reset` or `supabase` at the same time (one shared database, short RAM).

## Roadmap to D1 CLOSE (each row = one chat)
| Chat | Task | Done when |
| --- | --- | --- |
| **A** (2026-10-18) | **C1a close-out:** AT-D31/D32 edge tests, spec + security review, fixes, merge; start the C1b writer; this plan | C1a merged, full verify + CI green, `cp/d1-06`; C1b writer branch recorded |
| **B** | **C1b (SessionDO + session routes):** finish the writer's gaps; lead adds test-pool bindings so the real `InviteOtpDO`, `SessionDO`, `DemoOutboxDO`, `MediaLinkDO` run in tests (C1a SR-6); wire `closePhotos()` at start (C1a SEC-1); spec + security review; fixes | C1b merged, AT-D24-D27 (edge), D35, D37 green, full verify + CI, `cp/d1-07` |
| **C** | **Wave 2a: R2 jobs** (mirror pipeline, quality, integrity, sweep; Opus) **in parallel with R4 recruiter app** (Sonnet writer, Opus review) | both merged, database review done, full verify + CI, `cp/d1-08` |
| **D** | **Wave 2b: C2 candidate app** (camera, blur, CSP, S12) + lead wiring + `e2e-local` with the real flow (closes r3a #1, the real trace_api SQL) | C2 merged, e2e-local green on Linux CI, `cp/d1-09` |
| **E** | **Staging readiness:** OPEN-13 (edge volumetric limit), carried items due before staging, then the founder gates (Cloudflare token R2 + Queues Edit, key script, `staging` vars) → first `workflow_dispatch`, smoke, DC-D8; R5 e2e on staging | staging deployed and smoked; AT-D1/D2 E2E green, `cp/d1-10` |
| **F** | **D1 REVIEW** (fresh chat, `trace-milestone-review`) | `docs/reviews/D1.md` with a verdict |
| **G** | **D1 FIX + CLOSE** of M0a, M0b, D1 (each merge into `main` only with the founder's explicit go-ahead) | `m0a-reviewed`, `m0b-reviewed`, `d1-reviewed` tags, summaries |

## After D1: the pattern for every milestone (build-order.md)
- **SPEC chat** (1): `specs/<module>.md`, spec-reviewer + database-reviewer, approved. A spec chat may run in parallel
  with a BUILD chat of the previous milestone (docs only).
- **BUILD chats** (1 per wave, usually 2-3): writers in parallel inside the chat, reviewed and merged stream by stream.
- **REVIEW chat** (1, fresh): `trace-milestone-review`.
- **FIX + CLOSE chat** (1): findings fixed, founder go-ahead for `main`.
- Order: M1 ∥ M2 (one SPEC chat for both, then BUILD chats per stream) → M3a → M3b (critical path) → M4 ∥ M5 (M4 needs
  the design-partner LOI, founder gate) → M6 → M7 → M8 closed-beta gate (founder sign-off) → M9-M13.

## Usage on Max (measured, update as we learn)
- Chat A start: 0% of the 5-hour window; two Opus reviews + one Opus writer in parallel ≈ 5% in the first ~30 minutes.
- Chat B (C1b): 2 Opus reviews + 3 Opus writers in parallel + 1 Sonnet re-review, two full verifies: 14% → ~28% of the
  5-hour window, 2% → ~4% weekly, context ~30%, about 1 h 45 min. Parallel fix writers on disjoint regions of the same
  file merged cleanly with `--no-ff`.
- Weekly limits matter more on Max than the 5-hour window: check `get_usage` after each agent result and record the
  weekly figure in the LOG row.

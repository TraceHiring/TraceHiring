// AT-M1-24 (rules 1, 2, 4, 6, 7; specs/m1-test-authoring.md §6.10, R5-22, R5-25): the M1 counterpart of
// d1-guards.test.tsx. D1's word lists apply unchanged to every M1 screen: no control or label for reject, decline,
// shortlist, decision, confirm, overturn, notice or appeal (item review says "Approve" / "Send back"), none of those
// words anywhere, no combined number, no band outside the integrity card (M1 has no card, so no band at all), no
// row selection or bulk action, no gaze, emotion, face-match, IP, ASN or device text, no AI-likeness or solvability,
// no inline style. The route table, the nav and the role gates are pinned too.
//
// The screens come from two places: the ten route modules, rendered here, and every
// `m1-screens.test-helpers.tsx` file under src/ (a later stream registers the views it builds there by exporting
// `m1Screens(): Record<string, ReactNode>` of synthetic-data renders; this file needs no change when it does).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiContext, OrgInfoContext, type OrgInfo } from '../api/runtime';
import { registeredM1Screens } from '../m1-screen-registry.test-helpers';
import { AiDraftsRoute } from '../bank/AiDraftsRoute';
import { ApprovalsRoute } from '../bank/ApprovalsRoute';
import { BankRoute } from '../bank/BankRoute';
import { ImportRoute } from '../bank/import/ImportRoute';
import { ItemRoute } from '../bank/ItemRoute';
import { PoolsRoute } from '../bank/PoolsRoute';
import { LibraryRoute } from '../library/LibraryRoute';
import { BAND_LABEL } from '../reports/labels';
import { routes as builtRoutes, buildRoutes } from '../routes';
import { IntegrityLocksRoute } from '../settings/IntegrityLocksRoute';
import { MembersRoute } from '../settings/MembersRoute';
import { NO_ACCESS_TEXT, navFor } from '../shell/nav';
import { SignedInView } from '../shell/SignedIn';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '77777777-7777-4777-8777-777777777777';
const wrap = (node: ReactNode, at = '/') =>
  renderToString(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#x27;/g, '"')
    .replace(/\s+/g, ' ');
const info = (roles: string[]): OrgInfo => ({
  orgId: ORG_ID,
  orgName: 'Synthetic Staffing',
  userId: USER_ID,
  roles,
});

// D1's lists, copied unchanged (parity is checked against d1-guards.test.tsx below).
const CONTROL_WORDS =
  /\b(?:reject\w*|decline\w*|shortlist\w*|decision\w*|confirm\w*|overturn\w*|notice\w*|appeal\w*)\b/i;
const ANYWHERE_WORDS =
  /\b(?:reject\w*|decline\w*|shortlist\w*|overturn\w*|appeal\w*|confirm\w*)\b/i;
const COMBINED = /\b(?:overall|combined|total|trust|honesty|composite)\b/i;
const GAZE_ASN_IP =
  /\b(?:gaze|ASN|IPv?[46]?)\b|\bIP[\s _-]*address(?:es)?\b|\b(?:\d{1,3}\.){3}\d{1,3}\b/i;
const NEVER_BUILD_TAIL =
  '|\\bemotion|face.?match|\\bdevice\\b|\\bpersonality\\b|voiceprint|biometric|likeness';
const NEVER_BUILD = new RegExp(`${GAZE_ASN_IP.source}${NEVER_BUILD_TAIL}`, 'i');
const SELECTION = /type="checkbox"|role="checkbox"|aria-selected|role="option"|select all/i;
const EXPORT = /\bexport\w*|\bdownload\w*|\.csv\b|\.pdf\b/i;
const BAND_WORDS = new RegExp(`\\b(?:${Object.values(BAND_LABEL).join('|')})\\b|\\bband\\b`, 'i');
// M1 additions (AT-M1-24): solvability arrives in M10, and an AI-likeness or AI-detection score is never built.
const M1_NEVER_BUILD =
  /solvab\w*|\bai[\s_-]*(?:likeness|detect\w*|score)\b|\bchatgpt[\s_-]*score\b/i;

/** The text of every control and label: buttons, links, form labels, headings, table heads, summaries. */
function controlsAndLabels(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(
    /<(button|a|label|legend|summary|option|th|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    out.push(text(m[2] ?? ''));
  }
  for (const m of html.matchAll(/aria-label="([^"]*)"|placeholder="([^"]*)"|title="([^"]*)"/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

// ---- The M1 route table -------------------------------------------------------------------------------------------

const STAFF = ['org_owner', 'admin', 'recruiter'];
const STAFF_OR_REVIEWER = [...STAFF, 'reviewer'];
const ADMIN = ['admin'];

/** path, the screen's heading, and the roles whose gate lets the screen render (UX only; the server decides). */
const M1_ROUTES: { path: string; heading: string; allowed: string[]; element: ReactNode }[] = [
  { path: 'bank', heading: 'Item bank', allowed: STAFF_OR_REVIEWER, element: <BankRoute /> },
  { path: 'bank/items/new', heading: 'Item', allowed: STAFF, element: <ItemRoute /> },
  {
    path: 'bank/items/:itemId',
    heading: 'Item',
    allowed: STAFF_OR_REVIEWER,
    element: <ItemRoute />,
  },
  {
    path: 'bank/approvals',
    heading: 'Item approvals',
    allowed: STAFF_OR_REVIEWER,
    element: <ApprovalsRoute />,
  },
  { path: 'bank/ai-drafts', heading: 'AI drafts', allowed: STAFF, element: <AiDraftsRoute /> },
  { path: 'bank/pools', heading: 'Pools', allowed: STAFF, element: <PoolsRoute /> },
  { path: 'bank/import', heading: 'Import items', allowed: STAFF, element: <ImportRoute /> },
  { path: 'library', heading: 'Library', allowed: STAFF, element: <LibraryRoute /> },
  {
    path: 'settings/integrity',
    heading: 'Integrity settings',
    allowed: ADMIN,
    element: <IntegrityLocksRoute />,
  },
  { path: 'settings/members', heading: 'Members', allowed: ADMIN, element: <MembersRoute /> },
];
const ALL_ROLES = [...STAFF, 'reviewer', 'hiring_manager'];

const gateChildren = (table: ReturnType<typeof buildRoutes>) => {
  const root = table[0];
  const gate = root?.children?.find((child) => child.path === undefined && !child.index);
  return gate?.children ?? [];
};
const routeFor = (path: string) => {
  const route = gateChildren(buildRoutes(null)).find((child) => child.path === path);
  if (route === undefined) throw new Error(`no route ${path}`);
  return route;
};

describe('M1 route table (AT-M1-24)', () => {
  it('has the M1 screens behind the signed-in gate, next to the D1 ones', () => {
    const paths = gateChildren(buildRoutes(null)).map((child) => child.path ?? '');
    for (const { path } of M1_ROUTES) expect(paths, path).toContain(path);
    for (const d1 of ['tests', 'tests/new', 'tests/:testId', 'review', 'reports/:reportId']) {
      expect(paths, d1).toContain(d1);
    }
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('has no template route: the template choice is step 1 of tests/new (R5-15, §6.1)', () => {
    const paths = gateChildren(buildRoutes(null)).map((child) => child.path ?? '');
    expect(paths).not.toContain('tests/new/template');
    expect(paths.filter((path) => path.startsWith('tests/new'))).toEqual(['tests/new']);
  });

  it('no M1 route path names a forbidden word', () => {
    for (const { path } of M1_ROUTES) {
      expect(path).not.toMatch(CONTROL_WORDS);
      expect(path).not.toMatch(M1_NEVER_BUILD);
    }
  });

  it('the production-flavour table has them too, and no demo outbox', () => {
    const paths = gateChildren(builtRoutes).map((child) => child.path ?? '');
    expect(paths).toContain('bank/approvals');
    expect(paths).not.toContain('demo-outbox');
  });

  it.each(M1_ROUTES)('$path renders its heading for the roles that may use it', (route) => {
    for (const role of ALL_ROLES) {
      const html = wrap(
        <OrgInfoContext value={info([role])}>
          <ApiContext value={null}>{routeFor(route.path).element}</ApiContext>
        </OrgInfoContext>,
      );
      if (route.allowed.includes(role)) {
        expect(text(html), `${route.path} for ${role}`).toContain(route.heading);
        expect(text(html)).not.toContain(NO_ACCESS_TEXT);
      } else {
        expect(text(html), `${route.path} for ${role}`).toContain(NO_ACCESS_TEXT);
        expect(text(html)).not.toContain(route.heading);
      }
    }
  });

  it('a screen with no signed-in org shows the no-access text, never the screen', () => {
    const html = wrap(<ApiContext value={null}>{routeFor('settings/members').element}</ApiContext>);
    expect(text(html)).toContain(NO_ACCESS_TEXT);
  });
});

describe('M1 nav (UX only; the server decides)', () => {
  const labels = (roles: string[]) => navFor(roles, null).map((item) => item.label);
  const links = (roles: string[]) => navFor(roles, null).map((item) => item.to);

  it('staff get the bank, the approval queue and the library; owners and recruiters no settings', () => {
    for (const role of ['org_owner', 'recruiter']) {
      expect(labels([role])).toEqual(['Tests', 'Item bank', 'Item approvals', 'Library']);
    }
  });

  it('only an admin gets Integrity settings and Members', () => {
    expect(labels(['admin'])).toEqual([
      'Tests',
      'Item bank',
      'Item approvals',
      'Library',
      'Integrity settings',
      'Members',
    ]);
    expect(links(['admin'])).toEqual([
      '/tests',
      '/bank',
      '/bank/approvals',
      '/library',
      '/settings/integrity',
      '/settings/members',
    ]);
  });

  it('a reviewer approves items and sees the integrity review queue', () => {
    expect(labels(['reviewer'])).toEqual(['Tests', 'Item approvals', 'Review queue']);
  });

  it('a hiring_manager still gets no links, and the demo outbox stays last for staff', () => {
    expect(labels(['hiring_manager'])).toEqual([]);
    const outbox = { to: '/demo-outbox', label: 'Demo outbox' };
    expect(navFor(['recruiter'], outbox).at(-1)).toEqual(outbox);
    expect(navFor(['reviewer'], outbox).map((i) => i.label)).not.toContain('Demo outbox');
  });

  it('every link goes to a route in the table', () => {
    const paths = new Set(gateChildren(buildRoutes(null)).map((child) => `/${child.path ?? ''}`));
    for (const role of ['org_owner', 'admin', 'recruiter', 'reviewer']) {
      for (const to of links([role])) expect(paths, to).toContain(to);
    }
  });
});

// ---- The screens --------------------------------------------------------------------------------------------------

/** Every M1 screen, rendered from synthetic data, by name. */
function screens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const route of M1_ROUTES) {
    out[`route ${route.path}`] = wrap(
      <OrgInfoContext value={info(['org_owner', 'admin', 'recruiter', 'reviewer'])}>
        <ApiContext value={null}>{routeFor(route.path).element}</ApiContext>
      </OrgInfoContext>,
    );
  }
  for (const role of ['org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager']) {
    out[`shell ${role}`] = wrap(
      <SignedInView info={info([role])} extraNav={null}>
        <p>screen</p>
      </SignedInView>,
    );
  }
  for (const [name, node] of Object.entries(registeredM1Screens())) out[name] = wrap(node);
  return out;
}

/**
 * Directories (below src/) whose stream must ship `<dir>/m1-screens.test-helpers.tsx` with at least one screen. The
 * lead appends 'bank', 'bank/import', 'library', 'settings' and 'authoring' as each stream merges, so the registry
 * cannot stay opt-in and leave the guards checking nothing.
 */
export const REQUIRED_SCREEN_REGISTRIES: readonly string[] = ['authoring', 'settings'];

/** The required directories with no registered screen (`names` are the registry keys: `./<dir>/m1-screens... <name>`). */
const missingRegistries = (required: readonly string[], names: readonly string[]): string[] =>
  required.filter(
    (dir) => !names.some((name) => name.startsWith(`./${dir}/m1-screens.test-helpers.tsx `)),
  );
/** The wizard's integrity step is required once the stream that builds it is. */
const integrityStepRequired = (required: readonly string[]): boolean =>
  required.includes('settings') || required.includes('authoring');

/** Screens that legitimately say "export" or "CSV": the import errors table (§6.9: an error CSV made in the browser). */
const EXPORT_ALLOWED = /^(?:route bank\/import|\.\/bank\/import\/)/;

describe('M1 screens never show what the product never builds (AT-M1-24)', () => {
  const all = screens();

  it('renders the whole screen set (the checks below are not vacuous)', () => {
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(M1_ROUTES.length + 5);
    for (const [name, html] of Object.entries(all)) expect(html.length, name).toBeGreaterThan(20);
    for (const route of M1_ROUTES) expect(Object.keys(all)).toContain(`route ${route.path}`);
  });

  it('has no control or label for reject, decline, shortlist, decision, confirm, overturn, notice, appeal', () => {
    for (const [name, html] of Object.entries(all)) {
      for (const label of controlsAndLabels(html)) {
        expect(label, `${name}: "${label}"`).not.toMatch(CONTROL_WORDS);
      }
    }
  });

  it('has none of reject, decline, shortlist, overturn, appeal, confirm anywhere in the text', () => {
    for (const [name, html] of Object.entries(all))
      expect(text(html), name).not.toMatch(ANYWHERE_WORDS);
  });

  it('shows no overall, combined, total, trust, honesty or composite number', () => {
    for (const [name, html] of Object.entries(all)) expect(text(html), name).not.toMatch(COMBINED);
  });

  it('shows no integrity band, and no word of one, on any M1 screen', () => {
    for (const [name, html] of Object.entries(all))
      expect(text(html), name).not.toMatch(BAND_WORDS);
  });

  it('has no row selection, bulk bar or (outside the import errors) export', () => {
    for (const [name, html] of Object.entries(all)) {
      expect(html, name).not.toMatch(SELECTION);
      expect(text(html), name).not.toMatch(/\bbulk\b/i);
      if (!EXPORT_ALLOWED.test(name)) expect(text(html), name).not.toMatch(EXPORT);
    }
  });

  it('has no gaze, emotion, face-match, IP, ASN or device text, no AI-likeness and no solvability', () => {
    for (const [name, html] of Object.entries(all)) {
      expect(text(html), name).not.toMatch(NEVER_BUILD);
      expect(text(html), name).not.toMatch(M1_NEVER_BUILD);
    }
  });

  it('draws no inline style (the CSP forbids style attributes)', () => {
    for (const [name, html] of Object.entries(all)) expect(html, name).not.toMatch(/\sstyle=/);
  });

  // R5-6: the integrity step's static "Data and review" panel follows the plan; a stream that builds the wizard
  // registers its step as `integrity-step` and this pins the copy (plan-conflicts #7, #8; wording per R5-22).
  // It is required once 'settings' or 'authoring' is a required registry.
  it('the integrity step carries the plan wording', () => {
    const step = Object.entries(all).find(([name]) => name.endsWith(' integrity-step'));
    if (integrityStepRequired(REQUIRED_SCREEN_REGISTRIES))
      expect(step, 'integrity-step').toBeDefined();
    if (step === undefined) return;
    const body = text(step[1]);
    for (const phrase of [
      'deleted 30 days after the decision',
      '72 hours',
      '5 business days',
      'candidates above your cutoff only',
      'Integrity results are never acted on automatically',
    ]) {
      expect(body).toContain(phrase);
    }
  });

  it('every required directory registers at least one screen', () => {
    expect(
      missingRegistries(REQUIRED_SCREEN_REGISTRIES, Object.keys(registeredM1Screens())),
    ).toEqual([]);
  });
});

describe('the M1 guard patterns (negative controls)', () => {
  it('an empty registry for a required directory fails', () => {
    const names = [
      './bank/m1-screens.test-helpers.tsx list',
      './bank/import/m1-screens.test-helpers.tsx errors',
    ];
    expect(missingRegistries(['bank', 'bank/import'], names)).toEqual([]);
    expect(missingRegistries(['library'], names)).toEqual(['library']);
    expect(missingRegistries(['bank', 'settings'], [])).toEqual(['bank', 'settings']);
    // A nested directory's file does not satisfy its parent.
    expect(
      missingRegistries(['bank'], ['./bank/import/m1-screens.test-helpers.tsx errors']),
    ).toEqual(['bank']);
    expect(integrityStepRequired([])).toBe(false);
    expect(integrityStepRequired(['bank', 'authoring'])).toBe(true);
    expect(integrityStepRequired(['settings'])).toBe(true);
  });

  it('catch what they should', () => {
    for (const bad of ['Reject', 'Send notice', 'Record decision', 'Confirm', 'Appeal'])
      expect(bad).toMatch(CONTROL_WORDS);
    for (const bad of ['Solvability', 'AI likeness', 'AI-detection', 'AI score', 'ai_score'])
      expect(bad).toMatch(M1_NEVER_BUILD);
    for (const ok of ['AI draft - needs approval', 'AI drafts', 'Approve', 'Send back'])
      expect(ok).not.toMatch(M1_NEVER_BUILD);
    for (const ok of ['Approve', 'Send back', 'Retire', 'AI drafts'])
      expect(ok).not.toMatch(CONTROL_WORDS);
    expect('<input type="checkbox">').toMatch(SELECTION);
    expect('Gaze direction').toMatch(NEVER_BUILD);
    expect('Download the error CSV').toMatch(EXPORT);
    expect('Clear').toMatch(BAND_WORDS);
  });

  it('the export exception covers the import screens only', () => {
    expect(EXPORT_ALLOWED.test('route bank/import')).toBe(true);
    expect(EXPORT_ALLOWED.test('./bank/import/m1-screens.test-helpers.tsx errors')).toBe(true);
    expect(EXPORT_ALLOWED.test('route bank')).toBe(false);
    expect(EXPORT_ALLOWED.test('route library')).toBe(false);
  });
});

describe("parity with D1 (R5-22: the word lists are D1's, unchanged)", () => {
  const d1 = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'd1-guards.test.tsx'),
    'utf8',
  );

  it('d1-guards.test.tsx holds the same patterns', () => {
    expect(d1).toContain(CONTROL_WORDS.source);
    expect(d1).toContain(ANYWHERE_WORDS.source);
    expect(d1).toContain(COMBINED.source);
    expect(d1).toContain(GAZE_ASN_IP.source);
    // d1 writes the tail inside a template literal, so each backslash is doubled in its source text.
    expect(d1).toContain(NEVER_BUILD_TAIL.replaceAll('\\', '\\\\'));
    expect(d1).toContain(SELECTION.source);
    expect(d1).toContain(EXPORT.source);
  });
});

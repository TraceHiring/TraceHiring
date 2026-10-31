// M2 route table and role gates (specs/m2-scheduling-invites.md §2, §6.1, R5-59; Wave 1 lead part). The drive
// screens are staff-only (owner, admin, recruiter); a reviewer, hiring manager or a session with no org sees the
// no-access text. UX only: the server decides every request. The word lists for these screens are stream B5's
// apps/recruiter/src/drives/m2-guards.test.tsx.
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiContext, OrgInfoContext, type OrgInfo } from '../api/runtime';
import { buildRoutes, routes as builtRoutes } from '../routes';
import { NO_ACCESS_TEXT, navFor } from '../shell/nav';

const info = (roles: string[]): OrgInfo => ({
  orgId: '11111111-1111-4111-8111-111111111111',
  orgName: 'Synthetic Staffing',
  userId: '77777777-7777-4777-8777-777777777777',
  roles,
});
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const gateChildren = (table: ReturnType<typeof buildRoutes>) => {
  const gate = table[0]?.children?.find((child) => child.path === undefined && !child.index);
  return gate?.children ?? [];
};
const element = (path: string): ReactNode => {
  const route = gateChildren(buildRoutes(null)).find((child) => child.path === path);
  if (route === undefined) throw new Error(`no route ${path}`);
  return route.element;
};

const DRIVE_ROUTES = ['drives', 'drives/new', 'drives/:driveId', 'drives/:driveId/upload'];

describe('M2 drive routes (§6.1, R5-59)', () => {
  it('are in the signed-in table, also in the production-flavour build', () => {
    for (const table of [buildRoutes(null), builtRoutes]) {
      const paths = gateChildren(table).map((child) => child.path ?? '');
      for (const path of DRIVE_ROUTES) expect(paths, path).toContain(path);
    }
  });

  it.each(DRIVE_ROUTES)('%s renders for staff only', (path) => {
    for (const role of ['org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager']) {
      const html = renderToString(
        <MemoryRouter>
          <OrgInfoContext value={info([role])}>
            <ApiContext value={null}>{element(path)}</ApiContext>
          </OrgInfoContext>
        </MemoryRouter>,
      );
      const staff = ['org_owner', 'admin', 'recruiter'].includes(role);
      expect(text(html).includes(NO_ACCESS_TEXT), `${path} for ${role}`).toBe(!staff);
    }
  });

  it('staff get a Drives link to the list; others do not', () => {
    for (const role of ['org_owner', 'admin', 'recruiter']) {
      expect(navFor([role], null)).toContainEqual({ to: '/drives', label: 'Drives' });
    }
    for (const role of ['reviewer', 'hiring_manager']) {
      expect(navFor([role], null).map((item) => item.to)).not.toContain('/drives');
    }
  });
});

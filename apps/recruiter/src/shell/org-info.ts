// The caller's own roles in the signed-in org, read as the caller under RLS (as the sign-in flow does, M0b §2.2).
// Used only to decide which links to show; every request is checked again by the server.
import { MembershipRow } from '@trace/shared/contracts/tenancy';
import type { OrgInfo } from '../api/runtime';
import { accessTokenOf } from '../api/runtime';
import { MEMBERSHIP_COLUMNS } from '../auth/flow';
import type { RecruiterSupabase } from '../auth/supabase-client';

export async function loadOrgInfo(
  supabase: RecruiterSupabase,
  org: { id: string; name: string },
): Promise<OrgInfo | null> {
  try {
    const session = await supabase.auth.getSession();
    const userId = session.data?.session?.user.id;
    if (session.error !== null && session.error !== undefined) return null;
    if (userId === undefined) return null;
    const rows = await supabase
      .from('memberships')
      .select(MEMBERSHIP_COLUMNS)
      .eq('user_id', userId);
    if (rows.error !== null && rows.error !== undefined) return null;
    if (!Array.isArray(rows.data)) return null;
    const roles = new Set<string>();
    for (const raw of rows.data) {
      const parsed = MembershipRow.safeParse(raw);
      if (!parsed.success) return null;
      const m = parsed.data;
      if (m.user_id === userId && m.org_id === org.id && m.status === 'active') {
        for (const role of m.roles) roles.add(role);
      }
    }
    return { orgId: org.id, orgName: org.name, userId, roles: [...roles].sort() };
  } catch {
    return null;
  }
}

/** The access token of the current session, for the api client. */
export async function currentAccessToken(supabase: RecruiterSupabase): Promise<string | null> {
  try {
    return accessTokenOf(await supabase.auth.getSession());
  } catch {
    return null;
  }
}

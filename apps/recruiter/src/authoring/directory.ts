// The member directory for the reviewers panel: the org's memberships, read as the caller under RLS (spec §6.1).
import { MembershipRow } from '@trace/shared/contracts/tenancy';
import type { ApiResult } from '../api/client';
import { MEMBERSHIP_COLUMNS } from '../auth/flow';
import type { RecruiterSupabase } from '../auth/supabase-client';

export interface Member {
  id: string;
  displayName: string;
  roles: readonly string[];
}

export async function loadDirectory(
  supabase: RecruiterSupabase,
  orgId: string,
): Promise<ApiResult<Member[]>> {
  try {
    const rows = await supabase.from('memberships').select(MEMBERSHIP_COLUMNS).eq('org_id', orgId);
    if ((rows.error !== null && rows.error !== undefined) || !Array.isArray(rows.data)) {
      return { ok: false, code: 'unavailable' };
    }
    const members: Member[] = [];
    for (const raw of rows.data) {
      const parsed = MembershipRow.safeParse(raw);
      if (!parsed.success) return { ok: false, code: 'invalid_response' };
      const m = parsed.data;
      if (m.org_id === orgId && m.status === 'active') {
        members.push({ id: m.id, displayName: m.display_name, roles: m.roles });
      }
    }
    return { ok: true, data: members };
  } catch {
    return { ok: false, code: 'network' };
  }
}

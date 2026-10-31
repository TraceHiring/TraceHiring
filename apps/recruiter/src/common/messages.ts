// Fixed user-facing text for api failure codes. The server's text is never shown (specs/d1-demo-slice.md §6.2).

const MESSAGES: Readonly<Record<string, string>> = {
  aal2_required:
    'Two-step sign-in is needed for this screen. Sign in again with your authenticator app.',
  not_found: 'Not found, or you do not have access.',
  unauthorized: 'Your session has ended. Sign in again.',
  conflict: 'That change is no longer possible. Reload the page.',
  cutoff_required: 'Set an Answer Quality cutoff between 0 and 100.',
  draft_incomplete: 'The test is not complete: each section needs at least one valid question.',
  bad_request: 'Some values were not accepted. Check the form.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  // M1 publish refusals (specs/m1-test-authoring.md R5-69 f; services/api publish.ts and the settings guard).
  pool_too_small:
    'A pool has fewer approved items than its section draws. Add approved items to the pool, or draw fewer questions.',
  package_too_large:
    'The test is too large to publish (at most 5,000 questions across its pools). Use smaller pools.',
  setting_locked:
    'An integrity setting is locked by an admin, or the integrity settings are not saved yet.',
};

export const GENERIC_ERROR = 'Something went wrong. Try again.';

export function errorText(code: string): string {
  return MESSAGES[code] ?? GENERIC_ERROR;
}

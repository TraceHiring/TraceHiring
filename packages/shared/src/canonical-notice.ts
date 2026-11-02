// The candidate notice as shown and hashed (spec §4.1 step 4, D1-13, AT-D8). services/api renders the immutable
// notice_versions template with canonicalNoticeText, shows that exact text, and stores noticeSha256 of it as
// consents.rendered_sha256; the report's noticeHashPrefix is checked against the same function. Web Crypto only,
// so it runs in Workers and Node alike.

const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g;

/**
 * Fills `{{name}}` placeholders in one pass (a value is never re-expanded), then canonicalises: Unicode NFC, CRLF and
 * CR to LF, trailing spaces and tabs removed from every line, trailing newlines removed. Every placeholder needs a
 * value and every value must be used, so a template and its values cannot drift apart silently.
 */
export function canonicalNoticeText(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  const used = new Set<string>();
  const filled = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error('notice placeholder without a value');
    used.add(name);
    return value;
  });
  for (const name of Object.keys(values)) {
    if (!used.has(name)) throw new Error('notice value without a placeholder');
  }
  return filled
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n+$/, '');
}

/** Lower-case hex SHA-256 of the UTF-8 bytes of the canonical notice text. */
export async function noticeSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

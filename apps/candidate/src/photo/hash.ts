// Lowercase hex SHA-256 of the photo bytes, sent as `X-Photo-Sha256` (specs/d1-demo-slice.md §4.5).
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

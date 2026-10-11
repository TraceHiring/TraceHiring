// Builds PII-shaped values at test time, so no literal PII-like fixture sits in the repo (spec §9.1).
const digits = (n: number, seed: number): string =>
  Array.from({ length: n }, (_, i) => String((seed * 7 + i * 3) % 10)).join('');
const upper = (n: number, seed: number): string =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(65 + ((seed + i * 5) % 26))).join('');
const lower = (n: number, seed: number): string => upper(n, seed).toLowerCase();

export const synth = {
  email: (s = 1) => `${lower(6, s)}.${lower(4, s + 1)}@${lower(5, s + 2)}.example`,
  upi: (s = 1) => `${lower(7, s)}@${lower(5, s + 3)}`,
  mobile: (s = 1) => `9${digits(9, s)}`,
  aadhaar: (s = 1) => `4${digits(11, s)}`,
  vid: (s = 1) => digits(16, s),
  pan: (s = 1) => `${upper(5, s)}${digits(4, s)}${upper(1, s + 9)}`,
  passport: (s = 1) => `${upper(1, s)}${digits(7, s)}`,
  epic: (s = 1) => `${upper(3, s)}${digits(7, s)}`,
  ifsc: (s = 1) => `${upper(4, s)}0${upper(3, s)}${digits(3, s)}`,
  account: (s = 1) => digits(14, s),
  ipv4: (s = 1) => `10.${(s * 13) % 250}.${(s * 7) % 250}.${(s * 3) % 250}`,
  ipv6: (s = 1) => `fd${digits(2, s)}:${'abcdef'[s % 6]}${digits(3, s)}::${digits(2, s)}`,
  jwt: (s = 1) =>
    ['eyJ' + upper(10, s) + lower(10, s), 'eyJ' + lower(12, s), lower(8, s) + upper(8, s)].join(
      '.',
    ),
  hex: (s = 1) =>
    Array.from({ length: 40 }, (_, i) => '0123456789abcdef'[(s + i * 7) % 16]).join(''),
  base64: (s = 1) => `${upper(12, s)}${digits(8, s)}${lower(12, s)}+/`,
  secretKey: (s = 1) => ['sb', 'secret', `${lower(10, s)}${digits(6, s)}`].join('_'),
  dbUrl: (s = 1) =>
    `${['post', 'gresql'].join('')}://${lower(5, s)}:${lower(8, s)}@${lower(6, s)}.example:5432/db`,
  /** Several words, like a street address: a number, then capitalised words. */
  phrase: (s = 1) =>
    [digits(2, s), ...[0, 1, 2].map((i) => upper(1, s + i) + lower(5, s + i + 3))].join(' '),
  /** An HTTP Basic credential: base64 of user:password. */
  basic: (s = 1) => btoa(`${lower(6, s)}:${lower(4, s + 1)}${digits(3, s)}`),
};

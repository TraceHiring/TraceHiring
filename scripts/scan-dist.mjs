#!/usr/bin/env node
// Secret scan of every build output (spec specs/m0-foundations.md §5 `build`, §7.2 step 2, AT-16 local).
// Runs `gitleaks dir --redact --no-banner` over the dist/ of every app, Worker and service
// (apps/*, workers/*, services/*). Fails (exit 1) when:
//   - gitleaks reports a finding (or fails) for any dist/
//   - no dist/ exists at all (the scan never passes vacuously)
//   - a workspace there has a `build` script but no dist/ (a partial build)
//   - gitleaks is not installed (prints an install hint; never skips)
//   - a dist/ holds, at any depth, a .gitleaksignore, .gitleaks.toml or .gitleaksbaseline (any
//     case), or a file containing gitleaks' inline allow marker: `gitleaks dir` honours an ignore
//     file in the scanned directory and skips marked lines, so either could hide a finding
//   - a dist/ holds an archive (by name or by magic bytes: gzip, zip anywhere, bzip2, xz, zstd, 7z,
//     rar, zlib, lz4, .Z, lzip; brotli by name), whose content cannot be scanned
//   - a dist/ (or anything in it) is a symlink, junction or other entry that is neither a regular
//     file nor a directory (by lstat): the scan never follows it, but deploy tools upload the target
//   - `gitleaks stdin` finds a key in the dist/ content (every file, binary or not, in sorted
//     order after a fixed ASCII header, in overlapping pieces between blank lines so gitleaks
//     never cuts a key, plus the ASCII text of any UTF-16/UTF-32 in a file), which catches files
//     `gitleaks dir` skips by path or type and keys stored as UTF-16/UTF-32
// The repository's .gitleaks.toml is always passed with --config (a built-in default config when
// it is missing), and GITLEAKS_CONFIG / GITLEAKS_CONFIG_TOML are dropped from gitleaks' environment,
// so a config that a build copies into dist/ can never change the rules.
// Output is redacted; this script prints only paths and gitleaks' own redacted summary.
// No environment variables. Optional argument: the repository root (default: this script's repo).
import { isUtf8 } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACE_DIRS = ['apps', 'workers', 'services'];
export const GITLEAKS_ARGS = ['dir', '--redact', '--no-banner'];
export const INSTALL_HINT =
  'gitleaks is not installed, so the build-output secret scan cannot run. Install gitleaks 8.30.1 (Windows: winget install Gitleaks.Gitleaks; CI: the checksum-verified binary in the shared setup), then build again.';
const DEFAULT_CONFIG =
  '# scan-dist fallback: the repository has no .gitleaks.toml.\n[extend]\nuseDefault = true\n';

/** Colour codes in gitleaks' log lines. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const posix = (p) => p.split(path.sep).join('/');

/**
 * The dist/ directories to scan and the workspaces that should have one.
 * @returns {{ dists: string[], missing: string[] }} repo-relative POSIX paths
 */
export function findDists(root) {
  const dists = [];
  const missing = [];
  for (const top of WORKSPACE_DIRS) {
    const base = path.join(root, top);
    if (!isDir(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const ws = path.join(base, name);
      if (!isDir(ws)) continue;
      const rel = posix(path.join(top, name));
      if (isDir(path.join(ws, 'dist'))) {
        dists.push(`${rel}/dist`);
        continue;
      }
      const pkg = path.join(ws, 'package.json');
      if (!existsSync(pkg)) continue;
      let build = false;
      try {
        build = typeof JSON.parse(readFileSync(pkg, 'utf8'))?.scripts?.build === 'string';
      } catch {
        missing.push(`${rel} (package.json does not parse)`);
        continue;
      }
      if (build) missing.push(rel);
    }
  }
  return { dists, missing };
}

/** File names gitleaks reads to skip findings or change rules (compared case-insensitively). */
export const HIDER_NAMES = ['.gitleaksignore', '.gitleaks.toml', '.gitleaksbaseline'];
/** gitleaks skips any line holding this marker (built here so this file holds no marker). */
const ALLOW_MARKER = ['gitleaks', 'allow'].join(':');

/**
 * A directory's entries sorted by name (UTF-16 code units), so every walk visits files in the
 * same order on NTFS and ext4 (S1.4 security re-review N8).
 */
const sortedEntries = (abs) =>
  readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

/**
 * A dist/ entry that is a symlink, junction, FIFO, socket or device (S1.4 N8/N9 security review
 * N12). The scan never follows one, but wrangler's asset and Pages uploads stat each entry and
 * upload the target, so content no scan read could ship.
 */
const NOT_FILE_OR_DIR =
  'neither a regular file nor a directory (a link or special file: deploy tools follow it and ' +
  'upload content this scan does not read)';

/**
 * Anything in a dist/ that could make gitleaks skip a finding there (S1.4 security review M5):
 * an ignore, config or baseline file at any depth, an archive (by name or by magic bytes), a
 * file containing the inline allow marker (in any case), or an entry (the dist/ itself included)
 * that lstat says is neither a regular file nor a directory (N12). Links are never followed; a
 * link with a hider's name still counts.
 * @param {string} root repository root
 * @param {string} rel repo-relative POSIX path of the dist/ directory
 * @returns {string[]} problems
 */
export function findHiders(root, rel) {
  const problems = [];
  const walk = (abs, relPath) => {
    for (const e of sortedEntries(abs)) {
      const childAbs = path.join(abs, e.name);
      const childRel = `${relPath}/${e.name}`;
      if (HIDER_NAMES.includes(e.name.toLowerCase())) {
        problems.push(
          `${childRel}: gitleaks ignore/config/baseline file in build output (it could hide findings)`,
        );
        continue;
      }
      // lstat, not the directory entry's type, so a link is never taken for its target.
      const st = lstatSync(childAbs);
      if (st.isDirectory()) {
        walk(childAbs, childRel);
        continue;
      }
      if (!st.isFile()) {
        problems.push(`${childRel}: ${NOT_FILE_OR_DIR}`);
        continue;
      }
      const buf = readFileSync(childAbs);
      if (ARCHIVE_RE.test(e.name) || isArchive(buf)) {
        problems.push(
          `${childRel}: archive in build output (compressed content cannot be scanned)`,
        );
      } else if (hasAllowMarker(buf) || hasAllowMarker(wideText(buf))) {
        problems.push(
          `${childRel}: contains the inline allow marker, which makes gitleaks skip that line`,
        );
      }
    }
  };
  const distAbs = path.join(root, ...rel.split('/'));
  if (!lstatSync(distAbs).isDirectory()) {
    problems.push(`${rel}: ${NOT_FILE_OR_DIR}`);
    return problems;
  }
  walk(distAbs, rel);
  return problems;
}

/** Does this content (or null) contain gitleaks' inline allow marker, in any case? */
const hasAllowMarker = (buf) =>
  buf !== null && buf.toString('latin1').toLowerCase().includes(ALLOW_MARKER);

/**
 * Compressed files: gitleaks cannot see inside them, so none may ship (S1.4 re-review N5). Brotli
 * has no magic bytes, so it is found by name only (S1.4 N8/N9 security review N13).
 */
const ARCHIVE_RE =
  /\.(?:gz|br|brotli|zst|zip|tgz|tar|bz2|xz|7z|rar|lz4|lz|lzma|z|zz|zlib|deflate|tbz2?|txz|tlz|tzst)$/i;
/**
 * The leading bytes of compressed formats, so an archive under any name fails (S1.4 re-review
 * N8, N13): gzip, zip, bzip2, xz, zstd, 7z, rar (v4 and v5), lz4 (frame and legacy), unix
 * compress (.Z), lzip. zlib, which has no fixed magic, is isZlib.
 */
const ARCHIVE_MAGIC = [
  '1f8b',
  '504b0304',
  '425a68',
  'fd377a585a00',
  '28b52ffd',
  '377abcaf271c',
  '526172211a07',
  '04224d18',
  '02214c18',
  '1f9d',
  '4c5a4950',
].map((hex) => Buffer.from(hex, 'hex'));
const startsWith = (buf, prefix) =>
  buf.length >= prefix.length && buf.subarray(0, prefix.length).equals(prefix);

/**
 * A zlib stream (RFC 1950): compression method 8 (deflate), a window of at most 32 KB and a valid
 * header checksum. Text such as "(r" or "x^" also passes that check, so content that is valid
 * UTF-8 is not counted; compressed bytes practically never are (N13).
 */
function isZlib(buf) {
  if (buf.length < 2) return false;
  const [cmf, flg] = buf;
  return (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && ((cmf << 8) | flg) % 31 === 0 && !isUtf8(buf);
}

const ZIP_END = Buffer.from('504b0506', 'hex');
/**
 * A zip end-of-central-directory record (single disk: both disk numbers 0) where zip readers look
 * for it, in the last 22 + 65,535 bytes. A zip appended to another file still opens, so its
 * leading bytes prove nothing (N13).
 */
function hasZipEnd(buf) {
  const from = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.indexOf(ZIP_END, from); i >= 0; i = buf.indexOf(ZIP_END, i + 1)) {
    if (i + 22 <= buf.length && buf.readUInt32LE(i + 4) === 0) return true;
  }
  return false;
}

/** Compressed content under any name: known leading bytes, a zlib stream or a zip end record. */
const isArchive = (buf) =>
  ARCHIVE_MAGIC.some((m) => startsWith(buf, m)) || isZlib(buf) || hasZipEnd(buf);

/** The fewest characters a run of wide text needs before wideText keeps it. */
const WIDE_TEXT_MIN = 8;
const PRINTABLE = '[\\t\\n\\r\\x20-\\x7e]';
/** [pattern, code-unit width in bytes, offset of the ASCII byte in a code unit] */
const WIDE_TEXT = [
  [`(?:${PRINTABLE}\\x00)`, 2, 0], // UTF-16LE
  [`(?:\\x00${PRINTABLE})`, 2, 1], // UTF-16BE
  [`(?:${PRINTABLE}\\x00\\x00\\x00)`, 4, 0], // UTF-32LE
  [`(?:\\x00\\x00\\x00${PRINTABLE})`, 4, 3], // UTF-32BE
].map(([unit, width, at]) => [new RegExp(`${unit}{${WIDE_TEXT_MIN},}`, 'g'), width, at]);

/**
 * The ASCII text stored as UTF-16 or UTF-32 code units in a file (either byte order, at any
 * offset, with or without a BOM, a whole text file or strings inside a binary): every run of at
 * least WIDE_TEXT_MIN printable ASCII characters (tab, LF and CR included), one run per line, or
 * null when there is none. gitleaks reads such text as bytes with NULs between the characters, so
 * a key in it never matches a rule (S1.4 N8/N9 security review N13); this copy is scanned too.
 */
export function wideText(buf) {
  if (buf === null || !buf.includes(0)) return null;
  const s = buf.toString('latin1');
  const runs = [];
  for (const [re, width, at] of WIDE_TEXT) {
    for (const m of s.matchAll(re)) {
      let run = '';
      for (let i = at; i < m[0].length; i += width) run += m[0][i];
      runs.push(run);
    }
  }
  return runs.length > 0 ? Buffer.from(runs.join('\n'), 'latin1') : null;
}

/**
 * The start of every stream sent to `gitleaks stdin`. gitleaks 8.30.1 sniffs the type of the
 * stream's first read (a 100 KB buffer) and skips the whole stream when it looks like
 * application/*: not only by leading bytes (%PDF, MZ, BZh, %!, \0asm, gzip) but also by bytes
 * further in (tar's `ustar` at byte 257, DICOM at 128, ISO 9660 at 32769). Plain ASCII lines
 * longer than that first read mean no dist file's bytes can decide the type (verified with the
 * real gitleaks 8.30.1; S1.4 security re-review N8).
 */
export const STDIN_HEADER = Buffer.from('scan-dist\n'.repeat(12_800), 'latin1');

/**
 * gitleaks 8.30.1 (sources/file.go, sources/common.go) reads its input with one Read of up to
 * 100,000 bytes (a pipe returns as many as it holds, so the offsets vary by machine and run),
 * then reads on until a blank line (`\n`, only spaces, tabs or CRs, `\n`) or this many more bytes
 * (maxPeekSize), and scans each such chunk on its own: a key across a cut is missed (S1.4 N8/N9
 * security review N11).
 */
export const GITLEAKS_MAX_PEEK = 25_000;
/**
 * The most bytes of a file between two blank lines in the stdin stream. A blank line follows every
 * piece and blank lines inside a piece are broken (withoutBlankLines, re-review P1), so from any
 * offset gitleaks finds one within STDIN_PIECE_MAX + 2 < GITLEAKS_MAX_PEEK bytes and only ever cuts
 * the stream between pieces.
 */
export const STDIN_PIECE_MAX = 20_000;
/**
 * Consecutive pieces of one file overlap by at least this many bytes, so every run of up to this
 * many bytes (any key with its context, a PEM private key included) is whole in one piece.
 */
export const STDIN_PIECE_OVERLAP = 8_192;
/** How far back from the hard limit a piece edge may move to land after a safe byte. */
const CUT_SLACK = 1_024;
/** Bytes after which a cut does not split a token: whitespace and closing punctuation. */
const SAFE_BEFORE_CUT = new Set([0x0a, 0x0d, 0x09, 0x20, 0x3b, 0x29, 0x5d, 0x7d, 0x3e]); // \n \r \t sp ; ) ] } >

/**
 * A cut point in (lo, hi] (a cut at p falls between buf[p - 1] and buf[p]): after a newline if one
 * is there, else after another safe byte, else exactly hi.
 */
function cutNear(buf, lo, hi) {
  for (let p = hi; p > lo; p--) if (buf[p - 1] === 0x0a) return p;
  for (let p = hi; p > lo; p--) if (SAFE_BEFORE_CUT.has(buf[p - 1])) return p;
  return hi;
}

/**
 * The [start, end) byte ranges a file goes into the stdin stream as: one piece when it is at most
 * STDIN_PIECE_MAX bytes, else overlapping pieces of at most STDIN_PIECE_MAX bytes, each starting
 * at most STDIN_PIECE_OVERLAP bytes before the previous one ends. Edges move back by up to
 * CUT_SLACK bytes to fall after a newline or other safe byte, so a piece rarely ends mid-token.
 */
export function stdinPieces(buf) {
  const pieces = [];
  let start = 0;
  while (buf.length - start > STDIN_PIECE_MAX) {
    const hardEnd = start + STDIN_PIECE_MAX;
    const end = cutNear(buf, hardEnd - CUT_SLACK, hardEnd);
    pieces.push([start, end]);
    // end - STDIN_PIECE_OVERLAP - CUT_SLACK > start, so every step moves forward.
    const hardStart = end - STDIN_PIECE_OVERLAP;
    start = cutNear(buf, hardStart - CUT_SLACK, hardStart);
  }
  pieces.push([start, buf.length]);
  return pieces;
}

const BLANK_LINE = Buffer.from('\n\n');

/**
 * A piece with every blank line inside it broken by a `.` (`\n` + spaces/tabs/CRs + `\n` becomes
 * `\n.` + …), so the separators are the only blank lines in the stream: gitleaks also cuts at a
 * blank line inside a piece, which split a key containing one, such as a PGP armour header or an
 * encrypted PEM's DEK-Info line (N10-N13 security re-review P1).
 */
function withoutBlankLines(piece) {
  const s = piece.toString('latin1');
  const t = s.replace(/\n(?=[\t\r ]*\n)/g, '\n.');
  return t === s ? piece : Buffer.from(t, 'latin1');
}

/**
 * The stream for `gitleaks stdin`: STDIN_HEADER and a newline (which ends it with a blank line),
 * then every file in a dist/ in sorted path order, as its stdinPieces, each followed by a blank
 * line. gitleaks only cuts this stream at a blank line, so every key of up to STDIN_PIECE_OVERLAP
 * bytes is scanned whole in at least one piece, whatever offsets the pipe gives (N11). Binary
 * files are kept (a key after a binary header, or in a file with a NUL byte, is still found).
 * `gitleaks dir` skips paths on gitleaks' built-in allowlist (node_modules/, images, lockfiles,
 * anything containing gitleaks.toml) and files that look binary, so this content also goes
 * through `gitleaks stdin`, which has no path to allowlist (S1.4 security re-review N5, N8).
 * Symlinks are not followed.
 */
export function distText(root, rel) {
  const parts = [STDIN_HEADER, Buffer.from('\n')];
  const walk = (abs) => {
    for (const e of sortedEntries(abs)) {
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) walk(childAbs);
      else if (e.isFile()) {
        const buf = readFileSync(childAbs);
        // The file's bytes, then the ASCII text of any UTF-16/UTF-32 in it (N13).
        for (const b of [buf, wideText(buf)]) {
          if (b === null) continue;
          for (const [s, t] of stdinPieces(b)) {
            parts.push(withoutBlankLines(b.subarray(s, t)), BLANK_LINE);
          }
        }
      }
    }
  };
  walk(path.join(root, ...rel.split('/')));
  return Buffer.concat(parts);
}

/** gitleaks' environment: the caller's, minus anything that could swap its config. */
function gitleaksEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (/^GITLEAKS_CONFIG(_TOML)?$/i.test(k)) delete out[k];
  return out;
}

/**
 * Scans every dist/ under `root`.
 * @param {{ root: string, gitleaks?: string, env?: NodeJS.ProcessEnv }} opts
 * @returns {{ ok: boolean, problems: string[], scanned: string[] }}
 */
export function scanDist({ root, gitleaks = 'gitleaks', env = process.env }) {
  const problems = [];
  const { dists, missing } = findDists(root);
  for (const m of missing) problems.push(`${m}: has a build script but no dist/ (build it first)`);
  if (dists.length === 0) {
    problems.push(
      `no dist/ found under ${WORKSPACE_DIRS.join('/, ')}/ (run the builds first; the scan never passes vacuously)`,
    );
    return { ok: false, problems, scanned: [] };
  }
  const rootConfig = path.join(root, '.gitleaks.toml');
  let tmp = null;
  let config = rootConfig;
  if (!existsSync(rootConfig)) {
    tmp = mkdtempSync(path.join(tmpdir(), 'trace-scan-dist-'));
    config = path.join(tmp, 'gitleaks.toml');
    writeFileSync(config, DEFAULT_CONFIG);
  }
  const scanned = [];
  try {
    for (const rel of dists) {
      problems.push(...findHiders(root, rel));
      const r = spawnSync(
        gitleaks,
        [...GITLEAKS_ARGS, '--config', config, path.join(root, ...rel.split('/'))],
        { cwd: root, env: gitleaksEnv(env), encoding: 'utf8' },
      );
      if (r.error) {
        if (r.error.code === 'ENOENT') {
          problems.push(INSTALL_HINT);
          return { ok: false, problems, scanned };
        }
        throw r.error;
      }
      scanned.push(rel);
      if (r.status !== 0) {
        const summary = `${r.stdout ?? ''}${r.stderr ?? ''}`
          .split(/\r?\n/)
          .map((l) => l.replace(ANSI, '').trim())
          .filter(Boolean)
          .slice(-3)
          .join(' | ');
        problems.push(
          `${rel}: gitleaks found a secret or failed (exit ${r.status}): ${summary}. ` +
            `See where with: gitleaks dir --redact --no-banner -v --config .gitleaks.toml ${rel}`,
        );
        continue;
      }
      // The same content again without paths, so the built-in path allowlist cannot hide a key.
      const s = spawnSync(gitleaks, ['stdin', '--redact', '--no-banner', '--config', config], {
        cwd: root,
        env: gitleaksEnv(env),
        input: distText(root, rel),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      if (s.error) throw s.error;
      if (s.status !== 0) {
        problems.push(
          `${rel}: gitleaks found a secret or failed (exit ${s.status}) in a file that gitleaks dir ` +
            `skips by path (node_modules/, images, lockfiles, gitleaks.toml names) or as binary, ` +
            `or in text stored as UTF-16/UTF-32 (convert such a file to UTF-8 first). To find it, ` +
            `pipe each such file, after a first line of plain text, through: ` +
            `gitleaks stdin --redact --no-banner -v --config .gitleaks.toml`,
        );
      }
    }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: problems.length === 0, problems, scanned };
}

function isMain() {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const { ok, problems, scanned } = scanDist({ root });
    for (const p of problems) console.error(`scan-dist: ${p}`);
    if (!ok) {
      console.error(`scan-dist: FAILED (spec §5, AT-16)`);
      process.exit(1);
    }
    console.log(`scan-dist: OK, no secrets in ${scanned.length} dist/ (${scanned.join(', ')})`);
  } catch (err) {
    console.error(`scan-dist: ${err.message}`);
    process.exit(1);
  }
}

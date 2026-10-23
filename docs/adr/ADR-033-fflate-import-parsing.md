# ADR-033: `fflate` in a browser Web Worker for `.xlsx`/`.docx` import

- **Status:** Accepted (autopilot, 2026-10-23). A new runtime library needs an ADR (CLAUDE.md stack rule "Do not add a framework, database or vendor without a new ADR"; AUTOPILOT §4). Records `specs/m1-test-authoring.md` §1.3 M1-9 and §1.8 R5-2 (ADR-032 is taken; M2's `aws4fetch` ADR moves to ADR-034).
- **Source:** spec revision 5 (M1-9, R2-19, E9, E11, DC-M1-2); M1 BUILD Wave 0. The dependency itself is added by the import stream (A5), not by this ADR.

## Context
M1 lets a recruiter import items from Trace-published templates, `trace-items-v1.xlsx` (plus an optional images `.zip`) and `trace-items-v1.docx` (spec §6.9). Both are Office Open XML files: a zip archive of XML parts and media. Spec M1-9 settles the custody question: **parsing runs in the recruiter's browser and the original file never leaves the device**, so Trace stores no uploaded spreadsheet or document and has nothing to purge. The api still re-validates every row server-side (zod + business rules, batches of at most 100), stores per-row errors as codes (never cell values) and receives images one by one (magic bytes, ≤ 1 MB, ≤ 4096 px, content-addressed private R2 key).

The browser has `DOMParser` for XML and `DecompressionStream` for raw streams, but no API that reads a zip's central directory and inflates its entries with per-entry size control. A small inflate library is needed; no such dependency exists in the repo, and ADR-028 lists the runtime libraries allowed so far.

## Decision
1. **`fflate`** (MIT, no runtime dependencies) unzips the file inside a **dedicated Web Worker** in `apps/recruiter`. The worker reads the zip directory, inflates only the parts it needs (`xl/workbook.xml`, `xl/sharedStrings.xml`, the `Items` sheet, `word/document.xml`, `word/styles.xml`, relationships and media), and posts plain rows and image bytes back to the page. **`DOMParser`** (available in dedicated workers) parses the XML. **No other dependency** is added for import.
2. **Version:** `fflate` 0.8.x; the latest published version on 2026-10-23 is **0.8.3** (npm registry, published 2026-05-16). The import stream pins an exact version in the pnpm catalog, changed only through the lead, and `pnpm audit` and osv-scanner cover it.
3. **Caps, enforced in the worker before and during inflate** (R2-19, E9, E11):
   - sheet file ≤ 10 MB; images `.zip` or `.docx` ≤ 100 MB **uncompressed** in total;
   - ≤ 2,000 rows and ≤ 2,000 images per import, each image ≤ 1 MB;
   - **zip-bomb abort:** the declared uncompressed sizes are checked against the caps before inflate, and the running inflated byte count is checked during inflate, so a lying header still stops at the cap; the worker then stops, discards everything and reports one error code;
   - **macros refused:** `.xlsm`/`.docm` and macro-enabled content types (and a `vbaProject.bin` part) are refused by extension and content type;
   - **formulas are never evaluated:** a formula cell contributes only its cached value; external relationships and links are ignored, never fetched.
   The api re-checks every row and every image, so a modified browser gains nothing by skipping a cap.
4. **CSP:** the recruiter policy (`apps/recruiter/_headers.template`) gains an explicit `worker-src 'self'`; the worker is a same-origin module bundled by Vite (no `blob:` worker, no `unsafe-eval`, no `wasm-unsafe-eval`). Inside that worker the import code calls only `fflate`'s **synchronous / streaming** API (for example `unzipSync` with a `filter`, or the `Unzip` streaming class); `fflate`'s callback-style async helpers start their own workers from serialised code and are **not used** (a `check-boundaries` or lint rule in the import stream may pin this). Day-one check **DC-M1-2** measures this in a built recruiter app under the real CSP; until it passes, this point is a design statement, not evidence.

## Rejected alternatives, and why
- **SheetJS (`xlsx`):** the npm registry copy is old and unmaintained; current releases are served from the vendor's own CDN rather than the npm registry, under a licence and supply-chain arrangement we would have to vet; the bundle is large; it evaluates or carries far more of the format (formulas, many file types) than a fixed Trace template needs, and it does not read `.docx`.
- **JSZip:** works, but is several times larger than `fflate`, is promise-heavy for many small entries, and gives coarser control over per-entry inflate limits, which the zip-bomb cap needs.
- **Server-side parsing (api Worker or a job):** the original file would leave the device, so Trace would hold a recruiter's spreadsheet (custody, retention and purge duties), against M1-9. It would also spend Workers CPU on inflate (DC-M1-4 already measures Workers CPU against the Free limit).
- **An import vendor (hosted spreadsheet importer):** a new vendor needs its own ADR and processor review, sends the file to a third party, and breaks "the original file never leaves the device".
- **Hand-written inflate on `DecompressionStream('deflate-raw')`:** no zip directory parsing and no per-entry size control without writing a zip reader ourselves; more custom security-sensitive code than one small, widely used library.

## Consequences
- One new browser-only runtime dependency in `apps/recruiter` (none in the api, Workers or Durable Objects). The recruiter bundle size is reported by `pnpm build` (the recruiter has no budget; the candidate app is untouched).
- Files are read only in the worker; the page never holds the whole archive, and the main thread stays responsive.
- If DC-M1-2 fails (for example a CSP refusal), the fallback is a different worker loading pattern under the same CSP, recorded as an amendment to this ADR; adding `unsafe-eval` or a `blob:` worker source is not an allowed fix.

## Reopen if
- `fflate` stops being maintained or gets an unfixed high-severity advisory; or
- DC-M1-2 shows it cannot run under the recruiter CSP without `unsafe-eval`; or
- a later format (for example legacy `.xls` or `.doc`) is required, which needs a separate decision.

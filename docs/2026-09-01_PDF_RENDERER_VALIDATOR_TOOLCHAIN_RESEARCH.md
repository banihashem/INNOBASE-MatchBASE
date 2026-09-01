# MatchBASE PDF Renderer and Validator Toolchain Research

Date: 2026-09-01  
Decision status: **CONDITIONAL**  
Scope: production Worker image; offline-at-render-time PDF generation and validation; no implementation or deployment authorization.

## Decision

Adopt **WeasyPrint 69.0 plus veraPDF CLI 1.30.1** as the single candidate toolchain for governed qualification.

This is the smallest viable product change because MatchBASE already specifies and implements an HTML/CSS report model and names WeasyPrint 69.0 as the conditional reference producer. Typst would require a new template implementation and its official accessibility guidance describes complex-table accessibility support as unstable. Chromium exposes tagged-PDF generation through an experimental DevTools parameter and does not provide an official PDF/UA conformance guarantee. Neither alternative reduces the existing requirement to pass all sixteen MatchBASE checks.

This decision remains conditional until the exact built image passes the full sixteen-key release gate for both A4 and Letter outputs and the required human accessibility review is complete.

## Governed versions and packaging

- Preserve the current base image exactly: `node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8`.
- Install `WeasyPrint==69.0` into a build-stage virtual environment. Pin every transitive Python wheel by version and SHA-256; install with `--require-hashes --only-binary=:all:` from a governed wheelhouse.
- Pin the Debian snapshot timestamp and exact versions for Python, Pango, HarfBuzz, Fontconfig, FreeType, image codecs, and required shared libraries. Do not leave `pip`, `curl`, compilers, or package indexes in the runtime image.
- Package veraPDF CLI `1.30.1` from its official distribution. Record and enforce the measured archive SHA-256; do not invent or accept an unverified checksum. Use a pinned Java 17 runtime or a reproducible `jlink` runtime validated against the veraPDF release.
- Vendor the approved fonts and static report assets. Record their hashes and licences, provide a fixed Fontconfig configuration, and prohibit host-font fallback.
- Run as the existing non-root UID `10001`; make the toolchain and assets read-only; provide only a bounded writable temporary directory.
- Set `TZ=UTC`, `LANG=C.UTF-8`, and `LC_ALL=C.UTF-8`. Bind renderer, native-library, font, template, stylesheet, report-model, page-geometry, and output hashes into lineage evidence.
- Generate A4 and Letter artifacts independently with explicit stylesheets. A renderer update, native-library update, font update, or template update creates a new qualification candidate.

The current Worker also needs provider network access. Therefore only the PDF subprocess can be described as network-independent. A claim that the whole Worker has no runtime network is false unless rendering moves to a separate service/job with egress denied.

## Exact candidate invocation

The runtime paths below are the governed target layout. The implementation must fail if a referenced path, hash, or executable differs.

```sh
env -i PATH=/opt/matchbase/pdf-venv/bin:/usr/bin:/bin \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC HOME=/nonexistent \
  XDG_CACHE_HOME=/tmp/pdf-cache \
  FONTCONFIG_FILE=/opt/matchbase/fonts/fonts.conf \
  /opt/matchbase/pdf-venv/bin/weasyprint \
  --pdf-tags \
  --pdf-variant pdf/ua-1 \
  --allowed-protocols file,data \
  --no-http-redirects \
  --fail-on-http-errors \
  --base-url file:///opt/matchbase/report-assets/ \
  --stylesheet /opt/matchbase/report-assets/a4.css \
  /work/report.html /work/report-a4.pdf

env -i PATH=/opt/matchbase/pdf-venv/bin:/usr/bin:/bin \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC HOME=/nonexistent \
  XDG_CACHE_HOME=/tmp/pdf-cache \
  FONTCONFIG_FILE=/opt/matchbase/fonts/fonts.conf \
  /opt/matchbase/pdf-venv/bin/weasyprint \
  --pdf-tags \
  --pdf-variant pdf/ua-1 \
  --allowed-protocols file,data \
  --no-http-redirects \
  --fail-on-http-errors \
  --base-url file:///opt/matchbase/report-assets/ \
  --stylesheet /opt/matchbase/report-assets/letter.css \
  /work/report.html /work/report-letter.pdf

/opt/verapdf/verapdf --format json --flavour ua1 --maxfailures -1 \
  /work/report-a4.pdf > /work/verapdf-a4.json
/opt/verapdf/verapdf --format json --flavour ua1 --maxfailures -1 \
  /work/report-letter.pdf > /work/verapdf-letter.json
```

The admission runner is an implementation requirement, not an existing command. Its closed interface should be:

```sh
node dist/pdf-qa.js \
  --model /work/report-model.json \
  --pdf-a4 /work/report-a4.pdf \
  --pdf-letter /work/report-letter.pdf \
  --verapdf-a4 /work/verapdf-a4.json \
  --verapdf-letter /work/verapdf-letter.json \
  --out /work/pdf-qa.json
```

It must require the exact set and count of these sixteen keys, with every outcome equal to `pass` and no warning/unknown result:

1. `band_label_equals_render_band`
2. `wave_separated_from_band`
3. `overflow_collision`
4. `citation_completeness`
5. `prohibited_phrase_scan`
6. `weight_fidelity`
7. `required_sections_present`
8. `template_content_leakage`
9. `truncation_disclosure`
10. `contradiction_declaration`
11. `tagged_structure`
12. `doc_title_flag`
13. `veraPDF`
14. `contrast_ratio`
15. `page_geometry_both`
16. `hash_and_lineage`

The runner must parse veraPDF JSON against a captured, version-pinned schema and require UA-1 compliance for both artifacts. Process exit status alone is insufficient. It must hash the two PDF byte streams and every lineage input. A4 and Letter page boxes, overflow/collision geometry, document title, tag tree, and expected structural roles must be read from the produced files rather than inferred from source HTML.

## Machine-validatable versus human-only claims

Machine-validatable controls include exact band/wave mapping, weights, required sections, prohibited phrases, template leakage, truncation and contradiction declarations, citation-field completeness, PDF geometry, detected overflow/collision, title flag, presence and shape of the tag tree, veraPDF UA-1 result, numeric contrast under the governed palette/background model, hashes, and lineage.

Automation does not establish that alternative text is meaningful, reading order is cognitively correct, tables are understandable with assistive technology, citations are factually adequate, prose is comprehensible, or the report is usable by disabled users. These require human review with representative assistive technology. Accordingly, passing veraPDF and the sixteen-key automated gate does not by itself authorize a public PDF/UA or WCAG conformance claim.

## Security and licence controls

- WeasyPrint is BSD-3-Clause. veraPDF is offered under GPLv3+ and MPLv2; the selected distribution/licence path and notices require legal recording. Font licences also require inventory and notices.
- Reject `http`, `https`, redirects, external stylesheets, remote fonts, and unresolved URLs during rendering. Pre-resolve every source into sanitized local content or approved `data:` content.
- Bound input size, decoded-image dimensions, page count, CPU, memory, and wall time. Run rendering and validation in separate subprocesses with explicit termination and no inherited credentials.
- Produce an SBOM and vulnerability scan for Python wheels, Debian libraries, Java runtime, veraPDF, fonts, and Node dependencies. Treat scanner exceptions as governed evidence, not silent ignores.
- Do not claim byte-for-byte reproducibility: the official renderer documentation does not guarantee it. Qualification must measure it. Until proven, retain semantic/layout gate evidence plus the actual artifact hash and complete lineage.

## Blocking conditions

1. The deterministic Dockerfile/toolchain lock, wheel hashes, Debian snapshot, veraPDF archive hash, font set, and licence record do not yet exist as admitted repository artifacts.
2. The closed `pdf-qa` runner and veraPDF JSON schema validation are not yet implemented.
3. A4 and Letter fixtures have not passed all sixteen checks on the exact production image.
4. Runtime resource limits and malicious-input tests have not been evidenced.
5. Human screen-reader, reading-order, table, link, and alternative-text review remains incomplete.
6. No public PDF/UA, WCAG, deterministic-build, deployment, or production-readiness claim is authorized by this research note.

## Primary official sources

- WeasyPrint installation and native dependencies: <https://doc.courtbouillon.org/weasyprint/latest/first_steps.html>
- WeasyPrint 69 API and CLI controls: <https://doc.courtbouillon.org/weasyprint/latest/api_reference.html>
- WeasyPrint licence: <https://github.com/Kozea/WeasyPrint/blob/main/LICENSE>
- Typst PDF export and standards: <https://typst.app/docs/reference/pdf/>
- Typst accessibility limitations: <https://typst.app/docs/guides/accessibility/>
- Typst licence metadata: <https://github.com/typst/typst/blob/main/Cargo.toml>
- Chrome DevTools `Page.printToPDF`: <https://chromedevtools.github.io/devtools-protocol/tot/Page/>
- Chrome DevTools protocol stability: <https://chromedevtools.github.io/devtools-protocol/>
- veraPDF applications, release packaging, Java support, and licences: <https://github.com/veraPDF/veraPDF-apps>
- veraPDF CLI options and flavours: <https://docs.verapdf.org/cli/help/>
- veraPDF validation model: <https://docs.verapdf.org/cli/validation/>
- Debian Bookworm OpenJDK 17 runtime: <https://packages.debian.org/bookworm/openjdk-17-jre-headless>
- Official Node 24.14.0 slim image: <https://hub.docker.com/layers/library/node/24.14.0-slim/images/sha256-4bd6219054c8bebcd26a66bfd8ca0bd6e1024b4b97474c59bb7ee3bbcbef4fe8>

## Local governing references

- `03_Implementation/INNOBASE-MatchBASE/packages/reporting/src/artifact-foundation.ts` defines the exact sixteen-key result contract.
- `02_Product_Research_and_Planning/06_Tier_and_Report_Specifications/CONSULTANT_REPORT_AND_PDF_SPECIFICATION.md` defines the gate ordering, dual-geometry requirement, conditional WeasyPrint reference, and restriction on accessibility claims.
- `03_Implementation/INNOBASE-MatchBASE/Dockerfile` defines the current Node base and non-root runtime boundary.

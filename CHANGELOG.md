# Changelog

## 0.3.0 — 2026-08-31

- Make Grok the default provider for GUIDE, WRITE, EVIDENCE, FIGURE/TABLE, STRUCTURE, and Chat; keep Codex, OpenAI, local, and WRITE-only overrides adjustable in Settings.
- Show the effective provider routing beside the mode selector with a direct Settings action.
- Reorganize the left panel into Writing, Research, and Workspace groups without removing evidence, outline, result, reference, figure, context, or Chat access.
- Add `.txt` manuscripts with plain-text heading context, automatic/index refresh, native GUIDE and WRITE behavior, citation placeholders, section goals, and reviewed edits.
- Add test-first coverage for provider defaults/routing, grouped keyboard-accessible navigation, plain-text indexing/live buffers, and real extension-host GUIDE/WRITE behavior.

## 0.2.2 — 2026-08-31

- Put up to three grounded reference suggestions alongside each GUIDE topic in the native editor card and sidebar.
- Show reference titles at a glance in the editor marker and provide bounded hover/focus details with the AI summary, relevance explanation, and local locator.
- Prefer current PDF passages, deduplicate matching bibliography metadata, and avoid weak reference padding when no source fits.
- Keep exact quotations out of tooltips; viewing or locking a reference resolves the current local source in the left panel through stale-token and source-hash checks.
- Add TDD coverage for reference selection, prompt behavior, hostile tooltip text, keyboard focus, native hover contents, and real extension-host actions.

## 0.2.1 — 2026-08-31

- Reduce the live Grok WRITE path from a measured 23.4 seconds to 0.94 seconds on the synthetic smoke task by using Grok 4.3 with reasoning disabled and a compact four-field output contract.
- Add a bounded, session-only WRITE completion cache that safely reuses exact contexts and matching typed prefixes after revalidating source hashes.
- Coalesce concurrent identical completion requests and expose an explicit cache-clear command; explicit regeneration always bypasses the cache.
- Arrange stable xAI message prefixes and pass a per-session conversation ID for provider prompt caching, while reporting cached token usage when xAI returns it.
- Cache local file digests by strong stat signatures so repeated freshness validation avoids rereading unchanged evidence; unsaved or changed sources fail closed.
- Add TDD coverage for TTL/LRU/byte bounds, compact WRITE contracts, source invalidation, partial numeric suffixes, concurrency, regeneration, and real-host cache behavior.

## 0.2.0 — 2026-08-31

- Add Grok/xAI API support with SecretStorage keys, separate consent, model selection setting, and optional WRITE-only routing.
- Add native GUIDE hover cards showing a suggested topic, local source title, relevant AI summary, and rationale.
- Add reference selection/locking with highlighted exact local text in the sidebar and original PDF navigation.
- Invalidate stale hover actions and changed/dirty source locks; preserve locked references during manuscript navigation.
- Keep WRITE native ghost text and existing evidence/explicit-edit protections; add unit, DOM, and real extension-host regressions.

## 0.1.0 — 2026-08-31

Initial local VS Code MVP covering Stages A–C. Source and VSIX are available through this repository; this is not a Marketplace or public-release announcement.

### Added

- Six assistance modes, native WRITE completions, explicit Chat, and reviewed manuscript edits with Undo.
- Cursor-aware LaTeX context, optional Markdown/YAML outlines, and persistent section goals.
- Local BibTeX/PDF evidence, highlighted source navigation, CSV/JSON results, static Python/notebook code, and figure relationships.
- Incremental SQLite indexing, source hashes/locators, context pins/exclusions, and request inspection.
- ChatGPT-authenticated Codex integration plus optional separately billed Responses API and loopback model adapters.
- Synthetic example project, setup/package scripts, automated and real VS Code host tests, Linux CI, and detailed usage/configuration/contributor guides.

### Fixed during initial validation

- Stale or fabricated evidence, unsafe citations/TeX, invalid numerical provenance, late CSV search results, and outdated relationship confirmations.
- Request cancellation races, stale sidebar snapshots, PDF highlight rendering, macOS path aliases, and unsaved edits shifting manuscript section offsets.

### Known boundaries

No standalone editor, Zotero sync, OCR, collaboration, Parquet, experiment execution, automatic figure generation, or model-driven retrieval loop. Windows and arbitrary third-party local models are not live-validated. See [validation details](docs/VALIDATION.md) and [implementation coverage](docs/IMPLEMENTATION.md).

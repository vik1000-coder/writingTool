# Changelog

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

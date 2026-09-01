# Research Copilot

**Think about what to write before asking AI to write it.**

A local-first VS Code extension for scientific writing in LaTeX or plain `.txt` manuscripts. It combines your manuscript, optional outline, bibliography, local PDFs, results, code, and figures into small, inspectable model requests. The researcher remains the author.

The implementation covers the specification's Stages A–C, with the deliberate boundaries recorded in the implementation ledger. It uses the existing VS Code editor and your usual LaTeX tooling. There is no hosted service, account system, vector database, or custom compiler.

## Documentation

| Document | What it covers |
| --- | --- |
| [Usage guide](docs/USAGE.md) | First session, all modes/commands, references, results/code, outlines, cursor tracking, context controls, and reviewed edits. |
| [Configuration](docs/CONFIGURATION.md) | Subscription/API/local backends, every setting, supported files, project YAML, limits, and local storage. |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Setup, sign-in, missing evidence, blocked suggestions, inline acceptance, and safe cache recovery. |
| [Architecture](docs/ARCHITECTURE.md) | Request flow, code map, provenance, and extension points. |
| [Contributing](CONTRIBUTING.md) | Development setup, test-driven changes, checks, and GitHub workflow. |
| [Security and privacy](SECURITY.md) | Data boundaries, safe reporting, and precautions before publication. |
| [Changelog](CHANGELOG.md) | Version history and known boundaries. |
| [Implementation coverage](docs/IMPLEMENTATION.md) / [Validation record](docs/VALIDATION.md) | Acceptance criteria, test evidence, live versus fixture checks, and remaining limits. |
| [Original specification](Technical%20Specification_%20Local-First%20AI%20Research%20Writing%20IDE.md) | The supplied product and technical specification. |

## Run locally

Prerequisites: VS Code 1.96+, Node.js 20+, Python 3.10+, and an xAI API key for the default Grok provider. Codex, OpenAI API, and a loopback local model remain optional settings.

```sh
git clone https://github.com/vik1000-coder/writingTool.git
cd writingTool
npm ci
npm run setup
npm run dev
```

Or open the repository in VS Code and press **F5**. This launches a separate development window containing the synthetic example study. The developer build automatically uses this repository's Python environment. `npm run setup` installs only into `.venv`; it does not change system Python.

1. Open **Research Copilot** from the activity bar.
2. Run **Research Copilot: Set Grok API Key**. The masked value is stored in VS Code SecretStorage.
3. Open `paper/results.tex` or `paper/plain-draft.txt` and place your cursor in a paragraph.
4. Leave **GUIDE** selected and click **Suggest next step**, or press **Cmd+Option+Space** / **Ctrl+Alt+Space**.
5. Inspect **Evidence** and **Context** before using the suggestion.

No model request runs on activation. The first explicit cloud request asks whether to send selected project context to the chosen backend. Automatic suggestions are off by default and require opt-in. All example data and PDF sources are synthetic and **must not be treated as scientific findings**.

## Assistance modes

| Mode | Behavior |
| --- | --- |
| OFF | No proactive suggestions. Explicit Chat still works. |
| GUIDE | A purpose for the next sentence, preserving your writing voice. Default. |
| WRITE | A short native inline continuation. **Tab** accepts, **Esc** dismisses. No automatic insertion. |
| EVIDENCE | Source passages, empirical slices, and missing-support warnings. |
| FIGURE / TABLE | A presentation proposal using actual project data, existing figures, and plotting code. May recommend no visualization. |
| STRUCTURE | Missing argument components, outline goals, and section-level guidance. |

The internal representation separates **lens** from **intervention level**. Every suggestion mode is read-only. Chat may propose a bounded `.tex` or `.txt` edit only when explicitly requested; it opens a diff and requires approval. Applying an edit checks that the manuscript has not changed since review and leaves saving to you. Raw result files cannot be modified through model actions.

## Evidence you can inspect

- **References:** Indexed BibTeX metadata, citation insertion, and matched local PDFs. Cards display author/year/venue; full entries remain editable in your bibliography file. Unknown citation keys are blocked. A bibliography entry without retrieved full text is explicitly unverified.
- **PDFs:** Exact locally extracted text, page, character range, and bounding rectangles. **Open highlighted passage** renders that page locally and highlights the stored source region. Page controls and zoom are included; no external PDF service is involved.
- **Results:** CSV and JSON schemas, dimensions, previews, numeric statistics and slices of at most 25 rows. Row numbers count data records, excluding the CSV header (including quoted multiline records).
- **Numbers:** A numerical WRITE claim needs a matching cell, row, column and current file hash. Missing or stale provenance blocks ghost-text insertion. Grounding means the cited cell exists; it does **not** establish that an interpretation, unit, causal claim, or statistical inference is correct. Derived quantities are not silently certified as computed analysis.
- **Context:** Inspect the exact prompt, selected artifacts, structured response, warnings, and applied-edit metadata. Pin artifacts or exclude them from retrieval. The manuscript at the cursor remains part of every request.
- **Project intelligence:** Python AST and notebook code cells are parsed without execution. Figure labels, captions, manuscript references, and discoverable code/data relationships are registered. Inferred lineage is distinguishable from user-confirmed relationships.

Markdown outlines remain valid. YAML outlines can hold goals, claims, evidence, figures, and status. Without an outline, manuscript headings supply an ephemeral structure; no outline file is created or overwritten. **Set Current Section Goal** stores a local section summary and pinned evidence. The assistant follows the active manuscript, cursor, headings, and unsaved prose. Outline editing and writing-stage status remain under your control; there is no automatic completion tracking or drag-and-drop outline editor. See the [outline walkthrough](docs/USAGE.md#manage-the-outline-and-section-goals).

## Use an existing research project

Open any trusted local folder. File layout is flexible. In Git repositories, discovery includes tracked files plus untracked files that Git does not ignore; already tracked files remain discoverable even if later ignored. Without Git discovery, the fallback uses built-in exclusions rather than parsing `.gitignore`. Use explicit project exclusions for sensitive material. Symlinks are not indexed. Unsaved `.tex` and `.txt` prose is used for manuscript context; other source files with unsaved changes are withheld until saved.

Optional `.research-copilot/project.yaml`:

```yaml
paper:
  root: paper/main.tex
outline:
  path: outline/outline.md
bibliography:
  - references/**/*.bib
reference_pdfs:
  - references/pdfs/**/*.pdf
code:
  - code/**/*.py
  - notebooks/**/*.ipynb
results:
  - results/**/*.csv
  - results/**/*.json
figures:
  - figures/**/*.{pdf,png,svg}
exclude:
  - private/**
```

All paths are workspace-relative. Open a common parent folder if research files live in sibling directories. External paths and symlinks escaping the workspace are deliberately rejected. A configured resource list scopes that type; omitted lists use discovery. `.parquet` is deferred following the explicit MVP artifact list; CSV/JSON are supported now.

The disposable SQLite index lives at `.research-copilot/index.sqlite`. The helper creates an ignore file for its database and optional logs. Pins, exclusions, confirmed relationships, and section goals live in `state.json`, independently of the index. You can choose whether to version `state.json` and `project.yaml`. **Refresh Project Index** picks up changes; file watchers update incrementally.

Limits keep local work bounded: 5,000 discovered files, 20 MiB per file, 100,000 data rows, 200 columns, 500 pages per PDF, and a configurable default context budget of 24,000 characters. Oversized or corrupt sources produce a visible notice and do not remain usable as stale evidence.

## Backends and settings

The settings prefix is `researchCopilot`.

| Setting | Purpose |
| --- | --- |
| `backend` | `grok` (default), `codex`, `openai`, or `local` |
| `writeBackend` | `same`, or a separate WRITE provider |
| `model` | Codex model ID; blank uses Codex's configured default. **Select Codex Model** lists availability. |
| `grokModel` | xAI structured-output model; defaults to `grok-4.6` |
| `grokWriteModel` | Low-latency xAI WRITE model; defaults to `grok-4.3` with reasoning disabled |
| `openaiModel` | Explicit model ID for the optional Responses API |
| `localModel`, `localEndpoint` | An installed local model and loopback OpenAI-compatible `/v1` URL; default endpoint is Ollama's `http://127.0.0.1:11434/v1` |
| `codexPath`, `pythonPath` | Executable paths, never shell command strings |
| `automaticSuggestions`, `debounceMs` | Opt-in GUIDE sentence / WRITE pause / EVIDENCE paragraph triggers; visual and structure stay explicit |
| `contextBudget` | Serialized context character limit; each bounded indexed block is included whole or omitted. Not a token or whole-prompt limit. |
| `diagnostics` | Toggle evidence warnings in the editor |
| `logRequests` | Opt-in local research request logs; disabled by default |
| `cacheSuggestions` | Reuse exact validated WRITE completions in bounded session memory; enabled by default |

Grok is the default for every mode: `backend: "grok"` with `writeBackend: "same"`. Run **Research Copilot: Set Grok API Key**; the key stays in VS Code SecretStorage. Research modes default to `grok-4.6`; WRITE defaults to the lower-latency `grok-4.3` profile with reasoning disabled. The provider row in the sidebar shows the effective routing and opens Settings directly. You can select Codex, OpenAI, a local model, or a WRITE-only override there. Validated WRITE continuations are cached briefly in session memory and can reuse a matching typed prefix without another model call. xAI API usage is billed separately. See [Grok setup](docs/CONFIGURATION.md#grok--xai-api-backend).

GUIDE now places up to three grounded reference titles alongside the suggested topic. Hover or keyboard-focus a reference for its AI summary and why it fits; select or lock it to inspect the exact local source in the left panel. **WRITE** continues to use Tab-accepted ghost text. See [cards and reference locking](docs/USAGE.md#guide-cards-and-locked-references).

OpenAI API billing is separate from ChatGPT. Use **Set OpenAI API Key** to store a key in VS Code SecretStorage, never in project files. The local adapter accepts only loopback HTTP(S) endpoints and refuses redirects. No API key is needed for Codex's ChatGPT authentication; access and limits depend on the account, and the extension does not verify a particular subscription tier. See [backend setup](docs/CONFIGURATION.md#chatgpt-subscription-through-codex) and the [complete settings reference](docs/CONFIGURATION.md#settings-reference).

The Codex adapter was tested with CLI **0.151.0**, including live ChatGPT-authenticated generation. An older system CLI can advertise a model it cannot run; update it or select a compatible model. The developer build's pinned CLI avoids this particular mismatch. Tool execution and inherited MCP connectors are disabled for suggestion sessions, which also use a read-only sandbox and reject approval requests.

## Package and install

```sh
npm run package
code --install-extension research-copilot-0.3.0.vsix
```

The VSIX contains the bundled extension, webview assets, Python helper sources, and the usage/configuration/troubleshooting guides. Development tools, models, node_modules and Python wheels are **not** bundled. For an installed VSIX, set `pythonPath` in **User Settings** to your prepared Python environment (for example the absolute path to this clone's `.venv/bin/python`, or `.venv\\Scripts\\python.exe` on Windows). A Codex executable is needed only if you select the optional Codex provider. Use **Check Local Setup** to inspect capabilities. No VS Code Marketplace publication is required. Windows remains unverified; macOS and Linux have been exercised.

Compilation remains your normal LaTeX workflow; [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop) is optional. The built-in source viewer is for evidence PDFs, not a replacement for manuscript compilation.

## Development and tests

```sh
npm run verify          # strict TypeScript, core tests, Python/PDF tests, build
npm run test:extension  # isolated real VS Code host, local HTTP fixture, real indexer
```

Optional live smoke test on macOS/Linux, explicitly using the repository's Codex CLI (consumes provider usage; sends synthetic text only):

```sh
RESEARCH_CODEX_PATH="$PWD/node_modules/.bin/codex" npx tsx scripts/smoke-codex.ts --generate
```

The Grok smoke test also consumes API usage and reads a key only from the file path you explicitly provide. It never prints the key:

```sh
npx tsx scripts/smoke-grok.ts /absolute/path/to/key-file.rtf
```

The normal test suite makes no cloud model requests. It treats Grok as the product default and exercises the xAI request contract with mocked HTTP; the real extension-host suite uses a deterministic loopback provider so CI never spends API credits. Python tests use `.venv` when available; without optional dependencies, PDF/YAML-specific cases explicitly skip. Run setup for the full suite. Tests cover `.tex` and `.txt` manuscripts, malformed sources, provenance forgery, citation injection, cancellation, subprocess failure, unsaved changes, configuration invalidation, result indexing, PDF geometry, and read-only interaction. Native inline commit tests require an OS-focused test window; background hosts verify completion state and report the focus-dependent portion separately.

See [implementation coverage](docs/IMPLEMENTATION.md), [validation notes](docs/VALIDATION.md), and [contributing](CONTRIBUTING.md). The standalone shell, Zotero, collaboration, OCR, arbitrary TeX macro expansion, Parquet, analysis execution, and automatic figure generation remain outside this MVP. Retrieval is local lexical ranking with mode priorities and explicit relationships, not a claim of perfect semantic relevance.

## Privacy

This extension has no telemetry. It launches one local indexer and only the selected model provider on demand; it creates no listening service and does not scrape chat websites. Research files remain ordinary local files. Cloud model use transmits selected context and the prompt (including bounded Chat history when applicable) to that provider; local storage does not imply offline inference. Provider authentication, retention, and administrative settings remain applicable. Logs are opt-in and may contain unpublished work. Secret-name exclusions cannot identify every sensitive file: configure file/folder exclusions **before** requesting help. **Inspect Last Request** is retrospective, not a preflight approval screen. See [security and privacy](SECURITY.md).

MIT licensed. PDFium/Pillow/PyYAML and development dependencies retain their own licenses. The sample source PDF is generated by this repository and is not a real publication.

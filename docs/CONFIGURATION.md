# Configuration and local setup

[Guide index](README.md) · [Usage](USAGE.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Development window or installed extension

Prerequisites: VS Code 1.96+, Node.js 20+, Python 3.10+, and Git to clone the repository. From a terminal:

```sh
git clone https://github.com/vik1000-coder/writingTool.git
cd writingTool
npm ci
npm run setup
npm run dev
```

The repository currently requires GitHub access while private. If you already have a clone, start with `cd` into it rather than cloning again. `npm run dev` opens a separate VS Code development window containing the synthetic example. You can instead open the clone in VS Code and press **F5**. The development window uses this clone's `.venv` and npm-installed Codex when the corresponding settings retain their defaults. Setup needs network access to download dependencies; it does not install models or change system Python.

### Install the VSIX

After dependency setup, run these commands in the clone to build and install:

```sh
npm run package
code --install-extension research-copilot-0.3.3.vsix
```

Alternatively, use **Install from VSIX…** in VS Code's Extensions view menu and select the package file. Open your research folder in the installed extension's window and configure its runtime paths below. This installs locally; it does not publish anything. Compile your manuscript with your normal LaTeX tools; compilation is not part of this extension.

An installed VSIX contains the extension, Python helper sources, webview assets, and these user guides, but no Python interpreter, Python wheels, Codex CLI, or model. Keep a prepared Python environment available and configure its **absolute executable path**. For macOS/Linux, an example in VS Code User Settings JSON is:

```json
{
  "researchCopilot.pythonPath": "/absolute/path/to/writingTool/.venv/bin/python",
  "researchCopilot.backend": "grok",
  "researchCopilot.writeBackend": "same",
  "researchCopilot.automaticSuggestions": false
}
```

Replace placeholder paths; do not paste them unchanged. `codexPath` can stay `codex` if a compatible executable is on VS Code's PATH. On Windows, a Python virtual environment normally uses `.venv\\Scripts\\python.exe`; JSON paths need escaped backslashes. Windows execution has not yet been validated. macOS has been exercised locally; Linux CI runs the real extension host under Xvfb. The [guide index](README.md) links to the repository's detailed validation record.

Paths are executable names or paths, not shell commands: do not use `source … && python`, `python -m …`, or a string containing arguments. Do not rely on `~` expansion. Set `pythonPath` and `codexPath` in **User Settings** because they are machine-scoped. Other settings can normally be project-specific in `.vscode/settings.json`. In Settings, search for `researchCopilot`.

## ChatGPT subscription through Codex

1. Change `researchCopilot.backend` from the Grok default to `codex` in Settings. The provider row in the sidebar shows the effective choice.
2. Ensure a compatible Codex CLI is available. This repository's locked development CLI was tested at **0.151.0**. An installed extension needs its own CLI path/PATH entry.
3. Run **Research Copilot: Sign in with ChatGPT**, then complete the browser flow using the intended account. Codex manages the credentials; do not put them in project files.
4. Run **Research Copilot: Select Codex Model** if you need to choose an available model. A blank `researchCopilot.model` uses Codex's configured default.
5. Request a suggestion explicitly and review the cloud-context consent dialog.

This route uses Codex's ChatGPT authentication, without an OpenAI API key. Access and usage limits depend on the account and workspace policy; the extension does not verify a particular paid tier, add unlimited usage, or offer a separate “Max” plan. If Codex was previously authenticated with an API key, explicitly sign in with ChatGPT to use subscription authentication. OpenAI documents the distinction between [ChatGPT sign-in and API-key authentication](https://learn.chatgpt.com/docs/auth).

This is a Codex integration, not browser automation of the ChatGPT website. Codex's own configuration, credentials, and provider policies remain applicable. The extension disables model tool execution and inherited connectors for its suggestion sessions; it never asks Codex to run research code.

### Optional OpenAI API backend

API billing is separate from ChatGPT. Select `backend: "openai"`, set `openaiModel` to an available model ID supporting structured output, and run **Research Copilot: Set OpenAI API Key**. The key is stored in VS Code SecretStorage. Submitting an empty value removes it. Do not store API keys in `project.yaml`, `.vscode/settings.json`, or source files.

The adapter calls the Responses API with a strict JSON schema and `store: false`; that flag is not a promise about all provider-side retention. No paid API inference is part of the ordinary test suite.

### Grok / xAI API backend

Grok is the default for all modes. The default routing is `backend: "grok"` and `writeBackend: "same"`; no Codex request is made unless you select Codex.

1. Run **Research Copilot: Set Grok API Key** from the command palette (or choose **Set Grok API key** in **Check Local Setup**).
2. Paste your xAI key into the masked input. It is saved in VS Code SecretStorage, never project settings or request logs. Submit an empty value to remove it. Do not paste keys into Chat or commit them to Git.
3. Choose **Use Grok for all modes**, **Use Grok for WRITE only**, or **Keep current backend**. This changes routing for the open workspace only; it does not make a model request.
4. Research modes default to `grokModel: "grok-4.6"`. WRITE defaults separately to `grokWriteModel: "grok-4.3"`, where the adapter disables reasoning and requests only the four fields needed for a safe continuation.
5. Request a suggestion and approve sending selected context to **Grok / xAI API**. This consent is separate from Codex/OpenAI consent and lasts for the current project/backend session.

Use the sidebar's **Settings** link to change providers. Set `researchCopilot.backend` to `grok` and `researchCopilot.writeBackend` to `same` for all-Grok routing. A split such as `backend: "codex"` and `writeBackend: "grok"` remains available as an explicit override.

The adapter sends bounded text context to the fixed `https://api.x.ai/v1/chat/completions` endpoint with bearer authentication and a strict JSON schema, following [xAI structured-output documentation](https://docs.x.ai/developers/model-capabilities/text/structured-outputs). Stable project evidence is placed before changing cursor context and an opaque per-session conversation ID enables [xAI prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching); provider cache hits remain controlled by xAI. It does not enable web/X search, code execution, or other model tools. API usage is billed by xAI; chat subscriptions do not substitute for API credentials or credits. Provider retention policies still apply. The normal tests use fixtures, not paid Grok inference.

The bottom-left usage footer reports input, cached-input, and output tokens for the last response and the current extension session. When xAI returns `usage.cost_in_usd_ticks`, the footer converts that provider-reported billed amount to USD and labels it **exact**. For older responses without that field, `grok-4.6` and `grok-4.3` use a labeled estimate from xAI's [current pricing table](https://docs.x.ai/developers/pricing), including cached-token and long-context rates. Custom/unknown models show token counts with price unavailable rather than inventing a rate. Session totals reset when the extension host restarts and are not an account invoice.

### Optional local model backend

Run your chosen local server yourself, then configure:

```json
{
  "researchCopilot.backend": "local",
  "researchCopilot.localEndpoint": "http://127.0.0.1:11434/v1",
  "researchCopilot.localModel": "replace-with-your-installed-model-id"
}
```

The endpoint must accept `POST /v1/chat/completions` with `response_format.type = "json_schema"` and return JSON text in `choices[0].message.content`. An OpenAI-compatible label alone does not guarantee this capability. Only loopback HTTP(S) hosts (`localhost`, `127.0.0.1`, or `[::1]`) are accepted. Credentials in URLs, query strings, fragments, and redirects are rejected. The local adapter does not send an API key.

No model download or server launch is performed by the extension. Confirm that your server itself runs inference locally and does not forward requests elsewhere if you need offline inference. The adapter is tested with a local HTTP fixture, not every third-party model/server combination.

### Use a different provider for WRITE

`researchCopilot.writeBackend` defaults to `same`. For example, use `backend: "codex"` and `writeBackend: "local"` with a configured local model to keep WRITE requests on that server while other modes and Chat use Codex. Each selected provider needs its own setup; this is routing, not automatic fallback when a provider fails.

### WRITE completion cache

With `cacheSuggestions` enabled, a validated WRITE response stays only in extension-process memory for at most two minutes. The cache holds at most 32 entries and 2 MiB. A hit requires the same workspace, manuscript URI, provider, model, context budget, complete text before and after the cursor, and unchanged source hashes. If you type the beginning of the offered text exactly, only the untyped suffix is reused. A source edit, configuration change, index reset, workspace change, expiry, or extension shutdown invalidates the relevant data. Unsaved result/reference/code edits invalidate all WRITE entries.

Automatic and native inline requests may use this cache. **Suggest / Regenerate** deliberately makes a fresh model request. Run **Research Copilot: Clear Suggestion Cache** to erase the session entries immediately, or disable `cacheSuggestions`. Cache hits make no provider request and therefore consume no API tokens; the provider may separately cache prefixes for requests that do reach xAI.

## Settings reference

All names below start with `researchCopilot.`.

| Setting | Default | Accepted values / meaning |
| --- | --- | --- |
| `backend` | `"grok"` | `grok`, `codex`, `openai`, `local`; applies to every mode unless WRITE is overridden. |
| `writeBackend` | `"same"` | `same`, `codex`, `openai`, `grok`, `local`; applies only to WRITE. |
| `codexPath` | `"codex"` | Codex executable; machine-scoped. Development builds prefer the repository CLI when left at this default. |
| `pythonPath` | `"python3"` | Python 3.10+ executable; machine-scoped. Development builds prefer `.venv` when left at this default. |
| `model` | `""` | Codex model ID; blank leaves the choice to Codex. |
| `openaiModel` | `""` | Required model ID when the API backend is selected. |
| `grokModel` | `"grok-4.6"` | xAI model supporting structured outputs, used when Grok is selected. |
| `grokWriteModel` | `"grok-4.3"` | xAI model used for WRITE; the default runs with reasoning effort `none`. |
| `localModel` | `""` | Required installed model ID when the local backend is selected. |
| `localEndpoint` | `"http://127.0.0.1:11434/v1"` | Loopback server base URL, normally including `/v1`. |
| `automaticSuggestions` | `false` | Enable debounced GUIDE, WRITE, and EVIDENCE triggers. |
| `debounceMs` | `1800` | Delay between 800 and 30,000 milliseconds. |
| `contextBudget` | `24000` | Serialized context budget, 4,000–100,000 characters. Not a token count or a limit on the entire prompt. |
| `diagnostics` | `true` | Show evidence warnings in the manuscript editor. Disabling presentation does not disable integrity checks. |
| `logRequests` | `false` | Write local request/response logs, which may contain unpublished research. |
| `cacheSuggestions` | `true` | Keep exact validated WRITE completions in the bounded session-memory cache. |

The context budget covers the context packet, not the additional instructions, explicit question, or bounded Chat history. Individual artifacts are already bounded excerpts or row blocks; context selection includes each indexed block whole or omits it. It does not promise to send whole files. Large pins can still be omitted with a warning.

## Project files and discovery

Open the common parent of your manuscript and research artifacts as a **trusted local folder**. The extension does not run in untrusted or virtual workspaces. Multi-root workspaces use the active manuscript's root. Resources outside that root are not supported; do not use symlinks to pull them in.

You can start without configuration. To scope discovery, run **Research Copilot: Configure Project** and edit `.research-copilot/project.yaml`:

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
  - results/raw-participant-data.csv
```

Save and run **Research Copilot: Refresh Project Index**. Subsequent saved file changes also trigger incremental refreshes. If configuration is malformed, edit the file directly and refresh after fixing it.

| Field | Meaning |
| --- | --- |
| `paper.root` | Main `.tex` entry point for resolving `\input`, `\include`, and `\subfile`, or a primary `.txt` manuscript. It does not restrict indexing to that file. If omitted, a discovered `\documentclass` file is preferred for LaTeX. |
| `outline.path` | Exact path to the chosen Markdown/YAML outline. Without it, files with `outline` in their names are recognized. |
| `bibliography` | List of BibTeX paths/globs. |
| `reference_pdfs` | List of literature PDF paths/globs. |
| `code` | List of Python/notebook paths/globs. |
| `results` | List of CSV/JSON paths/globs. |
| `figures` | List of image paths/globs; matching PDFs are classified as figures. |
| `exclude` | File/folder globs removed from discovery, regardless of resource role. |

Use workspace-relative paths with forward slashes. Do not use absolute external paths, `..`, home-directory shortcuts, or shell expansions. Globs support `*`, `**/` (including zero intermediate directories), and brace alternatives such as `{pdf,png,svg}`. Resource fields are lists, not single strings. An omitted role uses discovery; a supplied role scopes matching files of that type. Use `exclude` when you need a file removed completely.

PDFs under directories named `figures`, `figs`, or `plots`, or matching the `figures` list, are treated as figures rather than literature. A PDF next to a same-stem `.tex` source is treated as compiled manuscript output and is not indexed as literature evidence.

Within a Git repository, discovery uses Git's tracked files plus untracked, non-ignored files. **Tracked files remain discoverable even if later matched by `.gitignore`.** Without usable Git discovery, the fallback scans local files with built-in exclusions; it does not interpret `.gitignore`. Hidden paths, common dependency/build directories, and some credential-like filenames are skipped. These heuristics are not a sensitivity detector. Always use project exclusions for research that must not be retrieved. The active manuscript excerpt is still supplied when you request help in that document.

## Supported files and limits

| Resource | Supported input | Boundaries |
| --- | --- | --- |
| Manuscript | `.tex`, `.txt` | LaTeX structure is parsed without macro expansion/compilation. Plain text supports `#` headings and underlined headings, cursor context, ghost text, source guidance, citation placeholders, and reviewed edits. |
| Outline / notes | `.md`, `.yaml`, `.yml` | Markdown headings/lists or YAML node mappings; no automatic outline rewriting. |
| Bibliography | `.bib` | Parsed entries and unique citation keys; no remote metadata lookup. |
| Literature | Text-bearing `.pdf` | Up to 500 pages per PDF; exact extraction and local rendering, no OCR. |
| Code | `.py`, `.ipynb` | Static Python/code-cell parsing; no execution or notebook-output ingestion. |
| Results | `.csv`, `.json` | At most 100,000 rows, 200 columns, and 5,000 characters per cell. CSV requires a nonempty, unique header and consistent rows. |
| Figures | `.pdf`, `.png`, `.svg` and recognized TeX floats | Existing artifacts and metadata; no image generation or statistical analysis. |

Discovery is limited to 5,000 supported files and 20 MiB per file. Malformed or oversized files generate indexing notices and are withheld rather than leaving old evidence usable. CSV uses comma delimiters. JSON arrays become rows; nested metric mappings are flattened to metric/value records. Nonfinite JSON numbers are rejected. Parquet, Excel workbooks, Word documents, and raster-image OCR are not supported inputs in this version.

Search results and panel catalogs return at most 100 matches; narrow searches in large projects. Indexing splits result rows into blocks of at most 25. Some source text is bounded during parsing, so the index is not a lossless copy of every file.

## Local storage, backups, and removal

| Location | Contents | Handling |
| --- | --- | --- |
| `.research-copilot/project.yaml` | Optional file scope and resource configuration | Keep or version intentionally. |
| `.research-copilot/state.json` | Pins, artifact exclusions, confirmed relationships, section goals | Back up with your research project if you want to retain these choices; may reveal research context. |
| `.research-copilot/index.sqlite*` | Disposable index and SQLite sidecar files | Do not commit; rebuild from source files when needed. Contains extracted research text/data. |
| `.research-copilot/logs/` | Opt-in request/response records | Off by default; may contain unpublished material. Disable logging and delete unwanted logs manually. |
| VS Code state / SecretStorage | UI preferences / optional OpenAI and Grok API keys | Managed by VS Code. Use the API-key command with an empty value to remove that key. |
| Codex's own credential storage | ChatGPT/Codex authentication | Managed by Codex, independently of project files or extension removal. |

The helper creates `.research-copilot/.gitignore` with `index.sqlite*` and `logs/` exclusions if it does not already exist. It does not hide `state.json` or `project.yaml` automatically. Your repository's own ignore rules may still hide the entire directory. Inspect both configuration and state before publishing them; this extension does not synchronize them to a service.

To rebuild a corrupt cache, close the project's VS Code window so the helper stops, remove only `.research-copilot/index.sqlite` and its `-wal` / `-shm` sidecars if present, then reopen and refresh. Keep `state.json` and `project.yaml` to retain goals and controls. Do not remove the whole directory as a routine refresh.

To stop model use, select OFF and do not use Chat, or disable the extension. To uninstall, use VS Code's Extensions view. Uninstalling does not erase your project files, logs, Python environment, Codex installation, or provider credentials. Remove those separately only if you no longer need them.

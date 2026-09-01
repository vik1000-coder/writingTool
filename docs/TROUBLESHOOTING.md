# Troubleshooting

[Guide index](README.md) · [Usage](USAGE.md) · [Configuration](CONFIGURATION.md)

Start with **Research Copilot: Check Local Setup**, then **Research Copilot: Refresh Project Index**. Expand **indexing notices** at the bottom of a sidebar panel. For provider/process errors, open VS Code's Output panel and select **Research Copilot**. Do not share raw output or request snapshots until you have checked them for credentials and unpublished research.

## The development window will not start

- Run commands from the repository root after `npm ci` and `npm run setup`.
- If `code` is not found, open this repository in VS Code and press **F5**. No global replacement of your editor or Python is needed.
- If F5 cannot find the task or bundle, use the repository's **Research Copilot** launch configuration and run `npm run build`.
- Open a trusted local folder. Loose files, virtual workspaces, and untrusted workspaces are not the supported setup.

## Python, PDF support, or YAML is missing

Run `npm run setup` in the clone. If Python is not on PATH, choose an installed Python 3.10+ explicitly when creating the environment (macOS/Linux example):

```sh
RESEARCH_PYTHON=/absolute/path/to/python3 npm run setup
```

Setup reuses an existing `.venv`; changing `RESEARCH_PYTHON` does not replace an already-created environment. To inspect the clone's environment without a model call:

```sh
.venv/bin/python --version
.venv/bin/python -c "import pypdfium2, PIL, yaml; print('PDF and YAML dependencies available')"
```

For an installed VSIX, set `researchCopilot.pythonPath` in **User Settings** to the absolute interpreter path. Installing dependencies into one interpreter while selecting another is a common cause of missing capabilities. Requirements are listed in `requirements.txt`; the packaged extension does not install them automatically. On Windows, use the corresponding `.venv\\Scripts\\python.exe` path; Windows is currently unverified.

If a test reports PDF/YAML cases as skipped, that is not full verification. Prepare the environment and rerun `npm run verify`.

## ChatGPT sign-in or model generation fails

1. Confirm `researchCopilot.backend` is `codex` if you intend to use subscription authentication.
2. Run **Research Copilot: Sign in with ChatGPT** and finish the browser flow. Check that it is the intended account; do not paste access tokens into the extension or project files.
3. Run **Research Copilot: Select Codex Model** and choose an available model. Workspace policy and account limits can still restrict access.
4. Check the executable configured by `codexPath`. The development build prefers the repository CLI only when the setting remains `codex`; an installed VSIX relies on the configured/PATH executable.

A model appearing in the list does not prove an old CLI can run it. CLI **0.151.0** passed live testing; this machine's older **0.133.0** advertised a model requiring a newer client. Use a compatible CLI/model pair instead of switching to API billing unintentionally.

Developers can check authentication and model availability using the repository's CLI from macOS/Linux:

```sh
RESEARCH_CODEX_PATH="$PWD/node_modules/.bin/codex" npx tsx scripts/smoke-codex.ts
```

Without `--generate`, the script reads account status and model availability; it does not request inference or send manuscript context. It does communicate with Codex. It reports authentication type, not a verified subscription tier.

The optional generation check uses synthetic text and consumes provider usage:

```sh
RESEARCH_CODEX_PATH="$PWD/node_modules/.bin/codex" npx tsx scripts/smoke-codex.ts --generate
```

Without the environment variable, this script uses the `codex` on PATH, which may differ from the development extension's CLI. Do not include these live checks in routine offline tests.

## No suggestion appears, or Tab does nothing

- Open a `.tex` or `.txt` file inside the project and place the cursor where you want help. Check its VS Code language mode is LaTeX/TeX or Plain Text.
- Check the provider row below the mode selector. Grok is the default for all modes; use its **Settings** link if you intended to select Codex, OpenAI, a local model, or a separate WRITE provider.
- OFF suppresses suggestions. GUIDE produces a sidebar card; only WRITE produces insertable ghost text.
- Automatic suggestions are off by default. Request explicitly with **Research Copilot: Suggest / Regenerate**. Automatic GUIDE needs a sentence ending; EVIDENCE needs a paragraph boundary. FIGURE / TABLE and STRUCTURE are explicit-only.
- A cloud backend needs consent on an explicit request before automatic requests run. Declining leaves the manuscript unchanged.
- A sidebar WRITE request returns focus to the manuscript automatically. If you dismissed the ready continuation, click **Show ghost text** to display it again without another provider call. If it still does not render, ensure VS Code's inline suggestions are enabled (`editor.inlineSuggest.enabled`) and another extension/keybinding is not intercepting Tab.
- Read evidence warnings. Unknown citations, unsupported numerical claims, malformed output, or stale sources can prevent insertion.
- A cursor move, document edit, mode switch, or source update can invalidate the suggestion. Regenerate at the intended position.

Native inline acceptance in automated UI tests requires window focus. A macOS background test host reports when it cannot exercise that part. The Linux CI suite runs a focused host under Xvfb; see the validation record linked from the [guide index](README.md).

## References, results, code, or outline entries are missing

1. Save the source files, then refresh the index. Unsaved non-manuscript sources are omitted from requests to avoid using obsolete evidence; current `.tex` and `.txt` manuscript buffers are used directly.
2. Check that files are under the active manuscript's workspace root, have a [supported format](CONFIGURATION.md#supported-files-and-limits), and do not depend on symlinks or external paths.
3. Check `project.yaml` lists and exclusions. Configured resource lists scope their file types; `paper.root` does not import external folders. YAML lists require `-` entries, not a single string.
4. In a Git repository, check whether untracked files are ignored. Files already tracked remain discoverable despite later `.gitignore` entries. Use explicit project exclusions for privacy.
5. Read indexing notices for size limits, invalid CSV headers/rows, invalid JSON/YAML, duplicate citation keys, syntax errors, or PDF extraction failure.
6. Narrow the search: a catalog shows at most 100 artifacts. Code is available through **Research Copilot: Pin Project Artifact**, not a separate Code tab.

For an outline with an arbitrary filename, set `outline.path`. YAML requires a list of mappings or a `nodes` list; each node should have a clear `title`. Save before expecting the Outline tab to refresh. If no persistent outline is found, manuscript headings form the temporary outline.

## A bibliography entry has no verified full text

Put the PDF inside the project and match it uniquely to the citation key or simple BibTeX `file` path. The [reference walkthrough](USAGE.md#manage-references-and-local-pdfs) shows a working example. External absolute paths and reference-manager-specific attachment encodings are not an import workflow.

PDFs classified as figures or compiled manuscript output are not literature passages. Scanned/image-only PDFs cannot supply exact text without external OCR. Extraction order can be imperfect for multi-column or unusual PDF text layers: inspect the rendered page before using a quote. Having a PDF attached does not by itself verify a claim.

## The assistant misses an important source

Search is lexical and context is bounded. Search explicitly, pin the relevant passage or row block, state the question more precisely, and regenerate. Pinning a very large artifact cannot force it past the context budget. Read Context's omission warnings and, if needed, choose a smaller block or adjust `contextBudget`.

Pinning outline metadata containing an evidence path does not fetch that file automatically. Pin the actual evidence artifact. Confirmed relationships can bring current linked artifacts into retrieval, but changes to either file invalidate their confirmation.

## A numeric claim or edit is blocked

Check the file hash, exact value, row, and column in the evidence. CSV row numbers exclude the header and count records, including multiline records. A dataset summary is not a substitute for the exact result cell. Save changed data, refresh, pin the needed rows, and regenerate. Do not bypass the warning by treating a model-generated number as verified analysis.

For “Manuscript changed after review,” request a new proposal and review the new diff. The extension refuses to apply a diff against changed text. Only existing `.tex` or `.txt` manuscript edits are supported; requests to modify raw data, code, or an outline must be handled in the normal editor.

## The local/API adapter returns an error

- Set the correct model field: `grokModel` / `grokWriteModel` for the default Grok route, `localModel` for the local server, `openaiModel` for OpenAI, or `model` for Codex.
- An OpenAI API request needs its own API key and billing access; ChatGPT sign-in does not authorize this adapter.
- Start a local server yourself and use a loopback `/v1` base URL. Non-loopback hosts and redirects are intentionally rejected.
- Verify support for strict JSON-schema output, not just ordinary text chat. “No structured text,” refusal, or schema errors can mean the model/server cannot satisfy this contract.
- Version 0.3.2 and later replace the opaque `fetch failed` message from both connection setup and interrupted response bodies with safe DNS, timeout, refusal, TLS, or general connectivity guidance. Check the named network condition, including VPN/proxy/firewall state, then retry manually. Requests are never retried automatically because a failed response may still have incurred provider usage.
- If Grok appends commentary after a complete structured object, 0.3.1 safely uses the first complete object and still applies all local schema/evidence checks. An incomplete object or ordinary prose remains an error.
- HTTP errors report the status. Check the server/model configuration before retrying. There is no silent provider fallback; `writeBackend` may select a different provider specifically for WRITE.

## Rebuild safely or report a bug

Try refresh first. For a corrupt SQLite cache, use the [cache rebuild instructions](CONFIGURATION.md#local-storage-backups-and-removal); retain your state and configuration files. Disabling request logging does not delete existing logs.

For an ordinary bug report, include OS, VS Code and extension versions, backend/CLI version, steps to reproduce, the exact error, and a minimal **synthetic** project. Report whether the issue occurs in a development window or an installed VSIX. Include test results if you ran them. Never attach credentials, the full index, request logs, or private research by default. Security-sensitive reports should follow the policy linked from the [guide index](README.md).

## Grok authentication or model errors

Run **Research Copilot: Set Grok API Key** to replace the stored key, and confirm the workspace uses `backend: "grok"` (or `writeBackend: "grok"` for WRITE only). A 401/403 response usually requires checking key permissions or account access; a model error requires an available structured-output model in `grokModel`. Check credits/rate limits in your xAI account for billing or 429 errors. Error bodies and keys are not echoed into the extension output. No request is retried or routed to another cloud provider automatically.

## The GUIDE box or locked quotation disappeared

GUIDE uses a native hover and a ◇ marker, not ghost text. Press Esc to dismiss the hover, then hover over the marker or run **Show Suggestion Card** to reopen it. Edits/cursor moves invalidate the suggestion; request again at the new position. Automatic requests show the marker without opening the hover. WRITE intentionally has no GUIDE hover.

Use **Lock reference**, not just **View source**, to hold a quote while navigating. Locks clear when the source changes, is excluded, or the project index/configuration resets. A bibliography entry without a selected PDF passage cannot provide a full-text quotation. Keep Research Copilot in VS Code's primary sidebar if you want the quote on the left.

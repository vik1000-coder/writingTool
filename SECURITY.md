# Security and privacy

Research Copilot is an early local-first VS Code extension. The current maintained version is 0.3.1; there is no security response SLA or independent security certification. Do not assume local indexing alone makes cloud inference appropriate for confidential research.

## Data and capabilities

- The extension has no telemetry and makes no model request on activation. Local indexing and evidence browsing do not require model inference.
- A cloud request transmits selected manuscript excerpts, retrieved artifacts, the question, and bounded Chat history when applicable. The current manuscript remains context even if other artifacts are excluded. Consent is not a preflight preview of every source; inspect the last request afterward.
- File/folder exclusions in `project.yaml` control discovery. Artifact exclusions apply to individual indexed units. Neither can retract a previous transmission or erase facts from existing Chat history. Filename heuristics and Git ignores are not a confidentiality guarantee.
- The SQLite index contains extracted research text and data. Section goals, pins, paths, relationships, and optional logs can also be sensitive. These local files are not encrypted by the extension. Use normal filesystem/device protection and intentional backup/Git policies.
- The optional WRITE cache can contain unpublished context and model output in extension-process memory. It is never written to disk, is bounded to 32 entries / 2 MiB / two minutes, and is cleared on extension shutdown or with **Clear Suggestion Cache**.
- Grok is the default provider. xAI/OpenAI keys are stored through VS Code SecretStorage; Codex owns its subscription credentials when explicitly selected. Do not paste credentials into project configuration or reports. Provider-side retention and account/workspace policies remain separate from this extension.
- The local adapter only accepts loopback URLs and refuses redirects. Whether the chosen local server forwards requests elsewhere is outside the extension's control.
- Codex suggestion sessions disable tool execution/inherited connectors and deny approvals. The indexer parses code without executing it. Model edit proposals are limited to existing `.tex` or `.txt` manuscripts and need a reviewed diff plus explicit application; raw results are not model-writable.
- Webviews render project/model strings as text under a restrictive content security policy. PDF parsing uses local native libraries. Workspace trust and current dependencies still matter; no parser should be treated as immune to malicious files.

Evidence validation checks current locators and source hashes. It does not certify scientific conclusions or defeat every possible prompt-injection attempt. Always inspect important sources and proposed edits.

## Reporting a concern

Do not put exploitable security details, access tokens, private manuscripts, or raw request logs into an ordinary public issue. Use GitHub's private **Report a vulnerability** route if it is available on the repository. If it is unavailable, contact the repository owner through an existing private channel; do not assume a public issue is confidential. No dedicated security email or private-reporting service is configured by this document.

Include affected versions, a minimal synthetic reproduction, expected versus observed access, and impact. Share only the data needed to reproduce the problem. For ordinary non-sensitive bugs, follow [Contributing](CONTRIBUTING.md).

## Before making a repository public

Review tracked files and history for credentials, unpublished work, logs, and caches. Choose whether to version `.research-copilot/state.json` and `project.yaml`; never commit the index or request logs. Confirm dependency licenses and a private security-reporting route before inviting external reports. Publishing the source or a Marketplace package is an explicit owner decision, not part of local setup.

See [configuration and storage](docs/CONFIGURATION.md#local-storage-backups-and-removal) for cleanup and [usage](docs/USAGE.md#choose-request-context) for context controls.

Grok requests go only to the fixed xAI HTTPS endpoint; keys are held in VS Code SecretStorage and never included in context or model error messages. Hover actions are limited to a current suggestion token and locally resolved evidence. A highlighted quotation is local source text; model summaries and relevance remain interpretations.

# Contributing

Keep the interaction small and deliberate. Research Copilot should help a researcher decide what to write before supplying prose.

## Set up and understand the project

Follow [Run locally](README.md#run-locally) for prerequisites and dependency setup. The repository needs Node.js 20+, Python 3.10+, and VS Code 1.96+. Run `npm ci`, `npm run setup`, and `npm run dev`, or use F5. Development runs in a separate VS Code window using the synthetic example project.

Read the [usage guide](docs/USAGE.md) before changing a workflow, then the [architecture](docs/ARCHITECTURE.md) and [acceptance ledger](docs/IMPLEMENTATION.md). Scope is the local VS Code MVP; deferred work is not implied to be implemented simply because it appears in the original specification.

## Make a focused change

1. Start with a failing behavioral test for a new feature or defect.
2. Keep research logic independent of VS Code in `src/core`, adapters in `src/backends`, and local parsing/indexing in `python`.
3. Run `npm run setup`, `npm run verify`, and `npm run test:extension`.
4. Update usage/configuration documentation when behavior changes. Add an entry to `docs/VALIDATION.md` for material integration coverage or limitations, and update the changelog for user-visible changes.
5. Submit a focused change with the problem, resulting behavior, tests, and risks.

For documentation-only changes, check relative links, command/setting names, and runnable examples rather than adding tests that mirror prose. Keep generated files, credentials, local paths, and real unpublished research out of examples.

## Verify at the right layer

| Check | Command | Scope |
| --- | --- | --- |
| Strict types | `npm run check` | VS Code API and core/adapters. |
| Core behavior | `npm run test:core` | Context, modes, integrity, edits, RPC/HTTP, and webview contracts. |
| Local indexer | `npm run test:indexer` | Parsing, scope, hashes, result rows, YAML, and PDF geometry/rendering. |
| Normal verification | `npm run verify` | Types, both test suites, and production bundle. |
| Editor acceptance | `npm run test:extension` | Isolated real VS Code host, real Python helper, deterministic loopback model fixture. |
| Local package | `npm run package` | Verification plus VSIX; does not publish or upload. |

The normal suites do not call a cloud model. Install optional Python dependencies for full coverage; skipped PDF/YAML cases are not a complete pass. Native inline acceptance needs OS focus; background macOS hosts report that limitation. Linux CI runs the host under Xvfb and packages the extension. Review checks for the exact commit, not just an older green build.

The optional [Codex smoke check](docs/TROUBLESHOOTING.md#chatgpt-sign-in-or-model-generation-fails) is separate: its `--generate` flag consumes provider usage with synthetic text. An account-status check is not proof of a subscription tier. The local index benchmark is `.venv/bin/python scripts/benchmark.py` on macOS/Linux; it generates and cleans up its own synthetic dataset.

## Preserve the safety boundaries

Never turn model strings into trusted evidence. Quotation text comes from local extraction; bibliography keys must exist; numeric locators must match source hashes and cells. Any new write capability must preserve review, approval, stale-source checks, undo, and raw-result protection.

Use synthetic fixtures rather than real unpublished research or account credentials. Do not add telemetry, provider calls to ordinary tests, automatic dependency installation, cloud infrastructure, or data execution without an explicit design decision. Do not commit `.research-copilot/index.sqlite`, request logs, secrets, wheels, model files, or node_modules.

## GitHub workflow and reporting

Use an existing relevant GitHub issue or describe a new concrete defect/feature. Work on a focused branch and submit a PR that states the problem, resulting behavior, test results, and known limits. Do not commit the generated VSIX or development caches; CI creates a package artifact. Avoid unrelated formatting or dependency churn.

For ordinary bugs, provide a minimal synthetic reproduction and version information as described in [Troubleshooting](docs/TROUBLESHOOTING.md#rebuild-safely-or-report-a-bug). Follow [SECURITY.md](SECURITY.md) for sensitive reports. Never post raw private context or credentials to an issue.

GitHub issues track the implementation stages and follow-up work. The repository remains private until its owner decides to publish it. Do not publish a Marketplace extension, change repository visibility, or create a public release as part of ordinary development. Contributions are covered by the repository's [MIT license](LICENSE); dependencies retain their own licenses.

# Contributing

Keep the interaction small and deliberate. Research Copilot should help a researcher decide what to write before supplying prose.

1. Start with a failing behavioral test for a new feature or defect.
2. Keep research logic independent of VS Code in `src/core`, adapters in `src/backends`, and local parsing/indexing in `python`.
3. Run `npm run setup`, `npm run verify`, and `npm run test:extension`.
4. Add an entry to `docs/VALIDATION.md` for material integration coverage or limitations.
5. Submit a focused change with the problem, resulting behavior, tests, and risks.

Never turn model strings into trusted evidence. Quotation text comes from local extraction; bibliography keys must exist; numeric locators must match source hashes and cells. Any new write capability must preserve review, approval, stale-source checks, undo, and raw-result protection.

Use synthetic fixtures rather than real unpublished research or account credentials. Do not add telemetry, provider calls to ordinary tests, automatic dependency installation, cloud infrastructure, or data execution without an explicit design decision. Do not commit `.research-copilot/index.sqlite`, request logs, secrets, wheels, model files, or node_modules.

GitHub issues track the three implementation stages. The repository remains private until its owner decides to publish it.

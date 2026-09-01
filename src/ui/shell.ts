import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
export function sidebarHtml(
  webview: vscode.Webview,
  extension: vscode.Uri,
): string {
  const nonce = randomBytes(18).toString("base64");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extension, "media", "sidebar.js"),
  );
  const style = webview.asWebviewUri(
    vscode.Uri.joinPath(extension, "media", "sidebar.css"),
  );
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;"><link rel="stylesheet" href="${style}"><title>Research Copilot</title></head><body>
  <header><div class="eyebrow">RESEARCH COPILOT</div><div class="heading-row"><h1>Think, then write.</h1><button id="setup" class="quiet" title="Check local setup" aria-label="Check local setup">⚙</button></div><label class="mode-label" for="mode">ASSISTANCE MODE</label><select id="mode"><option value="off">OFF · Observe</option><option value="guide" selected>GUIDE · Next idea</option><option value="write">WRITE · Continue</option><option value="evidence">EVIDENCE · Verify</option><option value="visual">FIGURE / TABLE · Present</option><option value="structure">STRUCTURE · Organize</option></select><p id="mode-help" class="muted"></p><div class="provider-row"><span id="provider-label" class="provider-label">Grok · all modes</span><button id="settings" class="link">Settings</button></div><div class="actions"><button id="suggest">Suggest next step</button><button id="cancel" class="secondary" hidden>Cancel</button></div><p id="status" class="status" role="status" aria-live="polite">Open a .tex or .txt research project to begin.</p></header>
  <nav role="tablist" aria-label="Research panels"></nav><main id="panel" role="tabpanel" tabindex="0"></main>
  <footer><span id="project-label">Local project · Read-only suggestions</span><button id="refresh" class="link">Refresh index</button></footer><script nonce="${nonce}" src="${script}"></script></body></html>`;
}

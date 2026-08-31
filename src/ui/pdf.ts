import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { ProjectIndex } from "../indexer";

export async function showPdf(
  index: ProjectIndex,
  id: string,
  extensionUri: vscode.Uri,
) {
  const artifact = await index.get(id);
  if (!artifact)
    throw new Error("Source changed. Refresh evidence before opening it.");
  const media = vscode.Uri.joinPath(extensionUri, "media");
  const panel = vscode.window.createWebviewPanel(
    "researchCopilot.pdf",
    artifact.title,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [media],
    },
  );
  const nonce = randomBytes(18).toString("base64");
  const script = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(media, "pdf.js"),
  );
  const style = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(media, "pdf.css"),
  );
  panel.webview.html = `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style}"><title>Local PDF evidence</title></head>
  <body><header>
    <button id="previous" aria-label="Previous page">←</button>
    <label>Page <input id="page" type="number" min="1" value="1"></label><span id="pages"></span>
    <button id="next" aria-label="Next page">→</button><button id="source">Evidence page</button>
    <label>Zoom <select id="scale"><option value="fit" selected>Fit width</option><option value="1">100%</option><option value="1.4">140%</option><option value="2">200%</option></select></label>
    <span id="status" role="status">Rendering local PDF…</span>
  </header><main><img id="pdf" alt="Locally rendered PDF page with source passage highlighted"></main>
  <blockquote id="quote"></blockquote><script nonce="${nonce}" src="${script}"></script></body></html>`;
  let generation = 0;
  const render = async (page?: number, scale?: number) => {
    const n = ++generation;
    try {
      const data = await index.renderPdf(id, page, scale);
      if (n === generation)
        await panel.webview.postMessage({
          ...data,
          sourcePage: artifact.locator.page ?? 1,
        });
    } catch (error) {
      if (n === generation)
        await panel.webview.postMessage({ error: String(error) });
    }
  };
  const listener = panel.webview.onDidReceiveMessage((message) => {
    if (message.type === "ready") void render();
    if (
      message.type === "page" &&
      Number.isInteger(message.page) &&
      message.page >= 1 &&
      typeof message.scale === "number"
    )
      void render(message.page, message.scale);
  });
  panel.onDidDispose(() => {
    generation++;
    listener.dispose();
  });
}

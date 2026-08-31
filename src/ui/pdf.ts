import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { ProjectIndex } from '../indexer';
export async function showPdf(index: ProjectIndex, id: string) {
  const artifact = await index.get(id);
  if (!artifact) throw new Error('Source changed. Refresh evidence before opening it.');
  const panel = vscode.window.createWebviewPanel('researchCopilot.pdf', artifact.title, vscode.ViewColumn.Beside, { enableScripts: true, localResourceRoots: [] });
  const nonce = randomBytes(18).toString('base64');
  panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">body{font:13px system-ui;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);margin:0}header{position:sticky;top:0;background:var(--vscode-editor-background);padding:12px;z-index:2;border-bottom:1px solid #8885;display:flex;align-items:center;gap:10px;flex-wrap:wrap}button,input,select{font:inherit;padding:5px}input{width:60px}main{padding:16px;text-align:center}img{max-width:100%;height:auto;box-shadow:0 2px 12px #0003}blockquote{white-space:pre-wrap;text-align:left;border-left:3px solid #bca044;padding:12px;max-width:850px;margin:16px auto}#status{font-size:12px}label{display:flex;align-items:center;gap:5px}</style></head><body><header><button id="previous" aria-label="Previous page">←</button><label>Page <input id="page" type="number" min="1" value="1"></label><span id="pages"></span><button id="next" aria-label="Next page">→</button><button id="source">Evidence page</button><label>Scale <select id="scale"><option value="1">100%</option><option value="1.4" selected>140%</option><option value="2">200%</option></select></label><span id="status" role="status">Rendering local PDF…</span></header><main><img id="pdf" alt="Locally rendered PDF page with source passage highlighted"><blockquote id="quote"></blockquote></main><script nonce="${nonce}">
  const api=acquireVsCodeApi();const $=id=>document.getElementById(id);let page=1,pages=1,sourcePage=1;
  const load=p=>api.postMessage({type:'page',page:Math.max(1,Math.min(pages,p)),scale:Number($('scale').value)});
  $('previous').onclick=()=>load(page-1);$('next').onclick=()=>load(page+1);$('source').onclick=()=>load(sourcePage);$('page').onchange=()=>load(Number($('page').value));$('scale').onchange=()=>load(page);
  window.addEventListener('message',e=>{const d=e.data;if(d.error){$('status').textContent=d.error;return;}page=d.page;pages=d.pages;sourcePage=d.sourcePage;$('page').value=page;$('page').max=pages;$('pages').textContent='of '+pages;$('status').textContent=d.path;$('quote').textContent=d.text;$('quote').hidden=!d.text;$('previous').disabled=page<=1;$('next').disabled=page>=pages;$('pdf').onload=()=>{if(d.highlight_rects.length){const y=d.highlight_rects[0][1]*$('pdf').clientHeight/d.height;window.scrollTo({top:Math.max(0,$('pdf').offsetTop+y-100)});}else window.scrollTo(0,0);};$('pdf').src='data:image/png;base64,'+d.image;});api.postMessage({type:'ready'});
  </script></body></html>`;
  let generation = 0;
  const render = async (page?: number, scale?: number) => {
    const n = ++generation;
    try { const data = await index.renderPdf(id, page, scale); if (n === generation) await panel.webview.postMessage({ ...data, sourcePage: artifact.locator.page ?? 1 }); }
    catch (e) { if (n === generation) await panel.webview.postMessage({ error: String(e) }); }
  };
  const listener = panel.webview.onDidReceiveMessage(m => {
    if (m.type === 'ready') void render();
    if (m.type === 'page' && Number.isInteger(m.page) && m.page >= 1 && typeof m.scale === 'number') void render(m.page, m.scale);
  });
  panel.onDidDispose(() => { generation++; listener.dispose(); });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const html =
  '<body><nav></nav><select id="mode"><option value="guide">GUIDE</option><option value="off">OFF</option></select><div id="mode-help"></div><div id="status"></div><button id="suggest"></button><button id="cancel"></button><button id="setup"></button><button id="refresh"></button><div id="project-label"></div><main id="panel"></main></body>';
test("sidebar renders model/source HTML as literal text and only sends narrow action messages", () => {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const messages: unknown[] = [];
  (dom.window as any).acquireVsCodeApi = () => ({
    getState: () => ({}),
    setState: () => {},
    postMessage: (message: unknown) => messages.push(message),
  });
  dom.window.eval(readFileSync("media/sidebar.js", "utf8"));
  const malicious = '<img src=x onerror="globalThis.compromised=true">';
  const source = {
    id: "pdf:fixture#1",
    kind: "pdf",
    path: "fixture.pdf",
    hash: "h",
    title: "Fixture",
    text: malicious,
    locator: { page: 1 },
    metadata: {},
  };
  dom.window.dispatchEvent(
    new dom.window.MessageEvent("message", {
      data: {
        type: "state",
        state: {
          mode: "guide",
          result: {
            suggestion: {
              mode: "guide",
              title: malicious,
              text: malicious,
              insert_text: "",
              proposal: null,
              edit: null,
            },
            evidence: [source],
            warnings: [],
            insertable: false,
          },
        },
      },
    }),
  );
  assert.ok(
    dom.window.document.querySelector("main")!.textContent!.includes(malicious),
  );
  assert.equal(dom.window.document.querySelectorAll("img").length, 0);
  const evidence = [...dom.window.document.querySelectorAll("nav button")].find(
    (b) => b.textContent === "Evidence",
  ) as HTMLButtonElement;
  evidence.click();
  assert.equal(
    dom.window.document.querySelector("blockquote")!.textContent,
    malicious,
  );
  const open = [...dom.window.document.querySelectorAll("button")].find(
    (b) => b.textContent === "Open highlighted passage",
  ) as HTMLButtonElement;
  open.click();
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {
    type: "open",
    id: source.id,
  });
  assert.equal((dom.window as any).compromised, undefined);
  dom.window.dispatchEvent(
    new dom.window.MessageEvent("message", {
      data: JSON.parse(
        JSON.stringify({
          type: "state",
          state: { mode: "guide", result: undefined, status: "Source changed" },
        }),
      ),
    }),
  );
  assert.equal(
    dom.window.document.querySelector("blockquote"),
    null,
    "A complete host snapshot must clear stale evidence when undefined fields are omitted by JSON",
  );
  dom.window.close();
});
test("PDF zoom controls change displayed page dimensions and preserve exact quote text", () => {
  const dom = new JSDOM(
    '<body><button id="previous"></button><button id="next"></button><button id="source"></button><input id="page"><select id="scale"><option value="fit">Fit</option><option value="2">200%</option></select><div id="pages"></div><div id="status"></div><img id="pdf"><blockquote id="quote"></blockquote></body>',
    { runScripts: "outside-only" },
  );
  const messages: unknown[] = [];
  (dom.window as any).acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => messages.push(message),
  });
  dom.window.eval(readFileSync("media/pdf.js", "utf8"));
  const data = {
    page: 2,
    pages: 3,
    sourcePage: 2,
    path: "source.pdf",
    text: "Exact source.",
    image: "",
    width: 1224,
    height: 1584,
    highlight_rects: [],
  };
  const send = () =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data }));
  send();
  const img = dom.window.document.getElementById("pdf") as HTMLImageElement;
  assert.equal(img.style.maxWidth, "100%");
  const select = dom.window.document.getElementById(
    "scale",
  ) as HTMLSelectElement;
  select.value = "2";
  select.dispatchEvent(new dom.window.Event("change"));
  send();
  assert.equal(img.style.maxWidth, "none");
  assert.equal(img.style.width, "1224px");
  assert.equal(
    dom.window.document.getElementById("quote")!.textContent,
    "Exact source.",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {
    type: "page",
    page: 2,
    scale: 2,
  });
  dom.window.close();
});

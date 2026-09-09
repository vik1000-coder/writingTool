import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { itemUri, ZoteroClient } from "../src/zotero";

test("Zotero local API imports scoped metadata/PDFs and reuses the private cache", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "research-zotero-"));
  const sourcePdf = path.resolve(
    "examples/bridge-study/references/pdfs/fixture2026.pdf",
  );
  const requests: string[] = [];
  let includeItem = true;
  let attachmentPath = sourcePdf;
  const server = createServer((request, response) => {
    requests.push(request.url || "");
    assert.equal(request.headers["zotero-api-version"], "3");
    assert.equal(request.headers["zotero-allowed-request"], "1");
    response.setHeader("Zotero-API-Version", "3");
    response.setHeader("Zotero-Server-ID", "test-server");
    response.setHeader("Content-Type", "application/json");
    const pathname = new URL(request.url || "/", "http://local").pathname;
    if (pathname === "/api/") response.end("{}");
    else if (pathname === "/api/users/0/groups")
      response.end(JSON.stringify([{ id: 42, name: "Lab Library" }]));
    else if (pathname === "/api/users/0/collections")
      response.end(
        JSON.stringify([{ key: "COLL1234", data: { name: "Current Paper" } }]),
      );
    else if (pathname === "/api/users/0/collections/COLL1234/items/top")
      response.end(
        JSON.stringify(
          includeItem
            ? [
                {
                  key: "ABCD1234",
                  version: 7,
                  bibtex: "@article{smith2026, title={Grounded Study}}",
                  data: {
                    itemType: "journalArticle",
                    title: "Grounded Study",
                    creators: [{ firstName: "Ada", lastName: "Smith" }],
                    date: "2026-04-02",
                    publicationTitle: "Journal of Fixtures",
                    DOI: "10.0/fixture",
                    abstractNote: "A local abstract.",
                    tags: [{ tag: "methods" }],
                  },
                },
              ]
            : [],
        ),
      );
    else if (pathname === "/api/users/0/items/ABCD1234/children")
      response.end(
        JSON.stringify([
          {
            key: "PDFD1234",
            version: 4,
            data: {
              itemType: "attachment",
              parentItem: "ABCD1234",
              contentType: "application/pdf",
              filename: "paper.pdf",
              title: "Full Text PDF",
            },
          },
        ]),
      );
    else if (pathname === "/api/users/0/items/PDFD1234/file/view/url") {
      response.setHeader("Content-Type", "text/plain");
      response.end(pathToFileURL(attachmentPath).href);
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ZoteroClient(`http://127.0.0.1:${address.port}/api`);
  try {
    assert.deepEqual(await client.libraries(), [
      { id: "users/0", name: "My Library" },
      { id: "groups/42", name: "Lab Library" },
    ]);
    assert.deepEqual(await client.collections("users/0"), [
      { key: "COLL1234", name: "Current Paper", parent: "" },
    ]);
    const scope = {
      library: "users/0",
      libraryName: "My Library",
      collection: "COLL1234",
      collectionName: "Current Paper",
    };
    const first = await client.sync(scope, workspace);
    assert.equal(first.items[0].citationKey, "smith2026");
    assert.equal(first.items[0].author, "Smith, Ada");
    assert.equal(first.items[0].year, "2026");
    assert.equal(first.items[0].attachments.length, 1);
    assert.match(
      first.items[0].attachments[0].cachePath,
      /^\.research-copilot\/zotero-cache\/[a-f0-9]{24}\/PDFD1234\.pdf$/,
    );
    assert.equal(JSON.stringify(first).includes(sourcePdf), false);
    const cached = path.join(
      workspace,
      first.items[0].attachments[0].cachePath,
    );
    assert.deepEqual(await readFile(cached), await readFile(sourcePdf));
    const firstCacheStat = await stat(cached);
    assert.equal(
      requests.filter((url) => url.includes("/file/view/url")).length,
      1,
    );
    await client.sync(scope, workspace);
    assert.equal(
      requests.filter((url) => url.includes("/file/view/url")).length,
      2,
      "each refresh should re-resolve linked files so external changes are noticed",
    );
    assert.equal(
      (await stat(cached)).mtimeMs,
      firstCacheStat.mtimeMs,
      "an unchanged source fingerprint should reuse the cached PDF bytes",
    );
    await writeFile(cached, "%PDF-corrupted cache");
    await client.sync(scope, workspace);
    assert.deepEqual(
      await readFile(cached),
      await readFile(sourcePdf),
      "a changed derived cache must be rebuilt from Zotero's current source",
    );
    includeItem = false;
    const emptied = await client.sync(scope, workspace);
    assert.deepEqual(emptied.staleCachePaths, [
      first.items[0].attachments[0].cachePath,
    ]);
    assert.ok(await stat(cached), "cache cleanup waits for index commit");
    await client.pruneCache(workspace, emptied.staleCachePaths);
    await assert.rejects(readFile(cached));
    includeItem = true;
    attachmentPath = path.join(workspace, "private-source", "missing.pdf");
    const missing = await client.sync(scope, workspace);
    assert.match(missing.warnings[0], /missing or unavailable/);
    assert.equal(
      JSON.stringify(missing).includes(attachmentPath),
      false,
      "attachment filesystem errors must not expose the original path",
    );
    includeItem = false;
    await client.clearCache(workspace);
    const cache = path.join(workspace, ".research-copilot", "zotero-cache");
    const outside = path.join(workspace, "outside-cache");
    const serverFolder = createHash("sha256")
      .update("test-server")
      .digest("hex")
      .slice(0, 24);
    await mkdir(cache, { recursive: true });
    await mkdir(outside);
    await symlink(outside, path.join(cache, serverFolder));
    await assert.rejects(
      client.sync(scope, workspace),
      /cache server directory is not a safe directory/,
    );
  } finally {
    server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Zotero collection discovery follows API pagination", async () => {
  const starts: number[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://local");
    const start = Number(url.searchParams.get("start") || 0);
    starts.push(start);
    response.setHeader("Content-Type", "application/json");
    const count = start === 0 ? 100 : start === 100 ? 1 : 0;
    response.end(
      JSON.stringify(
        Array.from({ length: count }, (_, index) => ({
          key: `${String(start + index).padStart(8, "0")}`,
          data: { name: `Collection ${start + index}` },
        })),
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const client = new ZoteroClient(`http://127.0.0.1:${address.port}/api`);
    assert.equal((await client.collections("users/0")).length, 101);
    assert.deepEqual(starts, [0, 100]);
  } finally {
    server.close();
  }
});

test("Zotero local API failures are bounded and actionable", async () => {
  let mode: "disabled" | "oversized" = "disabled";
  const server = createServer((_request, response) => {
    if (mode === "disabled") {
      response.statusCode = 403;
      response.end("disabled");
      return;
    }
    response.statusCode = 200;
    response.write("x".repeat(10_000));
    response.end("x".repeat(10_000));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = new ZoteroClient(`http://127.0.0.1:${address.port}/api`);
  try {
    await assert.rejects(client.probe(), /local API access is disabled/);
    mode = "oversized";
    await assert.rejects(client.probe(), /response exceeds size limit/);
  } finally {
    server.close();
  }
});

test("Zotero endpoints and item links remain fixed to safe local identities", () => {
  assert.throws(
    () => new ZoteroClient("https://api.zotero.org"),
    /fixed local HTTP API/,
  );
  assert.throws(
    () => new ZoteroClient("http://example.com:23119/api"),
    /fixed local HTTP API/,
  );
  assert.equal(
    itemUri("users/0", "ABCD1234"),
    "zotero://select/library/items/ABCD1234",
  );
  assert.equal(
    itemUri("groups/42", "ABCD1234"),
    "zotero://select/groups/42/items/ABCD1234",
  );
  assert.throws(() => itemUri("users/1", "ABCD1234"));
  assert.throws(() => itemUri("users/0", "../../bad"));
});

import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

const DEFAULT_BASE = "http://127.0.0.1:23119/api";
const MAX_ITEMS = 500;
const MAX_PDFS = 250;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const ITEM_KEY = /^[A-Z0-9]{8}$/i;
const CITATION_KEY = /^[A-Za-z0-9_:./+@-]{1,200}$/;

export interface ZoteroScope {
  library: string;
  libraryName: string;
  collection?: string;
  collectionName?: string;
}

export interface ZoteroLibrary {
  id: string;
  name: string;
}

export interface ZoteroCollection {
  key: string;
  name: string;
  parent?: string;
}

export interface ZoteroSyncItem {
  itemKey: string;
  citationKey: string;
  itemType: string;
  title: string;
  author: string;
  year: string;
  journal: string;
  doi: string;
  url: string;
  abstract: string;
  tags: string[];
  version: number;
  attachments: {
    itemKey: string;
    title: string;
    version: number;
    cachePath: string;
  }[];
}

export interface ZoteroSyncPayload {
  serverId: string;
  library: string;
  libraryName: string;
  collection?: string;
  collectionName?: string;
  items: ZoteroSyncItem[];
  warnings: string[];
}

export interface ZoteroSyncResult extends ZoteroSyncPayload {
  staleCachePaths: string[];
}

type JsonObject = Record<string, any>;
type CacheManifest = {
  serverId: string;
  files: Record<
    string,
    {
      version: number;
      cachePath: string;
      sourceFingerprint: string;
      cacheFingerprint: string;
    }
  >;
};

function validateBase(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Zotero must use its fixed local HTTP API");
  return url.href.replace(/\/$/, "");
}

function validateLibrary(value: string) {
  if (value === "users/0" || /^groups\/\d{1,20}$/.test(value)) return value;
  throw new Error("Invalid Zotero library identifier");
}

function string(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function citationKey(record: JsonObject) {
  const explicit = string(record.data?.citationKey, 200);
  if (CITATION_KEY.test(explicit)) return explicit;
  const exported = string(record.bibtex, 1_000_000).match(
    /^\s*@[a-z]+\s*\{\s*([^,\s{}\\]+)\s*,/i,
  )?.[1];
  if (exported && CITATION_KEY.test(exported)) return exported;
  const fallback = string(record.key ?? record.data?.key, 8);
  if (ITEM_KEY.test(fallback)) return fallback;
  throw new Error("Zotero returned an item without a usable citation key");
}

function itemKey(record: JsonObject) {
  const key = string(record.key ?? record.data?.key, 8);
  if (!ITEM_KEY.test(key))
    throw new Error("Zotero returned an invalid item key");
  return key.toUpperCase();
}

function creators(data: JsonObject) {
  if (!Array.isArray(data.creators)) return "";
  return data.creators
    .slice(0, 50)
    .map((creator: JsonObject) => {
      const name = string(creator.name, 200);
      if (name) return name;
      return [string(creator.lastName, 100), string(creator.firstName, 100)]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean)
    .join(" and ")
    .slice(0, 2_000);
}

function zoteroUri(library: string, key: string) {
  return library === "users/0"
    ? `zotero://select/library/items/${key}`
    : `zotero://select/groups/${library.slice("groups/".length)}/items/${key}`;
}

async function cachedPdfFingerprint(file: string) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size <= 4 || stat.size > MAX_PDF_BYTES)
      return "";
    const handle = await fs.open(file, "r");
    try {
      const signature = Buffer.alloc(5);
      await handle.read(signature, 0, 5, 0);
      if (signature.toString("ascii") !== "%PDF-") return "";
    } finally {
      await handle.close();
    }
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(
      ":",
    );
  } catch {
    return "";
  }
}

export class ZoteroClient {
  private base: string;

  constructor(base = DEFAULT_BASE) {
    this.base = validateBase(base);
  }

  private url(resource: string, query?: Record<string, string>) {
    const url = new URL(`${this.base}/${resource.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.set(key, value);
    return url;
  }

  private async response(
    resource: string,
    options: { query?: Record<string, string>; limit?: number } = {},
  ) {
    let response: Response;
    try {
      response = await fetch(this.url(resource, options.query), {
        redirect: "error",
        headers: {
          "Zotero-API-Version": "3",
          "Zotero-Allowed-Request": "1",
          "User-Agent": "research-copilot/0.4",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const cause =
        error instanceof Error && "cause" in error
          ? (error.cause as { code?: unknown } | undefined)
          : undefined;
      if (cause?.code === "ECONNREFUSED")
        throw new Error(
          "Zotero is not reachable. Open Zotero and enable Settings → Advanced → Allow other applications on this computer to communicate with Zotero.",
        );
      throw new Error(
        `Could not reach Zotero's local API${error instanceof Error && error.name === "TimeoutError" ? " before the 15-second timeout" : ""}.`,
      );
    }
    if (response.status === 403)
      throw new Error(
        "Zotero local API access is disabled. Enable Settings → Advanced → Allow other applications on this computer to communicate with Zotero.",
      );
    if (!response.ok)
      throw new Error(`Zotero local API returned HTTP ${response.status}.`);
    const advertised = response.headers.get("zotero-api-version");
    if (advertised && advertised !== "3")
      throw new Error(`Unsupported Zotero local API version ${advertised}.`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    const limit = options.limit ?? MAX_JSON_BYTES;
    if (declared > limit)
      throw new Error("Zotero response exceeds size limit.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          throw new Error("Zotero response exceeds size limit.");
        }
        chunks.push(value);
      }
    }
    const bytes = Buffer.concat(chunks, total);
    return { response, text: new TextDecoder().decode(bytes) };
  }

  async probe() {
    const { response } = await this.response("", { limit: 16_384 });
    return {
      serverId:
        string(response.headers.get("zotero-server-id"), 200) || "legacy-local",
      apiVersion: response.headers.get("zotero-api-version") || "3",
    };
  }

  private async json(resource: string, query?: Record<string, string>) {
    const { text } = await this.response(resource, { query });
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Zotero returned malformed JSON.");
    }
    if (!Array.isArray(value))
      throw new Error("Zotero returned an invalid list.");
    return value as JsonObject[];
  }

  private async pagedJson(
    resource: string,
    query: Record<string, string>,
    stopAfter: number,
    scanLimit: number,
    include: (record: JsonObject) => boolean = () => true,
  ) {
    const records: JsonObject[] = [];
    let scanned = 0;
    while (scanned < scanLimit) {
      const limit = Math.min(100, scanLimit - scanned);
      const page = await this.json(resource, {
        ...query,
        limit: String(limit),
        start: String(scanned),
      });
      scanned += page.length;
      for (const record of page) {
        if (include(record)) records.push(record);
        if (records.length >= stopAfter) return records;
      }
      if (page.length < limit) return records;
    }
    throw new Error("Zotero scope is too large. Connect a smaller collection.");
  }

  async libraries(): Promise<ZoteroLibrary[]> {
    await this.probe();
    let groups: JsonObject[] = [];
    try {
      groups = await this.pagedJson("users/0/groups", {}, 1_001, 1_001);
      if (groups.length > 1_000)
        throw new Error("Zotero profile has more than 1,000 group libraries.");
    } catch {
      // Older/local-only profiles may not expose group metadata. The personal
      // library remains fully usable, so group discovery is best-effort.
    }
    return [
      { id: "users/0", name: "My Library" },
      ...groups.flatMap((record) => {
        const id = Number(record.id ?? record.data?.id);
        const name = string(record.name ?? record.data?.name, 300);
        return Number.isSafeInteger(id) && id > 0 && name
          ? [{ id: `groups/${id}`, name }]
          : [];
      }),
    ];
  }

  async collections(library: string): Promise<ZoteroCollection[]> {
    library = validateLibrary(library);
    const records = await this.pagedJson(
      `${library}/collections`,
      {},
      2_001,
      2_001,
    );
    if (records.length > 2_000)
      throw new Error("Zotero library has more than 2,000 collections.");
    return records.flatMap((record) => {
      const data = record.data ?? record;
      const key = string(record.key ?? data.key, 8).toUpperCase();
      const name = string(data.name, 500);
      const parent = string(data.parentCollection, 8).toUpperCase();
      return ITEM_KEY.test(key) && name ? [{ key, name, parent }] : [];
    });
  }

  private async manifest(file: string): Promise<CacheManifest> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        parsed &&
        typeof parsed.serverId === "string" &&
        parsed.files &&
        typeof parsed.files === "object"
      ) {
        const files: CacheManifest["files"] = {};
        for (const [key, value] of Object.entries(parsed.files)) {
          const entry = value as Record<string, unknown>;
          if (
            typeof entry?.version === "number" &&
            Number.isFinite(entry.version) &&
            typeof entry.cachePath === "string" &&
            /^\.research-copilot\/zotero-cache\/[a-f0-9]{12,64}\/[A-Z0-9]{8}\.pdf$/i.test(
              entry.cachePath,
            ) &&
            typeof entry.sourceFingerprint === "string" &&
            typeof entry.cacheFingerprint === "string"
          )
            files[key] = {
              version: entry.version,
              cachePath: entry.cachePath,
              sourceFingerprint: entry.sourceFingerprint.slice(0, 500),
              cacheFingerprint: entry.cacheFingerprint.slice(0, 500),
            };
        }
        return { serverId: parsed.serverId.slice(0, 200), files };
      }
    } catch {
      // A missing or corrupt derived cache is safely rebuilt from Zotero.
    }
    return { serverId: "", files: {} };
  }

  private async cacheDirectory(workspace: string) {
    const root = await fs.realpath(workspace);
    const local = path.join(root, ".research-copilot");
    await fs.mkdir(local, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(local)).isSymbolicLink())
      throw new Error("Research Copilot local state must not be a symlink.");
    const cache = path.join(local, "zotero-cache");
    try {
      if ((await fs.lstat(cache)).isSymbolicLink())
        throw new Error("Zotero cache must not be a symlink.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    const resolved = await fs.realpath(cache);
    const relative = path.relative(root, resolved);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error("Zotero cache resolves outside the workspace.");
    return resolved;
  }

  private async cacheServerDirectory(cacheRoot: string, serverId: string) {
    const folder = createHash("sha256")
      .update(serverId)
      .digest("hex")
      .slice(0, 24);
    const directory = path.join(cacheRoot, folder);
    try {
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(
          "Zotero cache server directory is not a safe directory.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(directory, { mode: 0o700 });
    }
    const resolved = await fs.realpath(directory);
    if (path.dirname(resolved) !== cacheRoot)
      throw new Error(
        "Zotero cache server directory resolves outside the cache.",
      );
    return resolved;
  }

  private async attachmentSource(library: string, key: string) {
    const { text } = await this.response(
      `${library}/items/${key}/file/view/url`,
      { limit: 8_192 },
    );
    let source: string;
    try {
      const url = new URL(text.trim());
      if (url.protocol !== "file:") throw new Error("not a local file");
      source = fileURLToPath(url);
    } catch {
      throw new Error("Zotero attachment did not resolve to a local file.");
    }
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(source);
    } catch {
      throw new Error("Zotero attachment file is missing or unavailable.");
    }
    if (!stat.isFile()) throw new Error("Zotero attachment is not a file.");
    if (stat.size > MAX_PDF_BYTES)
      throw new Error("Zotero attachment exceeds the 20 MiB PDF limit.");
    return {
      source,
      stat,
      fingerprint: [
        stat.dev,
        stat.ino,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
      ].join(":"),
    };
  }

  private async copyAttachment(
    source: string,
    before: Awaited<ReturnType<typeof fs.stat>>,
    target: string,
  ) {
    try {
      if (!before.isFile()) throw new Error("Zotero attachment is not a file.");
      if (before.size > MAX_PDF_BYTES)
        throw new Error("Zotero attachment exceeds the 20 MiB PDF limit.");
      const handle = await fs.open(source, "r");
      try {
        const signature = Buffer.alloc(5);
        await handle.read(signature, 0, 5, 0);
        if (signature.toString("ascii") !== "%PDF-")
          throw new Error("Zotero attachment is not a PDF file.");
      } finally {
        await handle.close();
      }
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await fs.copyFile(source, temporary);
        await fs.chmod(temporary, 0o600);
        const after = await fs.stat(source);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
          throw new Error(
            "Zotero attachment changed while it was being copied.",
          );
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Zotero attachment")
      )
        throw error;
      throw new Error(
        "Zotero attachment could not be copied into the private cache.",
      );
    }
  }

  private async assertCacheTarget(target: string) {
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error("Zotero cache target is not a safe file.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Zotero cache target could not be inspected.");
    }
  }

  async sync(scope: ZoteroScope, workspace: string): Promise<ZoteroSyncResult> {
    const workspaceRoot = await fs.realpath(workspace);
    const library = validateLibrary(scope.library);
    const collection = scope.collection?.toUpperCase();
    if (collection && !ITEM_KEY.test(collection))
      throw new Error("Invalid Zotero collection key");
    const { serverId } = await this.probe();
    const itemResource = collection
      ? `${library}/collections/${collection}/items/top`
      : `${library}/items/top`;
    const records = await this.pagedJson(
      itemResource,
      { include: "data,bibtex", sort: "dateModified", direction: "desc" },
      MAX_ITEMS + 1,
      5_000,
      (record) =>
        !["attachment", "note", "annotation"].includes(
          string((record.data ?? record).itemType, 100),
        ),
    );
    if (records.length > MAX_ITEMS)
      throw new Error(
        `Zotero scope has more than ${MAX_ITEMS} items. Connect a smaller collection.`,
      );
    const citationKeys = new Set<string>();
    const items = records.map((record) => {
      const key = itemKey(record);
      const cite = citationKey(record);
      if (citationKeys.has(cite))
        throw new Error(`Duplicate Zotero citation key: ${cite}`);
      citationKeys.add(cite);
      return { record, key, cite };
    });
    const attachments = new Map<string, JsonObject[]>();
    for (let start = 0; start < items.length; start += 12) {
      const batch = items.slice(start, start + 12);
      await Promise.all(
        batch.map(async ({ key: parent }) => {
          const children = await this.json(
            `${library}/items/${parent}/children`,
            {
              itemType: "attachment",
              include: "data",
              limit: "21",
            },
          );
          if (children.length > 20)
            throw new Error(
              `Zotero item ${parent} has more than 20 attachments.`,
            );
          attachments.set(
            parent,
            children.filter((child) => {
              const data = child.data ?? child;
              const contentType = string(data.contentType, 200).toLowerCase();
              const filename = string(data.filename, 500).toLowerCase();
              return (
                contentType === "application/pdf" || filename.endsWith(".pdf")
              );
            }),
          );
        }),
      );
    }

    const cacheRoot = await this.cacheDirectory(workspaceRoot);
    const manifestPath = path.join(cacheRoot, "manifest.json");
    const previous = await this.manifest(manifestPath);
    const serverRoot = await this.cacheServerDirectory(cacheRoot, serverId);
    const files: CacheManifest["files"] = {};
    const warnings: string[] = [];
    const output: ZoteroSyncItem[] = [];
    let pdfCount = 0;

    for (const { record, key, cite } of items) {
      const data = record.data ?? record;
      const itemAttachments: ZoteroSyncItem["attachments"] = [];
      for (const attachment of attachments.get(key) ?? []) {
        if (pdfCount >= MAX_PDFS) {
          warnings.push(
            `Only the first ${MAX_PDFS} PDF attachments were imported. Connect a smaller collection for complete evidence.`,
          );
          break;
        }
        const attachmentKey = itemKey(attachment);
        const attachmentData = attachment.data ?? attachment;
        const version =
          Number(attachment.version ?? attachmentData.version) || 0;
        const manifestKey = `${library}:${attachmentKey}`;
        const target = path.join(serverRoot, `${attachmentKey}.pdf`);
        const cachePath = path
          .relative(workspaceRoot, target)
          .split(path.sep)
          .join("/");
        try {
          await this.assertCacheTarget(target);
          const resolved = await this.attachmentSource(library, attachmentKey);
          const cached = previous.files[manifestKey];
          let cacheFingerprint = await cachedPdfFingerprint(target);
          if (
            previous.serverId !== serverId ||
            cached?.version !== version ||
            cached.cachePath !== cachePath ||
            cached.sourceFingerprint !== resolved.fingerprint ||
            !cacheFingerprint ||
            cached.cacheFingerprint !== cacheFingerprint
          ) {
            await this.copyAttachment(resolved.source, resolved.stat, target);
            cacheFingerprint = await cachedPdfFingerprint(target);
            if (!cacheFingerprint)
              throw new Error("Zotero attachment cache verification failed.");
          }
          files[manifestKey] = {
            version,
            cachePath,
            sourceFingerprint: resolved.fingerprint,
            cacheFingerprint,
          };
          itemAttachments.push({
            itemKey: attachmentKey,
            title:
              string(attachmentData.title, 1_000) ||
              `${data.title || cite} PDF`,
            version,
            cachePath,
          });
          pdfCount++;
        } catch (error) {
          warnings.push(
            `${string(data.title, 200) || cite}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const date = string(data.date, 200);
      output.push({
        itemKey: key,
        citationKey: cite,
        itemType: string(data.itemType, 100) || "document",
        title: string(data.title, 1_000) || "Untitled Zotero item",
        author: creators(data),
        year: date.match(/(?:^|\D)(\d{4})(?:\D|$)/)?.[1] ?? "",
        journal: string(
          data.publicationTitle ?? data.bookTitle ?? data.proceedingsTitle,
          1_000,
        ),
        doi: string(data.DOI, 500),
        url: string(data.url, 2_000),
        abstract: string(data.abstractNote, 8_000),
        tags: Array.isArray(data.tags)
          ? data.tags
              .slice(0, 50)
              .map((tag: JsonObject) => string(tag.tag, 200))
              .filter(Boolean)
          : [],
        version: Number(record.version ?? data.version) || 0,
        attachments: itemAttachments,
      });
    }

    await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    const nextManifest: CacheManifest = { serverId, files };
    const tempManifest = `${manifestPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempManifest, JSON.stringify(nextManifest), {
        encoding: "utf8",
        mode: 0o600,
      });
      await fs.rename(tempManifest, manifestPath);
    } finally {
      await fs.rm(tempManifest, { force: true });
    }
    const currentPaths = new Set(
      Object.values(files).map((entry) => entry.cachePath),
    );
    const staleCachePaths = Object.values(previous.files)
      .map((entry) => entry.cachePath)
      .filter((candidate) => !currentPaths.has(candidate));

    return {
      serverId,
      library,
      libraryName: string(scope.libraryName, 300) || "Zotero",
      ...(collection ? { collection } : {}),
      ...(collection
        ? { collectionName: string(scope.collectionName, 500) || collection }
        : {}),
      items: output,
      warnings: [...new Set(warnings)].slice(0, 100),
      staleCachePaths,
    };
  }

  async pruneCache(workspace: string, cachePaths: string[]) {
    if (!Array.isArray(cachePaths) || cachePaths.length > MAX_PDFS)
      throw new Error("Invalid Zotero cache cleanup request.");
    const root = await fs.realpath(workspace);
    const cacheRoot = path.join(root, ".research-copilot", "zotero-cache");
    for (const cachePath of cachePaths) {
      if (
        !/^\.research-copilot\/zotero-cache\/[a-f0-9]{12,64}\/[A-Z0-9]{8}\.pdf$/i.test(
          cachePath,
        )
      )
        throw new Error("Invalid Zotero cache cleanup path.");
      const candidate = path.resolve(root, cachePath);
      const parent = path.dirname(candidate);
      try {
        const parentStat = await fs.lstat(parent);
        const parentReal = await fs.realpath(parent);
        if (
          parentStat.isSymbolicLink() ||
          !parentStat.isDirectory() ||
          path.dirname(parentReal) !== cacheRoot
        )
          throw new Error("Zotero cache cleanup path is not safe.");
        await fs.rm(candidate, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  async clearCache(workspace: string) {
    const root = await fs.realpath(workspace);
    const cache = path.join(root, ".research-copilot", "zotero-cache");
    try {
      if ((await fs.lstat(cache)).isSymbolicLink())
        throw new Error("Zotero cache must not be a symlink.");
      const resolved = await fs.realpath(cache);
      if (path.dirname(resolved) !== path.join(root, ".research-copilot"))
        throw new Error("Zotero cache resolves outside the workspace.");
      await fs.rm(resolved, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function itemUri(library: string, key: string) {
  validateLibrary(library);
  if (!ITEM_KEY.test(key)) throw new Error("Invalid Zotero item key");
  return zoteroUri(library, key.toUpperCase());
}

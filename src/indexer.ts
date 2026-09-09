import * as path from "node:path";
import { JsonLineClient } from "./backends/rpc";
import type {
  Artifact,
  ArtifactKind,
  ProjectState,
  Relation,
} from "./core/types";
import type { ZoteroSyncPayload } from "./zotero";
export interface ScanReport {
  indexed: number;
  unchanged: number;
  removed: number;
  count: number;
  warnings: string[];
  capabilities: { pdf: boolean; yaml: boolean };
  config: { paper?: { root?: string }; outline?: { path?: string } };
}
export interface ZoteroIndexReport {
  items: number;
  pdfs: number;
  count: number;
  warnings: string[];
}
export class ProjectIndex {
  private client: JsonLineClient;
  constructor(
    python: string,
    extensionPath: string,
    root: string,
    log: (text: string) => void,
  ) {
    this.client = new JsonLineClient(
      python,
      ["-u", path.join(extensionPath, "python", "research_indexer.py"), root],
      { log, env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
  }
  scan(paths?: string[]) {
    return this.client.request<ScanReport>(
      "scan",
      { paths },
      { timeoutMs: 180000 },
    );
  }
  search(query = "", kinds?: ArtifactKind[], limit = 30) {
    return this.client.request<Artifact[]>("search_project", {
      query,
      kinds,
      limit,
    });
  }
  get(id: string) {
    return this.client.request<Artifact | null>("get", { id });
  }
  resolve(ids: string[]) {
    return this.client.request<Artifact[]>("resolve", { ids });
  }
  state() {
    return this.client.request<ProjectState>("state", {});
  }
  update(action: string, payload: unknown) {
    return this.client.request<ProjectState>("update_state", {
      action,
      payload,
    });
  }
  graph() {
    return this.client.request<Relation[]>("graph", {});
  }
  renderPdf(id: string, page?: number, scale?: number) {
    return this.client.request<{
      image: string;
      page: number;
      pages: number;
      width: number;
      height: number;
      highlight_rects: number[][];
      text: string;
      path: string;
    }>("render_pdf", { id, page, scale });
  }
  syncZotero(payload: ZoteroSyncPayload) {
    return this.client.request<ZoteroIndexReport>("sync_zotero", payload, {
      timeoutMs: 180000,
    });
  }
  clearZotero() {
    return this.client.request<{ count: number }>("clear_zotero", {});
  }
  dispose() {
    this.client.dispose();
  }
}

import * as vscode from "vscode";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs, existsSync } from "node:fs";
import { CodexBackend } from "./backends/codex";
import { HttpBackend } from "./backends/http";
import { assembleContext, buildPrompt } from "./core/context";
import { hashText, prepareEdit, safeRelative } from "./core/edits";
import { cursorContext, resolveIncludes } from "./core/latex";
import {
  citationText,
  isManuscriptPath,
  parseManuscript,
} from "./core/manuscript";
import { refreshManuscriptArtifact } from "./core/live";
import { resolveSuggestion, validateSuggestion } from "./core/integrity";
import { MODES, shouldTrigger, validateMode } from "./core/modes";
import type {
  Artifact,
  ArtifactKind,
  ContextPacket,
  Mode,
  ProjectState,
  ResearchModelBackend,
  ResolvedSuggestion,
  Relation,
} from "./core/types";
import { ProjectIndex, type ScanReport } from "./indexer";
import { sidebarHtml } from "./ui/shell";
import { showPdf } from "./ui/pdf";
import {
  sourceCards,
  suggestedReferences,
  type SourceCard,
} from "./core/cards";
import { SuggestionHover } from "./ui/hover";
import { CompletionCache } from "./core/completion-cache";
import {
  providerForMode,
  type ProviderKind,
  type WriteProvider,
} from "./core/provider";
import {
  addSessionUsage,
  emptyUsageSession,
  summarizeUsage,
  type UsageSummary,
} from "./core/usage";

const isManuscript = (document: vscode.TextDocument) =>
  document.uri.scheme === "file" && isManuscriptPath(document.fileName);
const emptyState = (): ProjectState => ({
  pins: [],
  excluded: [],
  relations: [],
  sections: {},
});
const catalogKinds: Record<string, ArtifactKind[]> = {
  Outline: ["outline"],
  Results: ["result"],
  References: ["bib", "pdf"],
  Figures: ["figure", "table"],
};
type SuggestOptions = {
  automatic?: boolean;
  triggerInline?: boolean;
  regenerate?: boolean;
  focusInline?: boolean;
};

export class ResearchCopilot
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  private view?: vscode.WebviewView;
  private statusbar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    80,
  );
  private output = vscode.window.createOutputChannel("Research Copilot");
  private diagnostics =
    vscode.languages.createDiagnosticCollection("researchCopilot");
  private disposables: vscode.Disposable[] = [];
  private index?: ProjectIndex;
  private indexReady?: Promise<void>;
  private root?: vscode.WorkspaceFolder;
  private codex?: CodexBackend;
  private watcher?: vscode.FileSystemWatcher;
  private pendingFiles = new Set<string>();
  private watchTimer?: ReturnType<typeof setTimeout>;
  private triggerTimer?: ReturnType<typeof setTimeout>;
  private abort?: AbortController;
  private epoch = 0;
  private mode: Mode;
  private editor?: vscode.TextEditor;
  private cursorKey = "";
  private busy = false;
  private status = "Open a .tex or .txt project. Suggestions are read-only.";
  private report?: ScanReport;
  private projectState = emptyState();
  private relations: Relation[] = [];
  private result?: ResolvedSuggestion;
  private hover = new SuggestionHover();
  private sources: SourceCard[] = [];
  private cardToken?: string;
  private selectedSource?: SourceCard & { locked: boolean };
  private sourceFocus = 0;
  private writeCache = new CompletionCache<{
    context: ContextPacket;
    prompt: string;
    response: unknown;
    suggestion: ReturnType<typeof validateSuggestion>;
    backend: string;
  }>();
  private suggestionTask?: Promise<void>;
  private pendingMode?: Mode | "chat";
  private providerSession = randomUUID();
  private timing?: {
    source: "cache" | "model";
    totalMs: number;
    cachedInputTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  private usageLast?: UsageSummary;
  private usageSession = emptyUsageSession();
  private contextPacket?: ContextPacket;
  private lastRequest?: {
    prompt: string;
    context: ContextPacket;
    response?: unknown;
    resolved?: ResolvedSuggestion;
    timestamp: string;
    backend: string;
    usage?: UsageSummary;
    cache?: { hit: true; consumed: number; ageMs: number };
    applied?: unknown;
  };
  private history: { role: string; text: string }[] = [];
  private catalog: Artifact[] = [];
  private catalogTab = "Outline";
  private ghost?: {
    uri: string;
    version: number;
    offset: number;
    text: string;
  };
  private lastInlineRequest?: {
    version: number;
    offset: number;
    cancelled: boolean;
    available: boolean;
  };
  private reviewed?: {
    uri: vscode.Uri;
    version: number;
    hash: string;
    updated: string;
    start: number;
    end: number;
    replacement: string;
  };
  private snapshots = new Map<string, string>();
  private cloudConsent = new Set<string>();
  private disposed = false;

  constructor(private extension: vscode.ExtensionContext) {
    const saved = extension.workspaceState.get<string>("mode", "guide");
    try {
      this.mode = validateMode(saved);
    } catch {
      this.mode = "guide";
    }
    this.statusbar.command = "researchCopilot.setMode";
    this.statusbar.show();
    this.editor =
      vscode.window.activeTextEditor &&
      isManuscript(vscode.window.activeTextEditor.document)
        ? vscode.window.activeTextEditor
        : vscode.window.visibleTextEditors.find((editor) =>
            isManuscript(editor.document),
          );
    if (this.editor) this.cursorKey = this.selectionKey(this.editor);
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        "research-copilot-preview",
        {
          provideTextDocumentContent: (uri) =>
            this.snapshots.get(uri.toString()) ?? "",
        },
      ),
    );
    this.disposables.push(
      vscode.languages.registerInlineCompletionItemProvider(
        [
          { scheme: "file", language: "latex" },
          { scheme: "file", language: "tex" },
          { scheme: "file", language: "plaintext" },
        ],
        {
          provideInlineCompletionItems: async (
            document,
            position,
            context,
            token,
          ) => {
            if (this.mode !== "write" || !isManuscript(document)) return [];
            if (!this.ghost && !this.busy) {
              const reused = await this.reuseWrite(document, position);
              if (
                !reused &&
                context.triggerKind ===
                  vscode.InlineCompletionTriggerKind.Invoke
              )
                await this.suggest(undefined, { triggerInline: false });
            }
            if (token.isCancellationRequested) return [];
            const ghost = this.ghost;
            this.lastInlineRequest = {
              version: document.version,
              offset: document.offsetAt(position),
              cancelled: token.isCancellationRequested,
              available: Boolean(ghost),
            };
            if (
              !ghost ||
              ghost.uri !== document.uri.toString() ||
              ghost.version !== document.version ||
              ghost.offset !== document.offsetAt(position)
            )
              return [];
            return [
              new vscode.InlineCompletionItem(
                ghost.text,
                new vscode.Range(position, position),
              ),
            ];
          },
        },
      ),
    );
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && isManuscript(editor.document)) {
          if (
            this.editor?.document.uri.toString() ===
              editor.document.uri.toString() &&
            this.cursorKey === this.selectionKey(editor)
          ) {
            // VS Code may create a new TextEditor wrapper when an existing
            // document is focused from another group. Keep a current handle
            // without invalidating a suggestion at the same document/cursor.
            this.editor = editor;
            return;
          }
          this.editor = editor;
          this.cursorKey = this.selectionKey(editor);
          this.invalidate();
          void this.run(() => this.ensureIndex());
        }
      }),
    );
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor === this.editor) {
          const key = this.selectionKey(e.textEditor);
          if (key !== this.cursorKey) {
            this.cursorKey = key;
            this.invalidate();
            this.scheduleAutomatic();
          }
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          e.contentChanges.length &&
          e.document.uri.scheme === "file" &&
          vscode.workspace
            .getWorkspaceFolder(e.document.uri)
            ?.uri.toString() === this.root?.uri.toString()
        ) {
          this.invalidateSource(e.document.uri);
          this.invalidate();
          // A cached completion may include any project source. Keep prefix
          // reuse for typing in the active manuscript, but invalidate for
          // every other dirty buffer because the on-disk hash no longer
          // represents what the author sees.
          if (
            e.document.uri.toString() !== this.editor?.document.uri.toString()
          )
            this.writeCache.clear();
          this.reviewed = undefined;
          if (e.document === this.editor?.document) this.scheduleAutomatic();
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("researchCopilot")) {
          this.writeCache.clear();
          this.providerSession = randomUUID();
          this.invalidate();
          this.codex?.dispose();
          this.codex = undefined;
          this.resetIndex();
          this.publish();
        }
      }),
    );
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.invalidate();
        this.resetIndex();
      }),
    );
    this.publish();
  }
  setting<T>(name: string, fallback: T): T {
    return vscode.workspace
      .getConfiguration("researchCopilot", this.root?.uri)
      .get<T>(name, fallback);
  }
  private python() {
    const configured = this.setting("pythonPath", "python3");
    const dev = path.join(
      this.extension.extensionPath,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    return configured === "python3" && existsSync(dev) ? dev : configured;
  }
  async run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = message;
      this.publish();
      this.output.appendLine(message);
      if (!/cancelled|aborted/i.test(message))
        void vscode.window.showWarningMessage(`Research Copilot: ${message}`);
    }
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extension.extensionUri, "media"),
      ],
    };
    view.webview.html = sidebarHtml(view.webview, this.extension.extensionUri);
    const listener = view.webview.onDidReceiveMessage(
      (m) => void this.run(() => this.message(m)),
    );
    view.onDidDispose(() => {
      listener.dispose();
      if (this.view === view) this.view = undefined;
    });
    this.publish();
  }
  private async message(m: any) {
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "ready":
        if (Object.hasOwn(catalogKinds, m.tab)) this.catalogTab = m.tab;
        await this.ensureIndex();
        this.publish();
        break;
      case "mode":
        await this.setMode(validateMode(m.mode));
        break;
      case "suggest":
        await this.suggest(undefined, { focusInline: true });
        break;
      case "showGhost":
        await this.showGhost(true);
        break;
      case "cancel":
        this.cancel();
        break;
      case "refresh":
        await this.refresh();
        break;
      case "setup":
        await this.setup();
        break;
      case "settings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:research-copilot.research-copilot researchCopilot.backend",
        );
        break;
      case "chat":
        if (
          typeof m.question === "string" &&
          m.question.trim() &&
          m.question.length <= 8000
        )
          await this.suggest(m.question);
        break;
      case "catalog":
        if (Object.hasOwn(catalogKinds, m.tab)) {
          this.catalogTab = m.tab;
          await this.loadCatalog();
        }
        break;
      case "search":
        if (typeof m.query === "string" && m.query.length <= 1000)
          await this.loadCatalog(m.query);
        break;
      case "open":
        if (typeof m.id === "string") await this.openArtifact(m.id);
        break;
      case "reference":
        await this.referenceAction(m.token, m.id, m.lock);
        break;
      case "unlockReference":
        this.selectedSource = undefined;
        this.publish();
        break;
      case "showCard":
        await this.showCard();
        break;
      case "grokApiKey":
        await this.apiKey("grok");
        break;
      case "clearCache":
        this.clearCache();
        break;
      case "cite":
        if (typeof m.id === "string") await this.insertCitation(m.id);
        break;
      case "pin":
      case "exclude":
        if (typeof m.id === "string") await this.updateControl(m.type, m.id);
        break;
      case "inspect":
        await this.inspect();
        break;
      case "reviewEdit":
        await this.reviewEdit();
        break;
      case "relation":
        await this.confirmRelation();
        break;
      case "sectionMemory":
        await this.sectionMemory();
        break;
    }
  }
  private publish() {
    this.statusbar.text = `$(beaker) Research AI: ${MODES[this.mode].label}${this.busy ? " $(sync~spin)" : ""}`;
    this.statusbar.tooltip = `${MODES[this.mode].description}\n${this.status}`;
    void vscode.commands.executeCommand(
      "setContext",
      "researchCopilot.busy",
      this.busy,
    );
    void this.view?.webview.postMessage({
      type: "state",
      state: {
        mode: this.mode,
        status: this.status,
        busy: this.busy,
        project: this.root?.name,
        artifactCount: this.report?.count,
        indexWarnings: this.report?.warnings,
        result: this.result,
        sources: this.sources,
        cardToken: this.cardToken,
        selectedSource: this.selectedSource,
        sourceFocus: this.sourceFocus,
        guideReferences: suggestedReferences(this.sources),
        timing: this.timing,
        cachedCompletions: this.writeCache.size,
        context: this.contextPacket,
        pins: this.projectState.pins,
        excluded: this.projectState.excluded,
        relations: this.relations,
        history: this.history,
        catalog: this.catalog,
        catalogTruncated: this.catalog.length >= 100,
        ephemeralOutline:
          this.catalogTab === "Outline" &&
          this.catalog.every((a) => a.metadata.ephemeral),
        provider: this.providerState(),
        usage: { last: this.usageLast, session: this.usageSession },
      },
    });
  }
  private invalidate(clearResult = true) {
    this.epoch++;
    this.abort?.abort();
    this.ghost = undefined;
    this.hover.clear();
    this.cardToken = undefined;
    this.sources = [];
    if (!this.selectedSource?.locked) this.selectedSource = undefined;
    this.diagnostics.clear();
    if (clearResult) {
      if (this.result)
        this.status = "Context changed. Request a fresh suggestion.";
      this.result = undefined;
    }
    clearTimeout(this.triggerTimer);
    this.publish();
  }
  private scheduleAutomatic() {
    clearTimeout(this.triggerTimer);
    if (!this.editor || !this.setting("automaticSuggestions", false)) return;
    const prefix = this.editor.document
      .getText()
      .slice(0, this.editor.document.offsetAt(this.editor.selection.active));
    if (shouldTrigger(this.mode, "automatic", prefix, true))
      this.triggerTimer = setTimeout(
        () => void this.run(() => this.suggest(undefined, { automatic: true })),
        this.setting("debounceMs", 1800),
      );
  }
  private selectionKey(editor: vscode.TextEditor) {
    const s = editor.selection;
    return `${editor.document.uri}:${s.active.line}:${s.active.character}:${s.anchor.line}:${s.anchor.character}`;
  }
  cancel() {
    this.invalidate();
    this.status = "Suggestion cancelled. Your manuscript is unchanged.";
    this.publish();
  }
  private resetIndex() {
    this.writeCache.clear();
    this.selectedSource = undefined;
    clearTimeout(this.watchTimer);
    this.pendingFiles.clear();
    this.watcher?.dispose();
    this.index?.dispose();
    this.index = undefined;
    this.indexReady = undefined;
    this.root = undefined;
    this.report = undefined;
    this.catalog = [];
    this.projectState = emptyState();
    this.history = [];
    this.relations = [];
    this.contextPacket = undefined;
    this.lastRequest = undefined;
    this.reviewed = undefined;
  }
  async ensureIndex(): Promise<void> {
    if (!vscode.workspace.isTrusted)
      throw new Error("Trust this workspace before launching local helpers.");
    const folder = this.editor
      ? vscode.workspace.getWorkspaceFolder(this.editor.document.uri)
      : undefined;
    const root = folder ?? vscode.workspace.workspaceFolders?.[0];
    if (!root || root.uri.scheme !== "file")
      throw new Error("Open a local research folder in VS Code.");
    if (this.root?.uri.toString() === root.uri.toString() && this.indexReady)
      return this.indexReady;
    this.resetIndex();
    this.root = root;
    this.codex?.dispose();
    this.codex = undefined;
    this.status = "Indexing local project files…";
    this.publish();
    const index = new ProjectIndex(
      this.python(),
      this.extension.extensionPath,
      root.uri.fsPath,
      (line) => this.output.appendLine(line),
    );
    this.index = index;
    this.indexReady = (async () => {
      const report = await index.scan();
      const state = await index.state();
      if (this.index !== index) return;
      this.report = report;
      this.projectState = state;
      this.status = `Local index ready · ${this.report.count} artifacts. No model call made.`;
      if (!this.report.capabilities.pdf)
        this.report.warnings.push(
          "PDF extraction is unavailable. Install requirements.txt into the configured Python environment.",
        );
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, "**/*"),
      );
      const changed = (uri: vscode.Uri) => {
        const relative = path
          .relative(root.uri.fsPath, uri.fsPath)
          .split(path.sep)
          .join("/");
        const configChange =
          relative === ".research-copilot/project.yaml" ||
          relative.endsWith(".gitignore");
        if (
          !configChange &&
          (relative
            .split("/")
            .some((p) =>
              [
                ".git",
                ".research-copilot",
                "node_modules",
                ".venv",
                "__pycache__",
              ].includes(p),
            ) ||
            !/\.(tex|txt|bib|md|pdf|py|ipynb|csv|json|ya?ml|png|svg)$/.test(
              relative,
            ))
        )
          return;
        this.invalidateSource(uri, configChange);
        this.writeCache.clear();
        this.invalidate();
        this.pendingFiles.add(configChange ? "*" : uri.fsPath);
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(
          () =>
            void this.run(async () => {
              const paths = [...this.pendingFiles];
              this.pendingFiles.clear();
              this.report = await index.scan(
                paths.includes("*") ? undefined : paths,
              );
              await this.loadCatalog();
              this.status = "Local research index updated.";
              this.publish();
            }),
          400,
        );
      };
      this.watcher.onDidCreate(changed);
      this.watcher.onDidChange(changed);
      this.watcher.onDidDelete(changed);
      await this.loadCatalog();
      this.publish();
    })().catch((error) => {
      if (this.index === index) {
        this.indexReady = undefined;
        this.index = undefined;
      }
      index.dispose();
      throw error;
    });
    return this.indexReady;
  }
  private async loadCatalog(query = "") {
    if (!this.index) return;
    this.catalog = await this.index.search(
      query,
      catalogKinds[this.catalogTab],
      100,
    );
    this.publish();
    this.relations = await this.index.graph();
    this.publish();
  }
  async refresh() {
    await this.ensureIndex();
    this.invalidate();
    this.selectedSource = undefined;
    this.status = "Refreshing local index…";
    this.publish();
    this.report = await this.index!.scan();
    this.projectState = await this.index!.state();
    await this.loadCatalog();
    this.status = `Index refreshed · ${this.report.count} artifacts.`;
    this.publish();
  }
  async setMode(mode?: Mode) {
    if (!mode) {
      const item = await vscode.window.showQuickPick(
        Object.entries(MODES).map(([id, m]) => ({
          label: m.label,
          description: m.description,
          id: id as Mode,
        })),
        { title: "Choose how Research Copilot helps" },
      );
      if (!item) return;
      mode = item.id;
    }
    mode = validateMode(mode);
    this.invalidate();
    this.reviewed = undefined;
    this.mode = mode;
    await this.extension.workspaceState.update("mode", mode);
    this.status = MODES[mode].description;
    this.publish();
  }
  private backendKind(mode: ContextPacket["mode"] | "off") {
    return providerForMode(
      mode,
      this.setting<ProviderKind>("backend", "grok"),
      this.setting<WriteProvider>("writeBackend", "same"),
    );
  }
  private providerState() {
    const main = this.setting<ProviderKind>("backend", "grok"),
      write = this.setting<WriteProvider>("writeBackend", "same");
    return { main, write, active: this.backendKind(this.mode) };
  }
  private modelFor(kind: ProviderKind, mode: ContextPacket["mode"]) {
    if (kind === "codex") return this.setting("model", "");
    return kind === "grok" && mode === "write"
      ? this.setting("grokWriteModel", "grok-4.3")
      : this.setting(`${kind}Model`, kind === "grok" ? "grok-4.6" : "");
  }
  private getCodex() {
    if (!this.root) throw new Error("No project open");
    const configured = this.setting("codexPath", "codex");
    const devCli = path.join(
      this.extension.extensionPath,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    const localDevCli = configured === "codex" && existsSync(devCli);
    return (this.codex ??= new CodexBackend({
      executable: localDevCli ? process.execPath : configured,
      ...(localDevCli
        ? { args: [devCli, "app-server", "--listen", "stdio://"] }
        : {}),
      cwd: this.root.uri.fsPath,
      model: this.setting("model", ""),
      log: (text) => this.output.appendLine(text),
    }));
  }
  private async getBackend(
    mode: ContextPacket["mode"],
  ): Promise<ResearchModelBackend> {
    const kind = this.backendKind(mode);
    if (kind === "codex") return this.getCodex();
    if (kind !== "local" && kind !== "openai" && kind !== "grok")
      throw new Error("Unknown backend in settings");
    const model = this.modelFor(kind, mode);
    return new HttpBackend({
      kind,
      model,
      endpoint: this.setting("localEndpoint", "http://127.0.0.1:11434/v1"),
      apiKey:
        kind !== "local"
          ? await this.extension.secrets.get(`${kind}-api-key`)
          : undefined,
      cacheSession: `${this.providerSession}-${mode}`,
    });
  }
  private async assemble(
    mode: ContextPacket["mode"],
    editor: vscode.TextEditor,
    question?: string,
  ): Promise<ContextPacket> {
    const index = this.index!,
      root = this.root!.uri.fsPath;
    const text = editor.document.getText();
    const file = path
      .relative(root, editor.document.uri.fsPath)
      .split(path.sep)
      .join("/");
    const offset = editor.document.offsetAt(editor.selection.active);
    const cursor = cursorContext(text, offset, parseManuscript(file, text));
    const query = `${cursor.headings.map((h) => h.title).join(" ")} ${cursor.paragraph.slice(-1200)} ${question ?? ""}`;
    const kinds: ArtifactKind[] =
      mode === "structure"
        ? ["outline", "tex", "figure", "table"]
        : mode === "visual"
          ? ["result", "figure", "table", "code", "tex", "outline"]
          : mode === "evidence"
            ? ["pdf", "result", "bib", "figure", "tex"]
            : ["outline", "tex", "result", "bib", "pdf", "figure", "code"];
    const artifacts: Artifact[] = [];
    for (const kind of kinds) {
      let matches = await index.search(query, [kind], 8);
      if (!matches.length) matches = await index.search("", [kind], 3);
      artifacts.push(...matches);
    }
    const section = cursor.headings.at(-1)?.id ?? `tex:${file}`;
    const memory = this.projectState.sections[section];
    artifacts.push(
      ...(await index.resolve([
        ...this.projectState.pins,
        ...(memory?.evidence ?? []),
      ])),
    );
    const citations = parseManuscript(file, cursor.paragraph).citations.map(
      (c) => `bib:${c.key}`,
    );
    artifacts.push(...(await index.resolve(citations)));
    // Confirmed relationships bring their current linked artifacts into retrieval.
    const related = new Set(artifacts.map((a) => a.id));
    const graph = await index.graph();
    const linked = graph
      .filter(
        (r) => r.confirmed && (related.has(r.source) || related.has(r.target)),
      )
      .flatMap((r) => [r.source, r.target]);
    artifacts.push(...(await index.resolve(linked)));
    const texFiles = new Map<string, string>();
    const manuscripts = await index.search("", ["tex"], 100);
    for (const a of manuscripts.filter((a) => !a.id.includes("#"))) {
      const uri = await this.safeUri(a.path);
      const open = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString(),
      );
      texFiles.set(
        a.path,
        open?.getText() ?? (await fs.readFile(uri.fsPath, "utf8")),
      );
    }
    texFiles.set(file, text);
    const plainText = path.extname(file).toLowerCase() === ".txt";
    const rootFile = plainText
      ? file
      : (this.report?.config.paper?.root ??
        [...texFiles].find(([, source]) =>
          /\\documentclass(?:\[[^\]]*\])?\{/.test(source),
        )?.[0] ??
        file);
    const structure = plainText
      ? { paths: [file], warnings: [] }
      : resolveIncludes(rootFile, texFiles);
    // Replace on-disk manuscript objects with unsaved buffer content at request time.
    const dirtySources = new Set(
      vscode.workspace.textDocuments
        .filter((d) => d.isDirty && d.uri.scheme === "file" && !isManuscript(d))
        .map((d) =>
          path.relative(root, d.uri.fsPath).split(path.sep).join("/"),
        ),
    );
    const currentArtifacts = artifacts
      .filter((a) => !dirtySources.has(a.path))
      .flatMap((a) => {
        if (!texFiles.has(a.path)) return [a];
        const live = refreshManuscriptArtifact(a, texFiles.get(a.path)!);
        return live ? [live] : [];
      });
    const packet = assembleContext({
      mode,
      path: file,
      text,
      offset,
      artifacts: currentArtifacts,
      pins: this.projectState.pins,
      excluded: this.projectState.excluded,
      budget: this.setting("contextBudget", 24000),
      sectionMemory: memory,
    });
    if (dirtySources.size)
      packet.warnings.push(
        "Sources with unsaved changes were omitted. Save source files to refresh their evidence.",
      );
    const warning = structure.warnings.join("; ").slice(0, 500);
    if (
      warning &&
      JSON.stringify(packet).length + warning.length + 50 <=
        this.setting("contextBudget", 24000)
    )
      packet.warnings.push(warning);
    return packet;
  }
  async suggest(question?: string, options: SuggestOptions = {}) {
    const automatic = options.automatic ?? false,
      triggerInline = options.triggerInline ?? true,
      regenerate = options.regenerate ?? (!automatic && triggerInline),
      focusInline = options.focusInline ?? false;
    const mode = question ? "chat" : this.mode;
    if (this.suggestionTask) {
      if (this.pendingMode === mode) await this.suggestionTask;
      return;
    }
    const task = (async () => {
      if (
        !question &&
        mode === "write" &&
        !regenerate &&
        (await this.reuseWrite())
      )
        return;
      await this.generateSuggestion(
        question,
        automatic,
        triggerInline,
        focusInline,
      );
    })();
    this.suggestionTask = task;
    this.pendingMode = mode;
    try {
      await task;
    } finally {
      if (this.suggestionTask === task) {
        this.suggestionTask = undefined;
        this.pendingMode = undefined;
      }
    }
  }
  private async generateSuggestion(
    question?: string,
    automatic = false,
    triggerInline = true,
    focusInline = false,
  ) {
    if (
      !question &&
      !shouldTrigger(
        this.mode,
        automatic ? "automatic" : "explicit",
        this.editor?.document
          .getText()
          .slice(
            0,
            this.editor.document.offsetAt(this.editor.selection.active),
          ) ?? "",
        this.setting("automaticSuggestions", false),
      )
    )
      return;
    if (this.busy) return;
    await this.ensureIndex();
    if (this.busy) return;
    const editor = this.editor;
    if (!editor || !isManuscript(editor.document) || editor.document.isClosed)
      throw new Error(
        "Open a .tex or .txt manuscript and place the cursor where you want help.",
      );
    if (
      editor.document.uri.scheme !== "file" ||
      vscode.workspace
        .getWorkspaceFolder(editor.document.uri)
        ?.uri.toString() !== this.root?.uri.toString()
    )
      throw new Error(
        "The manuscript must belong to the selected local project.",
      );
    const mode = question ? "chat" : this.mode;
    if (mode === "off") return;
    const backendKind = this.backendKind(mode);
    if (backendKind !== "local") {
      const key = `${this.root!.uri}:${backendKind}`;
      if (!this.cloudConsent.has(key)) {
        if (automatic) {
          this.status =
            "Make one explicit request to authorize sending selected context to the cloud backend.";
          this.publish();
          return;
        }
        const label =
          backendKind === "codex"
            ? "Codex / ChatGPT"
            : backendKind === "grok"
              ? "Grok / xAI API (separate billing)"
              : "OpenAI API (separate billing)";
        if (
          (await vscode.window.showInformationMessage(
            `Send selected manuscript excerpts and retrieved project evidence to ${label}? Your files stay local. Request contents are inspectable afterward.`,
            { modal: true },
            "Send selected context",
          )) !== "Send selected context"
        )
          return;
        this.cloudConsent.add(key);
      }
    }
    // A second request or an editor change may happen while consent is open.
    if (
      this.busy ||
      this.editor !== editor ||
      (!question && this.mode !== mode)
    )
      return;
    this.invalidate();
    this.reviewed = undefined;
    const epoch = this.epoch,
      version = editor.document.version,
      offset = editor.document.offsetAt(editor.selection.active);
    const started = performance.now();
    const source = editor.document.getText();
    const snapshot = {
      scope: this.cacheScope(),
      uri: editor.document.uri.toString(),
      before: source.slice(0, offset),
      after: source.slice(offset),
    };
    const abort = new AbortController();
    this.abort = abort;
    this.busy = true;
    this.status = "Selecting project context…";
    this.publish();
    try {
      const packet = await this.assemble(mode, editor, question);
      if (epoch !== this.epoch || abort.signal.aborted) return;
      const prompt = buildPrompt(
        packet,
        question,
        question ? this.history : [],
      );
      this.contextPacket = packet;
      this.lastRequest = {
        prompt,
        context: packet,
        timestamp: new Date().toISOString(),
        backend: backendKind,
      };
      const backend = await this.getBackend(mode);
      if (question) this.history.push({ role: "user", text: question });
      for await (const event of backend.suggest({
        context: packet,
        prompt,
        signal: abort.signal,
      })) {
        if (
          epoch !== this.epoch ||
          editor.document.version !== version ||
          abort.signal.aborted
        )
          return;
        if (event.type === "status") {
          this.status = event.text;
          this.publish();
          continue;
        }
        if (event.usage) {
          this.usageLast = summarizeUsage(
            backendKind,
            this.modelFor(backendKind, mode),
            event.usage,
          );
          this.usageSession = addSessionUsage(
            this.usageSession,
            this.usageLast,
          );
          this.lastRequest.usage = this.usageLast;
        }
        this.lastRequest.response = event.value;
        const suggestion = validateSuggestion(event.value, mode);
        const sourceIds = packet.artifacts
          .filter((a) => a.kind !== "tex")
          .map((a) => a.id);
        const current = await this.index!.resolve(sourceIds);
        // Validate against the source hashes that were actually sent, not a new dataset.
        const sentHashes = new Map(packet.artifacts.map((a) => [a.id, a.hash]));
        const unchanged = current.filter(
          (a) => sentHashes.get(a.id) === a.hash,
        );
        unchanged.push(...packet.artifacts.filter((a) => a.kind === "tex"));
        if (
          epoch !== this.epoch ||
          editor.document.version !== version ||
          abort.signal.aborted
        )
          return;
        this.result = resolveSuggestion(suggestion, unchanged);
        this.sources = sourceCards(this.result, unchanged);
        this.cardToken = mode === "write" ? undefined : randomUUID();
        if (mode === "guide")
          this.hover.set(editor, this.result, this.sources, this.cardToken!);
        this.lastRequest.resolved = this.result;
        if (question)
          this.history.push({ role: "assistant", text: suggestion.text });
        this.history = this.history.slice(-20);
        if (this.result.insertable)
          this.ghost = {
            uri: editor.document.uri.toString(),
            version,
            offset,
            text: suggestion.insert_text,
          };
        if (
          mode === "write" &&
          this.result.insertable &&
          this.setting("cacheSuggestions", true)
        )
          this.writeCache.put(snapshot, suggestion.insert_text, {
            context: packet,
            prompt,
            response: event.value,
            suggestion,
            backend: backendKind,
          });
        this.timing = {
          source: "model",
          totalMs: Math.round(performance.now() - started),
          ...(event.usage
            ? {
                cachedInputTokens: event.usage.cachedInputTokens,
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
              }
            : {}),
        };
        if (this.setting("diagnostics", true) && this.result.warnings.length) {
          const current = cursorContext(
            editor.document.getText(),
            offset,
            parseManuscript(packet.current.path, editor.document.getText()),
          );
          this.diagnostics.set(
            editor.document.uri,
            this.result.warnings.map(
              (w) =>
                new vscode.Diagnostic(
                  new vscode.Range(
                    editor.document.positionAt(current.start),
                    editor.document.positionAt(current.end),
                  ),
                  w,
                  vscode.DiagnosticSeverity.Warning,
                ),
            ),
          );
        }
        this.status = this.result.warnings.length
          ? "Suggestion ready. Review the evidence warnings."
          : "Suggestion ready. Your manuscript is unchanged.";
        if (this.setting("logRequests", false)) await this.logRequest();
      }
    } finally {
      if (this.abort === abort) {
        this.abort = undefined;
        this.busy = false;
        this.publish();
      }
    }
    if (this.ghost && triggerInline) await this.showGhost(focusInline);
    if (mode === "guide" && this.cardToken && !automatic)
      await this.hover.show();
  }
  async showGhost(focusEditor = true) {
    let editor = this.editor;
    const ghost = this.ghost;
    if (
      this.mode !== "write" ||
      !editor ||
      !ghost ||
      ghost.uri !== editor.document.uri.toString() ||
      ghost.version !== editor.document.version ||
      ghost.offset !== editor.document.offsetAt(editor.selection.active)
    ) {
      this.status =
        "No current ghost text. Place the cursor in the manuscript and request a WRITE continuation.";
      this.publish();
      return;
    }
    if (focusEditor)
      editor = await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
      });
    if (
      vscode.window.activeTextEditor?.document.uri.toString() !== ghost.uri ||
      !editor ||
      editor.document.version !== ghost.version ||
      editor.document.offsetAt(editor.selection.active) !== ghost.offset
    ) {
      this.status =
        "The suggestion belongs to another editor position. Return there or request a fresh WRITE continuation.";
      this.publish();
      return;
    }
    this.editor = editor;
    this.cursorKey = this.selectionKey(editor);
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    if (focusEditor) {
      this.status =
        "Ghost text shown in the editor. Tab accepts; Esc dismisses.";
      this.publish();
    }
  }
  private cacheScope() {
    const kind = this.backendKind("write");
    const model =
      kind === "grok"
        ? this.setting("grokWriteModel", "grok-4.3")
        : this.setting(kind === "codex" ? "model" : `${kind}Model`, "");
    return `${this.root?.uri}:${kind}:${model}:${this.setting("contextBudget", 24000)}`;
  }
  private async reuseWrite(
    document?: vscode.TextDocument,
    position?: vscode.Position,
  ) {
    if (
      !this.setting("cacheSuggestions", true) ||
      !this.editor ||
      !this.index ||
      !this.root ||
      this.mode !== "write"
    )
      return false;
    const started = performance.now(),
      editor = this.editor,
      at = position ?? editor.selection.active;
    if (
      document &&
      (document !== editor.document ||
        document.offsetAt(at) !==
          editor.document.offsetAt(editor.selection.active))
    )
      return false;
    const offset = editor.document.offsetAt(at),
      source = editor.document.getText();
    const hit = this.writeCache.find({
      scope: this.cacheScope(),
      uri: editor.document.uri.toString(),
      before: source.slice(0, offset),
      after: source.slice(offset),
    });
    if (!hit) return false;
    const epoch = this.epoch,
      version = editor.document.version;
    const activePath = path
      .relative(this.root.uri.fsPath, editor.document.uri.fsPath)
      .split(path.sep)
      .join("/");
    const sourceIds = hit.data.context.artifacts
      .filter((a) => a.kind !== "tex")
      .map((a) => a.id);
    const dirtyPaths = new Set(
      vscode.workspace.textDocuments
        .filter((d) => d.isDirty && d.uri.scheme === "file")
        .map((d) => path.resolve(d.uri.fsPath)),
    );
    if (
      hit.data.context.artifacts.some(
        (a) =>
          a.path !== activePath &&
          dirtyPaths.has(path.resolve(this.root!.uri.fsPath, a.path)),
      )
    ) {
      this.writeCache.clear();
      return false;
    }
    const current = await this.index.resolve(sourceIds);
    const hashes = new Map(
      hit.data.context.artifacts.map((a) => [a.id, a.hash]),
    );
    const activeArtifactIds = new Set(
      hit.data.context.artifacts
        .filter((a) => a.path === activePath)
        .map((a) => a.id),
    );
    if (
      hit.consumed > 0 &&
      (hit.data.suggestion.evidence_ids.some((id) =>
        activeArtifactIds.has(id),
      ) ||
        hit.data.suggestion.outline_ids.some((id) =>
          activeArtifactIds.has(id),
        ) ||
        hit.data.suggestion.claims.some((claim) =>
          activeArtifactIds.has(claim.artifact_id),
        ))
    ) {
      return false;
    }
    const unchanged = current.filter((a) => hashes.get(a.id) === a.hash);
    unchanged.push(
      ...hit.data.context.artifacts.filter((a) => a.kind === "tex"),
    );
    if (
      epoch !== this.epoch ||
      version !== editor.document.version ||
      unchanged.length !== hit.data.context.artifacts.length
    ) {
      this.writeCache.clear();
      return false;
    }
    const resolved = resolveSuggestion(hit.data.suggestion, unchanged);
    if (!resolved.insertable) {
      this.writeCache.clear();
      return false;
    }
    this.result = {
      ...resolved,
      suggestion: { ...resolved.suggestion, insert_text: hit.remaining },
    };
    this.sources = sourceCards(this.result, unchanged);
    this.contextPacket = hit.data.context;
    this.lastRequest = {
      prompt: hit.data.prompt,
      context: hit.data.context,
      response: hit.data.response,
      resolved: this.result,
      timestamp: new Date().toISOString(),
      backend: hit.data.backend,
      cache: { hit: true, consumed: hit.consumed, ageMs: hit.ageMs },
    };
    this.ghost = {
      uri: editor.document.uri.toString(),
      version,
      offset,
      text: hit.remaining,
    };
    this.timing = {
      source: "cache",
      totalMs: Math.max(0, Math.round(performance.now() - started)),
    };
    this.status = `Cached WRITE continuation ready · ${hit.remaining.length} characters · no model call.`;
    this.publish();
    return true;
  }
  clearCache() {
    this.writeCache.clear();
    this.invalidate();
    this.timing = undefined;
    this.status = "Suggestion cache cleared. Your manuscript is unchanged.";
    this.publish();
  }
  async showCard() {
    if (this.mode !== "guide" || !this.cardToken) {
      this.status =
        "Choose GUIDE and request a suggestion to show an editor card.";
      this.publish();
      return;
    }
    await this.hover.show();
  }
  private invalidateSource(uri: vscode.Uri, all = false) {
    if (!this.selectedSource || !this.root) return;
    const relative = path
      .relative(this.root.uri.fsPath, uri.fsPath)
      .split(path.sep)
      .join("/");
    if (
      all ||
      relative === this.selectedSource.artifact.path ||
      relative.endsWith(".bib")
    )
      this.selectedSource = undefined;
  }
  async referenceAction(token: unknown, id: unknown, lock: unknown) {
    if (
      typeof token !== "string" ||
      token !== this.cardToken ||
      typeof id !== "string" ||
      typeof lock !== "boolean"
    )
      return;
    const selected = this.sources.find((s) => s.artifact.id === id);
    if (!selected || !this.index) return;
    const epoch = this.epoch;
    const current = await this.index.get(id);
    if (epoch !== this.epoch || token !== this.cardToken) return;
    if (!current || current.hash !== selected.artifact.hash) {
      this.selectedSource = undefined;
      this.invalidate();
      return;
    }
    const uri = await this.safeUri(current.path);
    if (
      epoch !== this.epoch ||
      vscode.workspace.textDocuments.some(
        (d) => d.uri.toString() === uri.toString() && d.isDirty,
      )
    )
      return;
    this.selectedSource = { ...selected, locked: lock };
    this.sourceFocus++;
    await vscode.commands.executeCommand("researchCopilot.sidebar.focus");
    this.publish();
  }
  private async safeUri(relative: string) {
    if (!this.root) throw new Error("No local workspace");
    safeRelative(relative);
    const base = await fs.realpath(this.root.uri.fsPath),
      candidate = await fs.realpath(path.join(base, relative));
    const diff = path.relative(base, candidate);
    if (
      diff.startsWith(".." + path.sep) ||
      diff === ".." ||
      path.isAbsolute(diff)
    )
      throw new Error("Source resolves outside this workspace");
    // Validate the canonical path, but keep VS Code's workspace URI identity.
    // On macOS /var aliases /private/var; returning the realpath opens a second
    // buffer and can bypass unsaved changes in the original manuscript.
    return vscode.Uri.joinPath(this.root.uri, relative);
  }
  private async openArtifact(id: string) {
    await this.ensureIndex();
    const a = await this.index!.get(id);
    if (!a)
      throw new Error(
        "Artifact is missing or stale. Refresh the project index.",
      );
    if (a.path.endsWith(".pdf")) {
      await showPdf(this.index!, id, this.extension.extensionUri);
      return;
    }
    const uri = await this.safeUri(a.path);
    if (/\.(png|svg)$/i.test(a.path)) {
      await vscode.commands.executeCommand(
        "vscode.open",
        uri,
        vscode.ViewColumn.Beside,
      );
      return;
    }
    const editor = await vscode.window.showTextDocument(uri, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    });
    const position =
      a.locator.start !== undefined
        ? editor.document.positionAt(a.locator.start)
        : new vscode.Position(Math.max(0, (a.locator.line ?? 1) - 1), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenter,
    );
  }
  private async insertCitation(id: string) {
    const a = await this.index?.get(id),
      editor = this.editor;
    if (
      !a ||
      a.kind !== "bib" ||
      typeof a.metadata.key !== "string" ||
      !/^[^\s{}\\,]+$/.test(a.metadata.key)
    )
      throw new Error("Citation requires a current bibliography entry");
    if (!editor || editor.document.isClosed || !isManuscript(editor.document))
      throw new Error("Open a manuscript to insert this citation");
    const key = a.metadata.key;
    await editor.edit((edit) =>
      edit.insert(
        editor.selection.active,
        citationText(editor.document.fileName, key),
      ),
    );
  }
  private async updateControl(action: "pin" | "exclude", id: string) {
    await this.ensureIndex();
    this.invalidate();
    this.writeCache.clear();
    if (
      action === "exclude" &&
      (this.selectedSource?.artifact.id === id ||
        this.selectedSource?.artifact.path === id)
    )
      this.selectedSource = undefined;
    this.projectState = await this.index!.update(action, { id });
    this.status = "Context controls saved locally.";
    this.publish();
  }
  async pin() {
    await this.ensureIndex();
    const query = await vscode.window.showInputBox({
      title: "Find an artifact to pin",
      prompt: "Search a filename, citation key, function, or result",
    });
    if (query === undefined) return;
    const artifacts = await this.index!.search(query, undefined, 100);
    const choice = await vscode.window.showQuickPick(
      artifacts.map((a) => ({ label: a.title, description: a.id, id: a.id })),
      { title: "Pin or unpin context" },
    );
    if (choice) await this.updateControl("pin", choice.id);
  }
  async confirmRelation() {
    await this.ensureIndex();
    const artifacts = await this.index!.search("", undefined, 100);
    const options = artifacts.map((a) => ({
      label: a.title,
      description: a.id,
      id: a.id,
    }));
    const source = await vscode.window.showQuickPick(options, {
      title: "Choose the source artifact",
    });
    if (!source) return;
    const target = await vscode.window.showQuickPick(
      options.filter((a) => a.id !== source.id),
      { title: "Choose the related artifact" },
    );
    if (!target) return;
    const relation = await vscode.window.showQuickPick(
      ["supports", "generates", "reads", "illustrates", "cites"],
      { title: "Confirm the relationship" },
    );
    if (!relation) return;
    this.projectState = await this.index!.update("relation", {
      source: source.id,
      target: target.id,
      relation,
    });
    this.relations = await this.index!.graph();
    this.invalidate();
    this.status = "Confirmed relationship saved.";
    this.publish();
  }
  async sectionMemory() {
    await this.ensureIndex();
    if (!this.editor)
      throw new Error("Place the cursor in a manuscript section");
    const file = path
      .relative(this.root!.uri.fsPath, this.editor.document.fileName)
      .split(path.sep)
      .join("/");
    const current = cursorContext(
      this.editor.document.getText(),
      this.editor.document.offsetAt(this.editor.selection.active),
      parseManuscript(file, this.editor.document.getText()),
    );
    const id = current.headings.at(-1)?.id ?? `tex:${file}`;
    const summary = await vscode.window.showInputBox({
      title: "What should this section establish?",
      value: this.projectState.sections[id]?.summary ?? "",
      validateInput: (value) =>
        value.length > 2000
          ? "Keep the goal under 2,000 characters."
          : undefined,
    });
    if (summary !== undefined) {
      this.projectState = await this.index!.update("section", {
        id,
        summary,
        evidence: this.projectState.pins,
      });
      this.invalidate();
      this.publish();
    }
  }
  async signIn() {
    await this.ensureIndex();
    const result = await this.getCodex().login();
    if (result.authUrl) {
      const url = vscode.Uri.parse(result.authUrl);
      if (url.scheme !== "https")
        throw new Error("Codex returned an unexpected authentication URL");
      await vscode.env.openExternal(url);
      this.status =
        "Finish ChatGPT sign-in in your browser, then request a suggestion.";
    } else
      this.status =
        "Codex sign-in started. Check the Codex authentication status.";
    this.publish();
  }
  async selectModel() {
    await this.ensureIndex();
    const models = await this.getCodex().models();
    const choice = await vscode.window.showQuickPick(
      models.data.map((m) => ({
        label: m.displayName,
        description: m.model,
        id: m.model,
      })),
      { title: "Codex model" },
    );
    if (choice)
      await vscode.workspace
        .getConfiguration("researchCopilot")
        .update("model", choice.id, vscode.ConfigurationTarget.Global);
  }
  async apiKey(kind: "openai" | "grok" = "openai") {
    const key = await vscode.window.showInputBox({
      title: `${kind === "grok" ? "Grok / xAI" : "OpenAI"} API key (separate API billing)`,
      password: true,
      ignoreFocusOut: true,
      prompt:
        "Stored in VS Code SecretStorage. Leave empty to remove the saved key.",
    });
    if (key !== undefined) {
      if (key.trim())
        await this.extension.secrets.store(`${kind}-api-key`, key.trim());
      else await this.extension.secrets.delete(`${kind}-api-key`);
      this.invalidate();
      if (kind === "grok" && key.trim()) {
        const choice = await vscode.window.showQuickPick(
          [
            "Use Grok for all modes",
            "Use Grok for WRITE only",
            "Keep current backend",
          ],
          { title: "Grok key saved securely. Choose where to use it." },
        );
        const config = vscode.workspace.getConfiguration(
          "researchCopilot",
          this.root?.uri,
        );
        if (choice === "Use Grok for all modes") {
          await config.update(
            "backend",
            "grok",
            vscode.ConfigurationTarget.Workspace,
          );
          await config.update(
            "writeBackend",
            "same",
            vscode.ConfigurationTarget.Workspace,
          );
        } else if (choice === "Use Grok for WRITE only")
          await config.update(
            "writeBackend",
            "grok",
            vscode.ConfigurationTarget.Workspace,
          );
      }
    }
  }
  async setup() {
    let problem = "";
    try {
      await this.ensureIndex();
    } catch (error) {
      problem = `Local helper unavailable: ${error instanceof Error ? error.message : String(error)}. Set pythonPath to Python 3.10+ and install requirements.txt. `;
    }
    const choice = await vscode.window.showInformationMessage(
      `${problem}Provider: ${this.backendKind(this.mode)} · Python: ${this.python()} · PDF support: ${this.report?.capabilities.pdf ? "ready" : "missing"} · ${this.report?.count ?? 0} indexed artifacts. Suggestions default to explicit triggers.`,
      "Set Grok API key",
      "Settings",
      "Sign in with ChatGPT",
      "Choose Codex model",
      "Configure project",
    );
    if (choice === "Sign in with ChatGPT") await this.signIn();
    if (choice === "Set Grok API key") await this.apiKey("grok");
    if (choice === "Choose Codex model") await this.selectModel();
    if (choice === "Settings")
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "researchCopilot",
      );
    if (choice === "Configure project") await this.configure();
  }
  async configure() {
    await this.ensureIndex();
    const uri = vscode.Uri.joinPath(
      this.root!.uri,
      ".research-copilot",
      "project.yaml",
    );
    if (!existsSync(uri.fsPath)) {
      await fs.writeFile(
        uri.fsPath,
        "# Optional workspace-relative resource paths and globs. Defaults auto-discover.\n# paper:\n#   root: paper/main.tex\n# outline:\n#   path: outline/outline.md\n# bibliography:\n#   - references/**/*.bib\n# reference_pdfs:\n#   - references/pdfs/**/*.pdf\n# results:\n#   - results/**/*.csv\n#   - results/**/*.json\n# code:\n#   - code/**/*.py\n# figures:\n#   - figures/**/*.{pdf,png,svg}\n# exclude:\n#   - private/**\n",
        { flag: "wx" },
      );
    }
    await vscode.window.showTextDocument(uri);
  }
  async inspect() {
    if (!this.lastRequest)
      throw new Error("No model request has been made yet");
    const text = JSON.stringify(this.lastRequest, null, 2);
    const uri = vscode.Uri.parse(
      `research-copilot-preview:/request-${Date.now()}.json`,
    );
    this.snapshots.set(uri.toString(), text);
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(uri),
      { viewColumn: vscode.ViewColumn.Beside, preview: true },
    );
  }
  private async logRequest() {
    if (!this.root || !this.lastRequest) return;
    const directory = path.join(
      this.root.uri.fsPath,
      ".research-copilot",
      "logs",
    );
    await fs.mkdir(directory, { recursive: true });
    const base = await fs.realpath(this.root.uri.fsPath),
      real = await fs.realpath(directory);
    if (path.relative(base, real).startsWith(".."))
      throw new Error("Log directory resolves outside the workspace");
    await fs.writeFile(
      path.join(real, `${Date.now()}.json`),
      JSON.stringify(this.lastRequest, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  }
  async reviewEdit() {
    const proposal = this.result?.suggestion.edit;
    if (!proposal)
      throw new Error("Ask Chat for a specific manuscript edit first");
    const warnings = this.result!.warnings.length
      ? ` Evidence warnings: ${this.result!.warnings.join(" ")}`
      : "";
    const uri = await this.safeUri(proposal.path);
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = prepareEdit(proposal, document.getText());
    this.reviewed = {
      uri,
      version: document.version,
      hash: edit.hash,
      updated: edit.updated,
      start: edit.start,
      end: edit.end,
      replacement: proposal.replacement,
    };
    const extension = path.extname(proposal.path).toLowerCase();
    const proposedUri = vscode.Uri.parse(
      `research-copilot-preview:/proposed-${Date.now()}${extension}`,
    );
    this.snapshots.set(proposedUri.toString(), edit.updated);
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri,
      proposedUri,
      `Review proposed edit · ${path.basename(proposal.path)}`,
    );
    if (
      (await vscode.window.showWarningMessage(
        `Review the diff before applying this manuscript edit.${warnings} Raw results cannot be changed.`,
        { modal: false },
        "Apply reviewed edit",
        "Reject",
      )) === "Apply reviewed edit"
    )
      await this.applyEdit();
  }
  async applyEdit() {
    const reviewed = this.reviewed;
    if (!reviewed)
      throw new Error("Review the proposed diff before applying it");
    const document = await vscode.workspace.openTextDocument(reviewed.uri);
    if (
      document.version !== reviewed.version ||
      hashText(document.getText()) !== reviewed.hash
    ) {
      this.reviewed = undefined;
      throw new Error(
        "Manuscript changed after review. Regenerate and review a new diff.",
      );
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      reviewed.uri,
      new vscode.Range(
        document.positionAt(reviewed.start),
        document.positionAt(reviewed.end),
      ),
      reviewed.replacement,
    );
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error("VS Code could not apply the reviewed edit");
    this.reviewed = undefined;
    if (this.lastRequest)
      this.lastRequest.applied = {
        path: reviewed.uri.fsPath,
        originalHash: reviewed.hash,
        resultHash: hashText(reviewed.updated),
      };
    if (this.setting("logRequests", false)) await this.logRequest();
    this.status =
      "Reviewed edit applied to the editor. Undo is available; save when ready.";
    this.publish();
  }
  // Read-only diagnostics for extension-host acceptance tests and troubleshooting.
  getState() {
    return {
      mode: this.mode,
      status: this.status,
      report: this.report,
      result: this.result,
      context: this.contextPacket,
      busy: this.busy,
      catalog: this.catalog,
      ghost: this.ghost,
      sources: this.sources,
      cardToken: this.cardToken,
      selectedSource: this.selectedSource,
      guideReferences: suggestedReferences(this.sources),
      timing: this.timing,
      cachedCompletions: this.writeCache.size,
      lastInlineRequest: this.lastInlineRequest,
      provider: this.providerState(),
      usage: { last: this.usageLast, session: this.usageSession },
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort();
    clearTimeout(this.triggerTimer);
    this.resetIndex();
    this.codex?.dispose();
    this.statusbar.dispose();
    this.output.dispose();
    this.diagnostics.dispose();
    this.hover.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

export function activate(context: vscode.ExtensionContext) {
  const controller = new ResearchCopilot(context);
  context.subscriptions.push(
    controller,
    vscode.window.registerWebviewViewProvider(
      "researchCopilot.sidebar",
      controller,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  const commands: Record<string, (...args: any[]) => Promise<unknown> | void> =
    {
      setMode: (mode) => controller.setMode(mode),
      suggest: () => controller.suggest(),
      cancel: () => controller.cancel(),
      signIn: () => controller.signIn(),
      selectModel: () => controller.selectModel(),
      reindex: () => controller.refresh(),
      configure: () => controller.configure(),
      apiKey: () => controller.apiKey(),
      grokApiKey: () => controller.apiKey("grok"),
      clearCache: () => controller.clearCache(),
      showCard: () => controller.showCard(),
      referenceAction: (token, id, lock) =>
        controller.referenceAction(token, id, lock),
      inspectContext: () => controller.inspect(),
      reviewEdit: () => controller.reviewEdit(),
      applyEdit: () => controller.applyEdit(),
      pin: () => controller.pin(),
      confirmRelation: () => controller.confirmRelation(),
      sectionMemory: () => controller.sectionMemory(),
      setup: () => controller.setup(),
    };
  for (const [name, handler] of Object.entries(commands))
    context.subscriptions.push(
      vscode.commands.registerCommand(`researchCopilot.${name}`, (...args) =>
        controller.run(async () => handler(...args)),
      ),
    );
  return {
    getState: () => controller.getState(),
    ready: () => controller.ensureIndex(),
    suggest: (question?: string) => controller.suggest(question),
    complete: () => controller.suggest(undefined, { triggerInline: false }),
    showGhost: () => controller.showGhost(true),
    setMode: (mode: Mode) => controller.setMode(mode),
  };
}
export function deactivate() {}

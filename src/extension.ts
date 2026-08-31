import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import { CodexBackend } from './backends/codex';
import { HttpBackend } from './backends/http';
import { assembleContext, buildPrompt } from './core/context';
import { hashText, prepareEdit, safeRelative } from './core/edits';
import { cursorContext, parseLatex, resolveIncludes } from './core/latex';
import { resolveSuggestion, validateSuggestion } from './core/integrity';
import { MODES, shouldTrigger, validateMode } from './core/modes';
import type { Artifact, ArtifactKind, ContextPacket, Mode, ProjectState, ResearchModelBackend, ResolvedSuggestion } from './core/types';
import { ProjectIndex, type ScanReport } from './indexer';
import { sidebarHtml } from './ui/shell';
import { showPdf } from './ui/pdf';

const isTex = (document: vscode.TextDocument) => document.uri.scheme === 'file' && document.fileName.toLowerCase().endsWith('.tex');
const emptyState = (): ProjectState => ({ pins: [], excluded: [], relations: [], sections: {} });
const catalogKinds: Record<string, ArtifactKind[]> = { Outline: ['outline'], Results: ['result'], References: ['bib', 'pdf'], Figures: ['figure', 'table'] };

export class ResearchCopilot implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private statusbar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  private output = vscode.window.createOutputChannel('Research Copilot');
  private diagnostics = vscode.languages.createDiagnosticCollection('researchCopilot');
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
  private busy = false;
  private status = 'Open a LaTeX project. Suggestions are read-only.';
  private report?: ScanReport;
  private projectState = emptyState();
  private result?: ResolvedSuggestion;
  private contextPacket?: ContextPacket;
  private lastRequest?: { prompt: string; context: ContextPacket; response?: unknown; resolved?: ResolvedSuggestion; timestamp: string; backend: string; applied?: unknown };
  private history: { role: string; text: string }[] = [];
  private catalog: Artifact[] = [];
  private catalogTab = 'Outline';
  private ghost?: { uri: string; version: number; offset: number; text: string };
  private reviewed?: { uri: vscode.Uri; version: number; hash: string; updated: string; start: number; end: number; replacement: string };
  private snapshots = new Map<string, string>();
  private cloudConsent = new Set<string>();
  private disposed = false;

  constructor(private extension: vscode.ExtensionContext) {
    const saved = extension.workspaceState.get<string>('mode', 'guide');
    try { this.mode = validateMode(saved); } catch { this.mode = 'guide'; }
    this.statusbar.command = 'researchCopilot.setMode'; this.statusbar.show();
    this.editor = vscode.window.activeTextEditor && isTex(vscode.window.activeTextEditor.document) ? vscode.window.activeTextEditor : undefined;
    this.disposables.push(vscode.workspace.registerTextDocumentContentProvider('research-copilot-preview', { provideTextDocumentContent: uri => this.snapshots.get(uri.toString()) ?? '' }));
    this.disposables.push(vscode.languages.registerInlineCompletionItemProvider([{ scheme: 'file', language: 'latex' }, { scheme: 'file', language: 'tex' }], {
      provideInlineCompletionItems: async (document, position, context, token) => {
        if (this.mode !== 'write' || !isTex(document)) return [];
        if (!this.ghost && !this.busy && (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke || this.setting('automaticSuggestions', false))) await this.suggest(undefined, false);
        if (token.isCancellationRequested) return [];
        const ghost = this.ghost;
        if (!ghost || ghost.uri !== document.uri.toString() || ghost.version !== document.version || ghost.offset !== document.offsetAt(position)) return [];
        return [new vscode.InlineCompletionItem(ghost.text, new vscode.Range(position, position))];
      },
    }));
    this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && isTex(editor.document)) { this.editor = editor; this.invalidate(); void this.run(() => this.ensureIndex()); }
    }));
    this.disposables.push(vscode.window.onDidChangeTextEditorSelection(e => {
      if (e.textEditor === this.editor) this.invalidate(false);
    }));
    this.disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document === this.editor?.document && e.contentChanges.length) {
        this.invalidate();
        clearTimeout(this.triggerTimer);
        const text = e.document.getText().slice(0, e.document.offsetAt(this.editor.selection.active));
        if (shouldTrigger(this.mode, 'automatic', text, this.setting('automaticSuggestions', false))) this.triggerTimer = setTimeout(() => void this.run(() => this.suggest(undefined, true)), this.setting('debounceMs', 1800));
      }
    }));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('researchCopilot')) { this.invalidate(); this.codex?.dispose(); this.codex = undefined; this.resetIndex(); this.publish(); }
    }));
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { this.invalidate(); this.resetIndex(); }));
    this.publish();
  }
  setting<T>(name: string, fallback: T): T { return vscode.workspace.getConfiguration('researchCopilot', this.root?.uri).get<T>(name, fallback); }
  private python() {
    const configured = this.setting('pythonPath', 'python3');
    const dev = path.join(this.extension.extensionPath, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    return configured === 'python3' && existsSync(dev) ? dev : configured;
  }
  async run(action: () => Promise<unknown>) {
    try { await action(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = message; this.publish(); this.output.appendLine(message);
      if (!/cancelled|aborted/i.test(message)) void vscode.window.showWarningMessage(`Research Copilot: ${message}`);
    }
  }
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extension.extensionUri, 'media')] };
    view.webview.html = sidebarHtml(view.webview, this.extension.extensionUri);
    const listener = view.webview.onDidReceiveMessage(m => void this.run(() => this.message(m)));
    view.onDidDispose(() => { listener.dispose(); if (this.view === view) this.view = undefined; });
    this.publish();
  }
  private async message(m: any) {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'ready': await this.ensureIndex(); this.publish(); break;
      case 'mode': await this.setMode(validateMode(m.mode)); break;
      case 'suggest': await this.suggest(); break;
      case 'cancel': this.cancel(); break;
      case 'refresh': await this.refresh(); break;
      case 'setup': await this.setup(); break;
      case 'chat': if (typeof m.question === 'string' && m.question.trim() && m.question.length <= 8000) await this.suggest(m.question); break;
      case 'catalog': if (Object.hasOwn(catalogKinds, m.tab)) { this.catalogTab = m.tab; await this.loadCatalog(); } break;
      case 'search': if (typeof m.query === 'string' && m.query.length <= 1000) await this.loadCatalog(m.query); break;
      case 'open': if (typeof m.id === 'string') await this.openArtifact(m.id); break;
      case 'cite': if (typeof m.id === 'string') await this.insertCitation(m.id); break;
      case 'pin': case 'exclude': if (typeof m.id === 'string') await this.updateControl(m.type, m.id); break;
      case 'inspect': await this.inspect(); break;
      case 'reviewEdit': await this.reviewEdit(); break;
      case 'relation': await this.confirmRelation(); break;
      case 'sectionMemory': await this.sectionMemory(); break;
    }
  }
  private publish() {
    this.statusbar.text = `$(beaker) Research AI: ${MODES[this.mode].label}${this.busy ? ' $(sync~spin)' : ''}`;
    this.statusbar.tooltip = `${MODES[this.mode].description}\n${this.status}`;
    void vscode.commands.executeCommand('setContext', 'researchCopilot.busy', this.busy);
    void this.view?.webview.postMessage({ type: 'state', state: { mode: this.mode, status: this.status, busy: this.busy, project: this.root?.name, artifactCount: this.report?.count, indexWarnings: this.report?.warnings, result: this.result, context: this.contextPacket, pins: this.projectState.pins, excluded: this.projectState.excluded, history: this.history, catalog: this.catalog, catalogTruncated: this.catalog.length >= 100, ephemeralOutline: this.catalogTab === 'Outline' && this.catalog.every(a => a.metadata.ephemeral) } });
  }
  private invalidate(clearResult = true) {
    this.epoch++; this.abort?.abort(); this.ghost = undefined; this.diagnostics.clear();
    if (clearResult) { this.result = undefined; this.reviewed = undefined; }
    clearTimeout(this.triggerTimer);
    this.publish();
  }
  cancel() { this.invalidate(); this.status = 'Suggestion cancelled. Your manuscript is unchanged.'; this.publish(); }
  private resetIndex() {
    clearTimeout(this.watchTimer); this.pendingFiles.clear(); this.watcher?.dispose(); this.index?.dispose(); this.index = undefined; this.indexReady = undefined; this.root = undefined; this.report = undefined; this.catalog = []; this.projectState = emptyState(); this.history = []; this.contextPacket = undefined;
  }
  async ensureIndex(): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before launching local helpers.');
    const folder = this.editor ? vscode.workspace.getWorkspaceFolder(this.editor.document.uri) : undefined;
    const root = folder ?? vscode.workspace.workspaceFolders?.[0];
    if (!root || root.uri.scheme !== 'file') throw new Error('Open a local research folder in VS Code.');
    if (this.root?.uri.toString() === root.uri.toString() && this.indexReady) return this.indexReady;
    this.resetIndex(); this.root = root; this.codex?.dispose(); this.codex = undefined;
    this.status = 'Indexing local project files…'; this.publish();
    const index = new ProjectIndex(this.python(), this.extension.extensionPath, root.uri.fsPath, line => this.output.appendLine(line));
    this.index = index;
    this.indexReady = (async () => {
      this.report = await index.scan(); this.projectState = await index.state();
      if (this.index !== index) return;
      this.status = `Local index ready · ${this.report.count} artifacts. No model call made.`;
      if (!this.report.capabilities.pdf) this.report.warnings.push('PDF extraction is unavailable. Install requirements.txt into the configured Python environment.');
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
      const changed = (uri: vscode.Uri) => {
        const relative = path.relative(root.uri.fsPath, uri.fsPath).split(path.sep).join('/');
        const configChange = relative === '.research-copilot/project.yaml' || relative.endsWith('.gitignore');
        if (!configChange && (relative.split('/').some(p => ['.git', '.research-copilot', 'node_modules', '.venv', '__pycache__'].includes(p)) || !/\.(tex|bib|md|pdf|py|ipynb|csv|json|ya?ml|png|svg)$/.test(relative))) return;
        this.invalidate(); this.pendingFiles.add(configChange ? '*' : uri.fsPath);
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => void this.run(async () => {
          const paths = [...this.pendingFiles]; this.pendingFiles.clear();
          this.report = await index.scan(paths.includes('*') ? undefined : paths); await this.loadCatalog(); this.status = 'Local research index updated.'; this.publish();
        }), 400);
      };
      this.watcher.onDidCreate(changed); this.watcher.onDidChange(changed); this.watcher.onDidDelete(changed);
      await this.loadCatalog(); this.publish();
    })().catch(error => { if (this.index === index) { this.indexReady = undefined; this.index = undefined; } index.dispose(); throw error; });
    return this.indexReady;
  }
  private async loadCatalog(query = '') {
    if (!this.index) return;
    this.catalog = await this.index.search(query, catalogKinds[this.catalogTab], 100); this.publish();
  }
  async refresh() { await this.ensureIndex(); this.invalidate(); this.status = 'Refreshing local index…'; this.publish(); this.report = await this.index!.scan(); this.projectState = await this.index!.state(); await this.loadCatalog(); this.status = `Index refreshed · ${this.report.count} artifacts.`; this.publish(); }
  async setMode(mode?: Mode) {
    if (!mode) {
      const item = await vscode.window.showQuickPick(Object.entries(MODES).map(([id, m]) => ({ label: m.label, description: m.description, id: id as Mode })), { title: 'Choose how Research Copilot helps' });
      if (!item) return; mode = item.id;
    }
    this.invalidate(); this.mode = mode; await this.extension.workspaceState.update('mode', mode); this.status = MODES[mode].description; this.publish();
  }
  private backendKind(mode: ContextPacket['mode']) {
    const main = this.setting('backend', 'codex');
    const write = this.setting('writeBackend', 'same');
    return mode === 'write' && write !== 'same' ? write : main;
  }
  private getCodex() {
    if (!this.root) throw new Error('No project open');
    return this.codex ??= new CodexBackend({ executable: this.setting('codexPath', 'codex'), cwd: this.root.uri.fsPath, model: this.setting('model', ''), log: text => this.output.appendLine(text) });
  }
  private async getBackend(mode: ContextPacket['mode']): Promise<ResearchModelBackend> {
    const kind = this.backendKind(mode);
    if (kind === 'codex') return this.getCodex();
    if (kind !== 'local' && kind !== 'openai') throw new Error('Unknown backend in settings');
    return new HttpBackend({ kind, model: this.setting(kind === 'local' ? 'localModel' : 'openaiModel', ''), endpoint: this.setting('localEndpoint', 'http://127.0.0.1:11434/v1'), apiKey: kind === 'openai' ? await this.extension.secrets.get('openai-api-key') : undefined });
  }
  private async assemble(mode: ContextPacket['mode'], editor: vscode.TextEditor, question?: string): Promise<ContextPacket> {
    const index = this.index!, root = this.root!.uri.fsPath;
    const text = editor.document.getText();
    const file = path.relative(root, editor.document.uri.fsPath).split(path.sep).join('/');
    const offset = editor.document.offsetAt(editor.selection.active);
    const cursor = cursorContext(text, offset, parseLatex(file, text));
    const query = `${cursor.headings.map(h => h.title).join(' ')} ${cursor.paragraph.slice(-1200)} ${question ?? ''}`;
    const kinds: ArtifactKind[] = mode === 'structure' ? ['outline', 'tex', 'figure', 'table'] : mode === 'visual' ? ['result', 'figure', 'table', 'code', 'tex', 'outline'] : mode === 'evidence' ? ['pdf', 'result', 'bib', 'figure', 'tex'] : ['outline', 'tex', 'result', 'bib', 'pdf', 'figure', 'code'];
    const artifacts: Artifact[] = [];
    for (const kind of kinds) {
      let matches = await index.search(query, [kind], 8);
      if (!matches.length) matches = await index.search('', [kind], 3);
      artifacts.push(...matches);
    }
    const section = cursor.headings.at(-1)?.id ?? `tex:${file}`;
    const memory = this.projectState.sections[section];
    artifacts.push(...await index.resolve([...this.projectState.pins, ...(memory?.evidence ?? [])]));
    const citations = parseLatex(file, cursor.paragraph).citations.map(c => `bib:${c.key}`);
    artifacts.push(...await index.resolve(citations));
    // Confirmed relationships bring their current linked artifacts into retrieval.
    const related = new Set(artifacts.map(a => a.id));
    const graph = await index.graph();
    const linked = graph.filter(r => r.confirmed && (related.has(r.source) || related.has(r.target))).flatMap(r => [r.source, r.target]);
    artifacts.push(...await index.resolve(linked));
    const texFiles = new Map<string, string>();
    const manuscripts = await index.search('', ['tex'], 100);
    for (const a of manuscripts.filter(a => !a.id.includes('#'))) {
      const uri = await this.safeUri(a.path);
      const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      texFiles.set(a.path, open?.getText() ?? (await fs.readFile(uri.fsPath, 'utf8')));
    }
    texFiles.set(file, text);
    const rootFile = this.report?.config.paper?.root ?? [...texFiles].find(([, source]) => /\\documentclass(?:\[[^\]]*\])?\{/.test(source))?.[0] ?? file;
    const structure = resolveIncludes(rootFile, texFiles);
    // Replace on-disk manuscript objects with unsaved buffer content at request time.
    const currentArtifacts = artifacts.map(a => {
      if (a.kind !== 'tex' || !texFiles.has(a.path)) return a;
      const live = texFiles.get(a.path)!;
      return { ...a, text: live.slice(a.locator.start ?? 0, a.locator.end ?? 6000).slice(0, 6000), hash: hashText(live) };
    });
    const packet = assembleContext({ mode, path: file, text, offset, artifacts: currentArtifacts, pins: this.projectState.pins, excluded: this.projectState.excluded, budget: this.setting('contextBudget', 24000), sectionMemory: memory });
    const warning = structure.warnings.join('; ').slice(0, 500);
    if (warning && JSON.stringify(packet).length + warning.length + 50 <= this.setting('contextBudget', 24000)) packet.warnings.push(warning);
    return packet;
  }
  async suggest(question?: string, automatic = false, triggerInline = true) {
    if (!question && !shouldTrigger(this.mode, automatic ? 'automatic' : 'explicit', this.editor?.document.getText().slice(0, this.editor.document.offsetAt(this.editor.selection.active)) ?? '', this.setting('automaticSuggestions', false))) return;
    if (this.busy) return;
    await this.ensureIndex();
    const editor = this.editor;
    if (!editor || !isTex(editor.document) || editor.document.isClosed) throw new Error('Open a .tex manuscript and place the cursor where you want help.');
    if (editor.document.uri.scheme !== 'file' || vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.toString() !== this.root?.uri.toString()) throw new Error('The manuscript must belong to the selected local project.');
    const mode = question ? 'chat' : this.mode;
    if (mode === 'off') return;
    const backendKind = this.backendKind(mode);
    if (backendKind !== 'local') {
      const key = `${this.root!.uri}:${backendKind}`;
      if (!this.cloudConsent.has(key)) {
        if (automatic) { this.status = 'Make one explicit request to authorize sending selected context to the cloud backend.'; this.publish(); return; }
        const label = backendKind === 'codex' ? 'Codex / ChatGPT' : 'OpenAI API (separate billing)';
        if (await vscode.window.showInformationMessage(`Send selected manuscript excerpts and retrieved project evidence to ${label}? Your files stay local. Request contents are inspectable afterward.`, { modal: true }, 'Send selected context') !== 'Send selected context') return;
        this.cloudConsent.add(key);
      }
    }
    this.invalidate();
    const epoch = this.epoch, version = editor.document.version, offset = editor.document.offsetAt(editor.selection.active);
    const abort = new AbortController(); this.abort = abort; this.busy = true;
    this.status = 'Selecting project context…'; this.publish();
    try {
      const packet = await this.assemble(mode, editor, question);
      if (epoch !== this.epoch || abort.signal.aborted) return;
      const prompt = buildPrompt(packet, question, question ? this.history : []);
      this.contextPacket = packet;
      this.lastRequest = { prompt, context: packet, timestamp: new Date().toISOString(), backend: backendKind };
      const backend = await this.getBackend(mode);
      if (question) this.history.push({ role: 'user', text: question });
      for await (const event of backend.suggest({ context: packet, prompt, signal: abort.signal })) {
        if (epoch !== this.epoch || editor.document.version !== version || abort.signal.aborted) return;
        if (event.type === 'status') { this.status = event.text; this.publish(); continue; }
        this.lastRequest.response = event.value;
        const suggestion = validateSuggestion(event.value, mode);
        const sourceIds = packet.artifacts.filter(a => a.kind !== 'tex').map(a => a.id);
        const current = await this.index!.resolve(sourceIds);
        // Validate against the source hashes that were actually sent, not a new dataset.
        const sentHashes = new Map(packet.artifacts.map(a => [a.id, a.hash]));
        const unchanged = current.filter(a => sentHashes.get(a.id) === a.hash);
        unchanged.push(...packet.artifacts.filter(a => a.kind === 'tex'));
        if (epoch !== this.epoch || editor.document.version !== version || abort.signal.aborted) return;
        this.result = resolveSuggestion(suggestion, unchanged); this.lastRequest.resolved = this.result;
        if (question) this.history.push({ role: 'assistant', text: suggestion.text });
        this.history = this.history.slice(-20);
        if (this.result.insertable) this.ghost = { uri: editor.document.uri.toString(), version, offset, text: suggestion.insert_text };
        if (this.setting('diagnostics', true) && this.result.warnings.length) {
          const current = cursorContext(editor.document.getText(), offset, parseLatex(packet.current.path, editor.document.getText()));
          this.diagnostics.set(editor.document.uri, this.result.warnings.map(w => new vscode.Diagnostic(new vscode.Range(editor.document.positionAt(current.start), editor.document.positionAt(current.end)), w, vscode.DiagnosticSeverity.Warning)));
        }
        this.status = this.result.warnings.length ? 'Suggestion ready. Review the evidence warnings.' : 'Suggestion ready. Your manuscript is unchanged.';
        if (this.setting('logRequests', false)) await this.logRequest();
      }
    } finally {
      if (this.abort === abort) { this.abort = undefined; this.busy = false; this.publish(); }
    }
    if (this.ghost && triggerInline && vscode.window.activeTextEditor === editor) await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  }
  private async safeUri(relative: string) {
    if (!this.root) throw new Error('No local workspace');
    safeRelative(relative);
    const base = await fs.realpath(this.root.uri.fsPath), candidate = await fs.realpath(path.join(base, relative));
    const diff = path.relative(base, candidate);
    if (diff.startsWith('..' + path.sep) || diff === '..' || path.isAbsolute(diff)) throw new Error('Source resolves outside this workspace');
    return vscode.Uri.file(candidate);
  }
  private async openArtifact(id: string) {
    await this.ensureIndex(); const a = await this.index!.get(id);
    if (!a) throw new Error('Artifact is missing or stale. Refresh the project index.');
    if (a.path.endsWith('.pdf')) { await showPdf(this.index!, id); return; }
    const uri = await this.safeUri(a.path);
    if (/\.(png|svg)$/i.test(a.path)) { await vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.Beside); return; }
    const editor = await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    const position = a.locator.start !== undefined ? editor.document.positionAt(a.locator.start) : new vscode.Position(Math.max(0, (a.locator.line ?? 1) - 1), 0);
    editor.selection = new vscode.Selection(position, position); editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
  private async insertCitation(id: string) {
    const a = await this.index?.get(id), editor = this.editor;
    if (!a || a.kind !== 'bib' || typeof a.metadata.key !== 'string' || !/^[^\s{}\\,]+$/.test(a.metadata.key)) throw new Error('Citation requires a current bibliography entry');
    if (!editor || editor.document.isClosed || !isTex(editor.document)) throw new Error('Open a manuscript to insert this citation');
    await editor.edit(edit => edit.insert(editor.selection.active, `\\cite{${a.metadata.key}}`));
  }
  private async updateControl(action: 'pin' | 'exclude', id: string) { await this.ensureIndex(); this.invalidate(); this.projectState = await this.index!.update(action, { id }); this.status = 'Context controls saved locally.'; this.publish(); }
  async pin() {
    await this.ensureIndex(); const query = await vscode.window.showInputBox({ title: 'Find an artifact to pin', prompt: 'Search a filename, citation key, function, or result' });
    if (query === undefined) return;
    const artifacts = await this.index!.search(query, undefined, 100);
    const choice = await vscode.window.showQuickPick(artifacts.map(a => ({ label: a.title, description: a.id, id: a.id })), { title: 'Pin or unpin context' });
    if (choice) await this.updateControl('pin', choice.id);
  }
  async confirmRelation() {
    await this.ensureIndex(); const artifacts = await this.index!.search('', undefined, 100);
    const options = artifacts.map(a => ({ label: a.title, description: a.id, id: a.id }));
    const source = await vscode.window.showQuickPick(options, { title: 'Choose the source artifact' }); if (!source) return;
    const target = await vscode.window.showQuickPick(options.filter(a => a.id !== source.id), { title: 'Choose the related artifact' }); if (!target) return;
    const relation = await vscode.window.showQuickPick(['supports', 'generates', 'reads', 'illustrates', 'cites'], { title: 'Confirm the relationship' }); if (!relation) return;
    this.projectState = await this.index!.update('relation', { source: source.id, target: target.id, relation }); this.invalidate(); this.status = 'Confirmed relationship saved.'; this.publish();
  }
  async sectionMemory() {
    await this.ensureIndex(); if (!this.editor) throw new Error('Place the cursor in a manuscript section');
    const file = path.relative(this.root!.uri.fsPath, this.editor.document.fileName).split(path.sep).join('/');
    const current = cursorContext(this.editor.document.getText(), this.editor.document.offsetAt(this.editor.selection.active), parseLatex(file, this.editor.document.getText()));
    const id = current.headings.at(-1)?.id ?? `tex:${file}`;
    const summary = await vscode.window.showInputBox({ title: 'What should this section establish?', value: this.projectState.sections[id]?.summary ?? '', validateInput: value => value.length > 2000 ? 'Keep the goal under 2,000 characters.' : undefined });
    if (summary !== undefined) { this.projectState = await this.index!.update('section', { id, summary, evidence: this.projectState.pins }); this.invalidate(); this.publish(); }
  }
  async signIn() { await this.ensureIndex(); const result = await this.getCodex().login(); if (result.authUrl) { const url = vscode.Uri.parse(result.authUrl); if (url.scheme !== 'https') throw new Error('Codex returned an unexpected authentication URL'); await vscode.env.openExternal(url); this.status = 'Finish ChatGPT sign-in in your browser, then request a suggestion.'; } else this.status = 'Codex sign-in started. Check the Codex authentication status.'; this.publish(); }
  async selectModel() { await this.ensureIndex(); const models = await this.getCodex().models(); const choice = await vscode.window.showQuickPick(models.data.map(m => ({ label: m.displayName, description: m.model, id: m.model })), { title: 'Codex model' }); if (choice) await vscode.workspace.getConfiguration('researchCopilot').update('model', choice.id, vscode.ConfigurationTarget.Global); }
  async apiKey() { const key = await vscode.window.showInputBox({ title: 'OpenAI API key (separate API billing)', password: true, ignoreFocusOut: true, prompt: 'Stored in VS Code SecretStorage. Leave empty to remove the saved key.' }); if (key !== undefined) { if (key.trim()) await this.extension.secrets.store('openai-api-key', key.trim()); else await this.extension.secrets.delete('openai-api-key'); } }
  async setup() {
    await this.ensureIndex();
    const choice = await vscode.window.showInformationMessage(`Python: ${this.python()} · PDF support: ${this.report?.capabilities.pdf ? 'ready' : 'missing'} · ${this.report?.count ?? 0} indexed artifacts. Suggestions default to explicit triggers.`, 'Sign in with ChatGPT', 'Choose model', 'Settings', 'Configure project');
    if (choice === 'Sign in with ChatGPT') await this.signIn();
    if (choice === 'Choose model') await this.selectModel();
    if (choice === 'Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'researchCopilot');
    if (choice === 'Configure project') await this.configure();
  }
  async configure() {
    await this.ensureIndex(); const uri = vscode.Uri.joinPath(this.root!.uri, '.research-copilot', 'project.yaml');
    if (!existsSync(uri.fsPath)) {
      await fs.writeFile(uri.fsPath, '# Optional workspace-relative resource paths and globs. Defaults auto-discover.\n# paper:\n#   root: paper/main.tex\n# outline:\n#   path: outline/outline.md\n# bibliography:\n#   - references/**/*.bib\n# reference_pdfs:\n#   - references/pdfs/**/*.pdf\n# results:\n#   - results/**/*.csv\n#   - results/**/*.json\n# code:\n#   - code/**/*.py\n# figures:\n#   - figures/**/*.{pdf,png,svg}\n# exclude:\n#   - private/**\n', { flag: 'wx' });
    }
    await vscode.window.showTextDocument(uri);
  }
  async inspect() {
    if (!this.lastRequest) throw new Error('No model request has been made yet');
    const text = JSON.stringify(this.lastRequest, null, 2);
    const uri = vscode.Uri.parse(`research-copilot-preview:/request-${Date.now()}.json`); this.snapshots.set(uri.toString(), text);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }
  private async logRequest() {
    if (!this.root || !this.lastRequest) return;
    const directory = path.join(this.root.uri.fsPath, '.research-copilot', 'logs');
    await fs.mkdir(directory, { recursive: true });
    const base = await fs.realpath(this.root.uri.fsPath), real = await fs.realpath(directory);
    if (path.relative(base, real).startsWith('..')) throw new Error('Log directory resolves outside the workspace');
    await fs.writeFile(path.join(real, `${Date.now()}.json`), JSON.stringify(this.lastRequest, null, 2), { flag: 'wx', mode: 0o600 });
  }
  async reviewEdit() {
    const proposal = this.result?.suggestion.edit;
    if (!proposal) throw new Error('Ask Chat for a specific manuscript edit first');
    const uri = await this.safeUri(proposal.path);
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = prepareEdit(proposal, document.getText());
    this.reviewed = { uri, version: document.version, hash: edit.hash, updated: edit.updated, start: edit.start, end: edit.end, replacement: proposal.replacement };
    const proposedUri = vscode.Uri.parse(`research-copilot-preview:/proposed-${Date.now()}.tex`); this.snapshots.set(proposedUri.toString(), edit.updated);
    await vscode.commands.executeCommand('vscode.diff', uri, proposedUri, `Review proposed edit · ${path.basename(proposal.path)}`);
    const warnings = this.result!.warnings.length ? ` Evidence warnings: ${this.result!.warnings.join(' ')}` : '';
    if (await vscode.window.showWarningMessage(`Review the diff before applying this manuscript edit.${warnings} Raw results cannot be changed.`, { modal: false }, 'Apply reviewed edit', 'Reject') === 'Apply reviewed edit') await this.applyEdit();
  }
  async applyEdit() {
    const reviewed = this.reviewed;
    if (!reviewed) throw new Error('Review the proposed diff before applying it');
    const document = await vscode.workspace.openTextDocument(reviewed.uri);
    if (document.version !== reviewed.version || hashText(document.getText()) !== reviewed.hash) { this.reviewed = undefined; throw new Error('Manuscript changed after review. Regenerate and review a new diff.'); }
    const edit = new vscode.WorkspaceEdit(); edit.replace(reviewed.uri, new vscode.Range(document.positionAt(reviewed.start), document.positionAt(reviewed.end)), reviewed.replacement);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code could not apply the reviewed edit');
    this.reviewed = undefined;
    if (this.lastRequest) this.lastRequest.applied = { path: reviewed.uri.fsPath, originalHash: reviewed.hash, resultHash: hashText(reviewed.updated) };
    this.status = 'Reviewed edit applied to the editor. Undo is available; save when ready.'; this.publish();
  }
  // Read-only diagnostics for extension-host acceptance tests and troubleshooting.
  getState() { return { mode: this.mode, status: this.status, report: this.report, result: this.result, context: this.contextPacket, busy: this.busy, catalog: this.catalog }; }
  dispose() { if (this.disposed) return; this.disposed = true; this.abort?.abort(); clearTimeout(this.triggerTimer); this.resetIndex(); this.codex?.dispose(); this.statusbar.dispose(); this.output.dispose(); this.diagnostics.dispose(); this.disposables.forEach(d => d.dispose()); }
}

export function activate(context: vscode.ExtensionContext) {
  const controller = new ResearchCopilot(context);
  context.subscriptions.push(controller, vscode.window.registerWebviewViewProvider('researchCopilot.sidebar', controller, { webviewOptions: { retainContextWhenHidden: true } }));
  const commands: Record<string, (...args: any[]) => Promise<unknown> | void> = {
    setMode: mode => controller.setMode(mode), suggest: () => controller.suggest(), cancel: () => controller.cancel(),
    signIn: () => controller.signIn(), selectModel: () => controller.selectModel(), reindex: () => controller.refresh(), configure: () => controller.configure(), apiKey: () => controller.apiKey(), inspectContext: () => controller.inspect(), reviewEdit: () => controller.reviewEdit(), applyEdit: () => controller.applyEdit(), pin: () => controller.pin(), confirmRelation: () => controller.confirmRelation(), sectionMemory: () => controller.sectionMemory(), setup: () => controller.setup(),
  };
  for (const [name, handler] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(`researchCopilot.${name}`, (...args) => controller.run(async () => handler(...args))));
  return { getState: () => controller.getState(), ready: () => controller.ensureIndex(), suggest: (question?: string) => controller.suggest(question), setMode: (mode: Mode) => controller.setMode(mode) };
}
export function deactivate() {}

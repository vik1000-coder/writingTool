import * as vscode from "vscode";
import type { ResolvedSuggestion } from "../core/types";
import { suggestedReferences, type SourceCard } from "../core/cards";

const titleAttribute = (value: string) =>
  value
    .replace(/\s*\n+\s*/g, " — ")
    .slice(0, 900)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const shortTitle = (value: string) =>
  value.length > 32 ? value.slice(0, 31) + "…" : value;

export class SuggestionHover implements vscode.Disposable {
  private decoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 1.5em",
      color: new vscode.ThemeColor("editorInfo.foreground"),
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private current?: {
    editor: vscode.TextEditor;
    version: number;
    position: vscode.Position;
    markdown: vscode.MarkdownString;
  };
  private provider = vscode.languages.registerHoverProvider(
    [
      { scheme: "file", language: "latex" },
      { scheme: "file", language: "tex" },
    ],
    {
      provideHover: (document, position) => {
        const c = this.current;
        if (
          !c ||
          document !== c.editor.document ||
          document.version !== c.version ||
          position.line !== c.position.line
        )
          return;
        return new vscode.Hover(
          c.markdown,
          new vscode.Range(c.position, c.position),
        );
      },
    },
  );
  set(
    editor: vscode.TextEditor,
    result: ResolvedSuggestion,
    sources: SourceCard[],
    token: string,
  ) {
    this.clear();
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = {
      enabledCommands: ["researchCopilot.referenceAction"],
    };
    markdown.supportHtml = false;
    markdown.appendMarkdown("**GUIDE · ");
    markdown.appendText(result.suggestion.title);
    markdown.appendMarkdown("**\n\n");
    markdown.appendText(result.suggestion.text.slice(0, 600));
    const references = suggestedReferences(sources);
    if (references.length) {
      markdown.appendMarkdown("\n\n---\n\n**Suggested references**\n\n");
      markdown.appendText(
        "Hover ⓘ for the AI summary and why the source fits; select it to open the exact local source.",
      );
    }
    for (const [index, s] of references.entries()) {
      markdown.appendMarkdown("\n\n");
      markdown.appendText(`${index + 1}. ${s.artifact.title}`);
      markdown.appendMarkdown("\n\n");
      markdown.appendText(
        s.artifact.path +
          (s.artifact.locator.page ? ` · p. ${s.artifact.locator.page}` : ""),
      );
      markdown.appendMarkdown("\n\n");
      for (const [label, lock, tooltip] of [
        ["ⓘ details", false, s.details],
        ["Lock reference", true, "Hold this exact local source while writing"],
      ] as const) {
        const args = encodeURIComponent(
          JSON.stringify([token, s.artifact.id, lock]),
        );
        markdown.appendMarkdown(
          `  [${label}](command:researchCopilot.referenceAction?${args} "${titleAttribute(tooltip)}")`,
        );
      }
    }
    if (sources.length > references.length)
      markdown.appendText(
        `\n\n${sources.length - references.length} other supporting source(s) are available in Evidence.`,
      );
    for (const warning of result.warnings.slice(0, 3))
      markdown.appendText(`\n\nWarning: ${warning}`);
    // appendText safely escapes Markdown, but turns spaces into nonbreaking
    // entities. Restore ordinary spaces so narrow native hovers wrap naturally.
    markdown.value = markdown.value.replaceAll("&nbsp;", " ");
    const position = editor.selection.active;
    this.current = {
      editor,
      version: editor.document.version,
      position,
      markdown,
    };
    const inlineReferences = references
      .slice(0, 2)
      .map((source) => shortTitle(source.artifact.title));
    const inlineTopic = result.suggestion.title
      .replace(/\s+/g, " ")
      .slice(0, inlineReferences.length ? 48 : 65);
    editor.setDecorations(this.decoration, [
      {
        range: new vscode.Range(position, position),
        renderOptions: {
          after: {
            contentText: `◇ ${inlineTopic}${inlineReferences.length ? ` · refs: ${inlineReferences.join("; ")}` : ""}`,
          },
        },
      },
    ]);
  }
  async show() {
    const c = this.current;
    if (!c) return;
    await vscode.window.showTextDocument(c.editor.document, {
      viewColumn: c.editor.viewColumn,
      preserveFocus: false,
    });
    // Editor/cursor events may have invalidated the card while focus changed.
    if (this.current !== c) return;
    await vscode.commands.executeCommand("editor.action.showHover");
  }
  clear() {
    if (this.current)
      void vscode.commands.executeCommand("editor.action.hideHover");
    this.current?.editor.setDecorations(this.decoration, []);
    this.current = undefined;
  }
  dispose() {
    this.clear();
    this.provider.dispose();
    this.decoration.dispose();
  }
}

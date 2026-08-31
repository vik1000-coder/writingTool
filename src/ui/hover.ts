import * as vscode from "vscode";
import type { ResolvedSuggestion } from "../core/types";
import type { SourceCard } from "../core/cards";

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
    for (const s of sources.slice(0, 1)) {
      markdown.appendMarkdown("\n\n---\n\n**");
      markdown.appendText(s.artifact.title);
      markdown.appendMarkdown("**\n\n");
      markdown.appendText(
        s.artifact.path +
          (s.artifact.locator.page ? ` · p. ${s.artifact.locator.page}` : ""),
      );
      markdown.appendMarkdown("\n\n**Summary · AI interpretation**\n\n");
      markdown.appendText(
        s.summary.length > 350 ? s.summary.slice(0, 350) + "…" : s.summary,
      );
      markdown.appendMarkdown("\n\n**Why here · AI interpretation**\n\n");
      markdown.appendText(
        s.relevance.length > 350
          ? s.relevance.slice(0, 350) + "…"
          : s.relevance,
      );
      if (s.artifact.kind === "bib")
        markdown.appendText(
          "\n\nCitation candidate — no exact full-text quotation selected.",
        );
      markdown.appendMarkdown("\n\n");
      for (const [label, lock] of [
        ["View source", false],
        ["Lock reference", true],
      ] as const) {
        const args = encodeURIComponent(
          JSON.stringify([token, s.artifact.id, lock]),
        );
        markdown.appendMarkdown(
          `  [${label}](command:researchCopilot.referenceAction?${args})`,
        );
      }
    }
    if (sources.length > 1)
      markdown.appendText(
        `\n\n${sources.length - 1} more sources in the Suggestion panel.`,
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
    editor.setDecorations(this.decoration, [
      {
        range: new vscode.Range(position, position),
        renderOptions: {
          after: {
            contentText: `◇ ${result.suggestion.title.replace(/\s+/g, " ").slice(0, 65)}`,
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

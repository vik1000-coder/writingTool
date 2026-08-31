# Technical Specification: Local-First AI Research Writing IDE

**Working name:** Research Copilot  
**Version:** 0.1  
**Initial platform:** VS Code extension  
**Primary document format:** LaTeX  
**Storage model:** Local filesystem / ordinary Git repository  
**Primary AI backend:** OpenAI Codex App Server via ChatGPT authentication  
**Optional backends:** OpenAI API, local OpenAI-compatible models/Ollama

---

# 1. Product Definition

Research Copilot is a local-first environment for writing scientific papers in LaTeX with AI assistance grounded in the complete research project.

The system differs from conventional AI writing assistants in three fundamental ways:

1. **The research project, not merely the document, is the unit of context.**
2. **The user controls the level and type of AI intervention.**
3. **Scientific suggestions retain explicit provenance to references, experimental results, figures, tables, code, or the manuscript structure.**

The researcher remains the primary author.

The AI may help determine:

- what should be discussed next;
- how a sentence could continue;
- what evidence supports a statement;
- whether a citation is required;
- where a figure or table would help;
- what experimental result should be discussed;
- whether manuscript claims agree with the underlying results;
- whether the current section satisfies the planned argument;
- how the manuscript fits together globally.

The AI must not silently transform the paper or invent scientific evidence.

---

# 2. Core Product Principle

The central abstraction is:

\[
\text{Research Project}
=
\text{Manuscript}
+
\text{Outline}
+
\text{References}
+
\text{Code}
+
\text{Results}
+
\text{Figures/Tables}.
\]

The AI operates over this object rather than over a single text buffer.

A typical project might look like:

```text
project/
│
├── paper/
│   ├── main.tex
│   ├── introduction.tex
│   ├── methods.tex
│   ├── results.tex
│   └── appendix.tex
│
├── outline/
│   └── outline.md
│
├── references/
│   ├── references.bib
│   └── pdfs/
│       ├── smith2024.pdf
│       └── jones2025.pdf
│
├── code/
│   ├── train.py
│   ├── evaluate.py
│   └── plots.py
│
├── experiments/
│   ├── experiment_01/
│   └── experiment_02/
│
├── results/
│   ├── primary_results.csv
│   ├── ablations.csv
│   └── metrics.json
│
├── figures/
│   ├── figure1.pdf
│   └── figure2.pdf
│
└── .research-copilot/
    ├── project.yaml
    └── index.sqlite
```

No particular directory organization should ultimately be required. The example above represents a canonical layout.

The user must be able to point the system toward arbitrary files and directories.

---

# 3. Primary User Experience

The default interface uses the existing VS Code editor.

```text
┌─────────────────┬─────────────────────────────┬────────────────────┐
│ PROJECT         │                             │ RESEARCH COPILOT   │
│                 │                             │                    │
│ ▾ paper         │                             │ Mode: GUIDE        │
│   main.tex      │                             │                    │
│   results.tex   │       LATEX EDITOR          │ NEXT IDEA          │
│                 │                             │ Explain why the    │
│ ▾ code          │       ...therefore |        │ effect becomes     │
│   evaluate.py   │                             │ stronger as β      │
│                 │                             │ increases.         │
│ ▾ results       │                             │                    │
│   results.csv   │                             │ EVIDENCE           │
│                 │                             │ results.csv        │
│ ▾ figures       │                             │ rows 18–37         │
│                 │                             │                    │
│ ▾ references    │                             │ Smith 2024         │
│                 │                             │ p. 7               │
├─────────────────┴─────────────────────────────┴────────────────────┤
│                 Compiled manuscript / PDF                         │
└────────────────────────────────────────────────────────────────────┘
```

The AI sidebar is not primarily a chatbot.

It contains structured panels such as:

- Current suggestion
- Outline
- Evidence
- Results
- References
- Figures/tables
- Context inspector
- Chat

Chat exists as an escape hatch for unconstrained interaction rather than as the principal user interface.

---

# 4. Assistance Modes

The defining interface feature is explicit control over AI behavior.

## 4.1 OFF

No proactive AI suggestions.

Explicit questions remain available through Chat.

---

## 4.2 GUIDE

The AI determines what the user should discuss next but does **not write publication-ready prose**.

Example:

User writes:

```latex
We next evaluate how the bridge schedule affects sampling efficiency.
```

The system displays:

> **Next sentence should accomplish:**  
> Explain that the largest difference appears under strong constraints before introducing the quantitative ESS comparison.

Possible additional information:

```text
Relevant evidence
────────────────────────
results/beta_sweep.csv
Figure 3B

Relevant outline item
────────────────────────
Results → Constraint-strength analysis
```

GUIDE should generally be the default mode.

Its purpose is augmentation rather than ghostwriting.

---

## 4.3 WRITE

The system provides inline prose continuation.

Example:

```latex
We next evaluate how the bridge schedule affects sampling efficiency,
```

Ghost text:

```text
with the largest gains appearing as the conditioning constraint becomes stronger.
```

Interaction:

- `Tab` → accept
- `Esc` → reject
- configurable shortcut → regenerate
- partial acceptance should eventually be supported

WRITE suggestions should usually be constrained to:

- one clause;
- one sentence;
- occasionally two sentences when explicitly requested.

The system should not spontaneously generate an entire paragraph.

---

## 4.4 EVIDENCE

The AI focuses on whether claims are adequately grounded.

For:

```latex
Progressive bridging substantially increases particle diversity
under strong conditioning.
```

the sidebar might display:

```text
EMPIRICAL SUPPORT

results/beta_sweep.csv
rows 41–80

Direct SMC:
median ESS = ...

Progressive:
median ESS = ...

Existing visualization:
figures/beta_sweep.pdf
```

and:

```text
LITERATURE SUPPORT

smith2024
Page 7

"... exact source text ..."

[Open PDF] [Insert \cite{smith2024}]
```

The user should be able to click the quotation and see the corresponding text highlighted in the PDF.

---

## 4.5 FIGURE/TABLE

The system suppresses prose suggestions and instead reasons about scientific presentation.

Example:

```text
FIGURE SUGGESTION

Purpose
Show that progressive bridging becomes advantageous
as constraint strength increases.

Available data
results/beta_sweep.csv

Relevant methods
code/plots.py::plot_beta_sweep

Existing artifact
figures/beta_sweep.pdf

Suggested placement
After current paragraph.

Suggested panel structure
A. Effective sample size
B. Weight degeneracy
C. Runtime
```

Or:

```text
TABLE SUGGESTION

Compare:
- direct SMC
- fixed bridge
- adaptive bridge

Columns:
ESS
runtime
failure rate

Source:
results/main_comparison.csv
```

The AI does not generate the figure automatically unless explicitly requested.

---

## 4.6 STRUCTURE

The system reasons at paragraph, section, and paper level.

Example:

```text
RESULTS

✓ Establish failure of direct sampling
✓ Introduce progressive bridge
✓ Main performance comparison

→ Explain when the improvement is largest

○ Bridge-count ablation
○ Computational-cost analysis
○ Failure case
```

Potential warnings:

```text
STRUCTURAL ISSUE

The Introduction claims two primary contributions,
but the Results currently evaluate only the first.
```

or:

```text
TRANSITION ISSUE

The current paragraph introduces computational cost
before the main accuracy result has been established.
```

---

# 5. Internal Model: Two Axes Rather Than One

Although the interface exposes convenient presets, internally the system should represent assistance along two independent dimensions.

## Axis 1: Lens

```text
prose
argument
evidence
literature
results
visualization
structure
```

## Axis 2: Intervention Level

```text
0 = observe
1 = flag
2 = suggest intent
3 = suggest prose
4 = propose edit
5 = modify after approval
```

Therefore:

```text
GUIDE
lens = argument
intervention = 2

WRITE
lens = prose
intervention = 3

EVIDENCE
lens = evidence
intervention = 1–2

FIGURE/TABLE
lens = visualization
intervention = 2

STRUCTURE
lens = structure
intervention = 1–2
```

This separation prevents the product from eventually becoming constrained by a small hard-coded collection of modes.

---

# 6. Workspace Configuration

The application should automatically discover most project resources.

Optional configuration:

```yaml
paper:
  root: paper/main.tex

outline:
  path: outline/outline.md
  optional: true

bibliography:
  - references/references.bib

reference_pdfs:
  - references/pdfs/**/*.pdf

code:
  - code/**/*.py
  - analysis/**/*.py
  - notebooks/**/*.ipynb

results:
  - results/**/*.csv
  - results/**/*.json
  - results/**/*.parquet

figures:
  - figures/**/*.{pdf,png,svg}
```

The outline is explicitly optional.

If no outline exists, the system may derive an **ephemeral structural outline** from LaTeX headings:

```latex
\section{}
\subsection{}
\paragraph{}
```

It must not create or overwrite a persistent outline unless requested.

---

# 7. System Architecture

```text
                    VS CODE
                       │
             ┌─────────┴─────────┐
             │ Research Copilot  │
             │    Extension      │
             └─────────┬─────────┘
                       │
              Context Orchestrator
                       │
       ┌───────────────┼─────────────────┐
       │               │                 │
 Project Index    Retrieval Engine   Mode Engine
       │               │                 │
       └───────────────┼─────────────────┘
                       │
                Provenance Layer
                       │
             Structured AI Request
                       │
       ┌───────────────┼─────────────────┐
       │               │                 │
 Codex App Server   OpenAI API      Local Model
       │
 ChatGPT login
```

The AI itself should not be responsible for discovering everything from scratch on every request.

The local context system decides what information is relevant before invoking the model.

---

# 8. Front-End Architecture

## 8.1 VS Code Extension

Implementation language:

```text
TypeScript
```

Use existing VS Code capabilities wherever possible:

- text editor;
- filesystem;
- Git integration;
- terminal;
- Python environment;
- Jupyter integration;
- inline completion API;
- decorations;
- diagnostics;
- TreeView;
- WebviewView;
- commands;
- file watchers.

Do not implement a new text editor.

---

## 8.2 LaTeX

Initial recommendation:

Use the user's existing LaTeX installation and LaTeX Workshop where possible.

Research Copilot needs to understand:

- `\input`
- `\include`
- sections/subsections
- labels
- references
- citations
- figures
- tables
- equations
- custom macros sufficiently to resolve manuscript structure.

A lightweight LaTeX AST should be maintained for structural reasoning.

Compilation itself is not an AI responsibility.

---

# 9. Project Indexer

The project indexer watches relevant files and incrementally indexes changes.

Supported artifacts in the MVP:

```text
.tex
.bib
.md
.pdf
.py
.ipynb
.csv
.json
.yaml
.yml
.png
.pdf figures
.svg
```

Later:

```text
.parquet
.h5
.mat
.R
.Rmd
Julia
```

Index location:

```text
.research-copilot/index.sqlite
```

This file should normally be placed in `.gitignore`.

---

# 10. Artifact Model

Every indexed object receives a stable artifact identifier.

Examples:

```text
tex:results.tex#paragraph-14

bib:smith2024

pdf:smith2024#page-7-block-13

result:beta_sweep.csv#rows-42-58

code:analysis.py#compute_ess

figure:beta_sweep.pdf

outline:results.constraint_strength
```

This provides the basis for provenance.

---

# 11. Provenance Graph

The system maintains relationships between research objects.

Example:

```text
code:analysis.py#compute_ess
            │
            ▼
result:beta_sweep.csv
            │
            ▼
figure:beta_sweep.pdf
            │
            ▼
tex:results.tex#paragraph-14
            │
            ▼
claim:progressive-improves-ess
```

Reference evidence forms another branch:

```text
pdf:smith2024#page-7-block-13
            │
            ▼
bib:smith2024
            │
            ▼
claim:importance-degeneracy
```

Initially many edges may be inferred.

Users should be able to explicitly pin or confirm important relationships.

Confirmed relations should be treated as higher-confidence context.

---

# 12. Reference and PDF Engine

Reference handling is one of the highest-priority systems.

## 12.1 BibTeX

Parse:

- citation key;
- title;
- authors;
- year;
- journal/conference;
- DOI;
- URL when available;
- local PDF location if known.

---

## 12.2 PDF Extraction

A local helper process should extract PDF text while retaining:

```text
page
text
bounding box
block ID
character offsets
```

Candidate implementation:

```text
PyMuPDF
```

Store:

```json
{
  "artifact_id": "pdf:smith2024#page-7-block-13",
  "page": 7,
  "bbox": [72.1, 104.0, 510.2, 155.3],
  "text": "Exact extracted source passage..."
}
```

---

## 12.3 Critical Integrity Requirement

The LLM must **never generate the displayed quotation itself**.

Instead:

1. retrieval identifies a source block;
2. the model refers to its artifact ID;
3. the UI retrieves the exact text directly from the local database;
4. the exact text is displayed as the quotation.

Therefore a hallucinated quotation cannot accidentally be presented as source text.

---

## 12.4 PDF Viewer

Use PDF.js or an equivalent local renderer.

Clicking:

```text
smith2024 — p. 7
```

must:

1. open the PDF;
2. navigate to page 7;
3. scroll to the stored bounding box;
4. highlight the source passage.

This is a core product feature rather than a nice-to-have.

---

# 13. Result Engine

The result engine allows the AI to reason about empirical outputs without relying on free-form guesses.

Initially support:

```text
CSV
JSON
Parquet
```

For each data artifact compute:

- schema;
- column names;
- data types;
- dimensions;
- basic descriptive statistics;
- named/indexed rows;
- lightweight preview.

The model should retrieve **small relevant slices**, not receive entire large datasets automatically.

Example provenance object:

```json
{
  "artifact_id": "result:beta_sweep.csv",
  "selector": {
    "rows": [41, 42, 43, 44],
    "columns": ["beta", "method", "ess"]
  },
  "hash": "..."
}
```

If a suggested sentence contains a numerical empirical claim, the system should attempt to associate that number with a result locator.

If no locator exists:

```text
⚠ Empirical value not grounded in indexed results.
```

---

# 14. Code Engine

Code is relevant for two purposes:

1. understanding how results were produced;
2. finding analysis/plotting functions relevant to manuscript claims.

The index should initially extract:

- files;
- functions;
- classes;
- docstrings;
- imports;
- obvious output paths;
- references to known result/figure filenames.

For Python, use the native AST plus text search.

Example:

```text
figure:beta_sweep.pdf
      ↑
generated by
      ↑
code:plots.py#plot_beta_sweep
      ↑
reads
      ↑
result:beta_sweep.csv
```

The system does not need perfect lineage inference for the MVP.

User-confirmed lineage is sufficient.

---

# 15. Context Engine

Every AI request gets a deliberately assembled context packet.

The packet should not simply contain the entire repository.

For a cursor position inside `results.tex`, context might include:

```text
CURRENT
- current sentence
- current paragraph
- surrounding paragraphs

SECTION
- current subsection
- section heading hierarchy
- section labels

PAPER
- abstract
- contribution statement
- nearby section summaries

OUTLINE
- corresponding outline node, if available

RESULTS
- relevant indexed result slices

FIGURES
- nearby/currently relevant figures

REFERENCES
- currently cited papers
- semantically relevant source passages

CODE
- relevant analysis functions

USER-PINNED CONTEXT
- explicitly pinned artifacts
```

Different modes use different retrieval policies.

---

# 16. Mode-Specific Retrieval

## WRITE

Prioritize:

1. immediate prose context;
2. section goal;
3. terminology consistency;
4. evidence only when needed.

Do not retrieve the entire literature collection.

---

## GUIDE

Prioritize:

1. current paragraph;
2. next outline objective;
3. section-level argument;
4. available results;
5. paper-level contribution.

---

## EVIDENCE

Prioritize:

1. current claim;
2. local reference PDFs;
3. indexed results;
4. existing citations;
5. relevant figures.

---

## FIGURE/TABLE

Prioritize:

1. current Results subsection;
2. results files;
3. existing figures;
4. plotting code;
5. nearby figure/table references.

---

## STRUCTURE

Prioritize:

1. outline;
2. section summaries;
3. abstract;
4. introduction/contributions;
5. section ordering;
6. figure/table sequence.

This separation is important for both quality and cost.

---

# 17. Structured Model Output

The model should generally not return arbitrary Markdown that the application then tries to interpret.

Each mode gets a structured output contract.

Example GUIDE response:

```json
{
  "mode": "guide",
  "suggestion": {
    "type": "sentence_intent",
    "text": "Explain that the performance gap increases as the constraint becomes stronger."
  },
  "evidence_ids": [
    "result:beta_sweep.csv#slice-41"
  ],
  "outline_ids": [
    "outline:results.constraint_strength"
  ]
}
```

WRITE:

```json
{
  "mode": "write",
  "insert_text": "with the largest gains appearing under strong constraints.",
  "evidence_ids": [
    "result:beta_sweep.csv#slice-41"
  ]
}
```

FIGURE:

```json
{
  "mode": "visual",
  "proposal": {
    "type": "figure",
    "purpose": "Show the interaction between constraint strength and sampler performance.",
    "placement": "after_current_paragraph",
    "data_ids": [
      "result:beta_sweep.csv"
    ],
    "existing_artifact_ids": [
      "figure:beta_sweep.pdf"
    ]
  }
}
```

The UI resolves artifact IDs into exact local content.

---

# 18. Context Inspector

Every AI suggestion should contain a small:

```text
Why this?
```

control.

Clicking it opens:

```text
AI CONTEXT

Current paragraph
results.tex lines 118–132

Outline
Results → Constraint strength

Results
beta_sweep.csv rows 41–80

Figures
beta_sweep.pdf

References
smith2024, page 7
```

The user should be able to inspect what caused a suggestion.

This is especially important for scientific use.

---

# 19. Pinning

Any object should be pinnable to:

- the whole paper;
- a section;
- the current writing session.

Examples:

```text
Pin result → Results §3.2

Pin Smith 2024 → Introduction

Pin Figure 4 → Discussion
```

Pinned context receives priority over semantic retrieval.

This gives the researcher direct control over model context.

---

# 20. AI Backend Architecture

A backend abstraction should allow several providers.

```typescript
interface ResearchModelBackend {
    suggest(request: ResearchRequest): AsyncIterable<ResearchEvent>;
}
```

Implementations:

```text
CodexBackend
OpenAIAPIBackend
LocalBackend
```

---

# 21. Codex / ChatGPT Backend

The preferred initial deep-reasoning backend is the **Codex App Server**.

The local extension launches the Codex App Server as a child process.

Communication:

```text
JSON-RPC / JSONL over stdio
```

Responsibilities delegated to Codex include:

- authentication;
- model selection;
- conversation state;
- workspace interaction;
- tool execution;
- approval handling;
- reasoning;
- context compaction.

The user authenticates using:

```text
Sign in with ChatGPT
```

rather than entering an API key.

This gives a practical way for a personal version of Research Copilot to benefit from an existing ChatGPT subscription.

The application must not attempt to automate or scrape the normal ChatGPT web interface.

---

# 22. Optional OpenAI API Backend

The API backend exists for:

- faster lightweight completions;
- predictable programmatic calls;
- structured outputs;
- high-frequency operations where using a full Codex turn is unnecessarily heavy.

API billing is separate from the ChatGPT subscription.

Therefore the API backend must remain optional.

---

# 23. Local Model Backend

Support OpenAI-compatible local endpoints and/or Ollama.

The ideal hybrid configuration may eventually be:

```text
WRITE
→ small local model

GUIDE
→ Codex

EVIDENCE
→ Codex + local retrieval

FIGURE/TABLE
→ Codex

STRUCTURE
→ Codex

CHAT
→ Codex
```

This avoids making a cloud model call every time the user types a few words.

A subscription-only mode must also work:

```text
WRITE
→ Codex on explicit trigger or reasonable debounce

All other modes
→ Codex
```

---

# 24. Tools Exposed to the Model

The context system should expose narrowly scoped tools.

Examples:

```text
read_tex_span(path, start, end)

get_section(section_id)

search_project(query)

search_references(query)

get_pdf_passage(artifact_id)

search_results(query)

get_result_slice(path, rows, columns)

list_figures(section)

inspect_figure(path)

search_code(query)

get_outline_node(id)

get_paper_structure()
```

The model should generally receive the smallest sufficient artifact.

---

# 25. Read/Write Permissions

Core rule:

> Suggestion modes are read-only.

The following modes cannot change files:

```text
GUIDE
EVIDENCE
FIGURE/TABLE
STRUCTURE
```

WRITE may produce insertable ghost text, but nothing changes until acceptance.

Agentic edits initiated through Chat must produce a diff and require approval.

Scientific files such as raw results should default to read-only.

---

# 26. Citation Integrity Rules

The system must enforce:

### Rule 1
A citation suggestion must correspond to a real bibliography object.

### Rule 2
A displayed quotation must come directly from extracted PDF text.

### Rule 3
If the full source is unavailable, display:

```text
Citation candidate — full-text evidence not verified.
```

### Rule 4
The model cannot invent:

```latex
\cite{unknown2027}
```

unless the bibliography item has first been created or explicitly proposed as a new candidate.

### Rule 5
Literature search and literature verification are separate operations.

A paper discovered through external search is not treated as verified evidence until sufficient source material is available.

---

# 27. Empirical Integrity Rules

Numerical manuscript suggestions must be distinguishable as:

```text
GROUNDED
value corresponds to indexed data

COMPUTED
value produced by an explicitly executed analysis

UNGROUNDED
model generated / not verified
```

UNGROUNDED numerical claims should be visually flagged and should not be silently inserted.

---

# 28. Outline System

An outline node may contain:

```yaml
title: Constraint-strength experiment

goal:
  Establish when progressive SMC gives the greatest benefit.

claims:
  - Direct SMC deteriorates under stronger constraints.
  - Progressive bridging limits this deterioration.

evidence:
  - results/beta_sweep.csv

figures:
  - figures/beta_sweep.pdf

status:
  incomplete
```

The outline can therefore become much more useful than a list of headings.

However, a plain Markdown outline must remain perfectly valid.

---

# 29. Figure and Table Registry

The index should track:

```text
artifact
caption
LaTeX label
first manuscript reference
source data if known
generating code if known
status
```

Example:

```yaml
id: figure:beta_sweep.pdf
label: fig:beta-sweep
data:
  - results/beta_sweep.csv
generated_by:
  - code/plots.py#plot_beta_sweep
```

This lets the assistant reason about figures scientifically rather than merely noticing image files.

---

# 30. Suggested VS Code UI

## Status Bar

```text
Research AI: GUIDE
```

Clicking opens:

```text
OFF
GUIDE
WRITE
EVIDENCE
FIGURE/TABLE
STRUCTURE
```

---

## Sidebar

Tabs:

```text
Suggestion
Evidence
Outline
Results
References
Context
Chat
```

---

## Editor Decorations

Potential gutter indicators:

```text
[C] citation/evidence issue

[F] possible figure/table

[S] structural issue

[R] result available
```

These should be subtle and individually disableable.

---

# 31. Trigger Model

Avoid constant distraction.

Initial behavior:

### WRITE
Can run after a short typing pause.

### GUIDE
Run after sentence completion or explicit shortcut.

### EVIDENCE
Run explicitly or after paragraph completion.

### FIGURE/TABLE
Explicit trigger initially.

### STRUCTURE
Explicit trigger initially.

Users should eventually be able to customize this.

---

# 32. MVP Scope

The first genuinely useful version should support:

## Manuscript
- multi-file LaTeX project;
- current cursor/paragraph/section awareness;
- compiled manuscript handled by normal LaTeX tooling.

## Modes
- OFF;
- GUIDE;
- WRITE;
- EVIDENCE;
- FIGURE/TABLE;
- STRUCTURE.

## Project context
- `.tex`;
- `.bib`;
- `.pdf`;
- `.py`;
- `.csv`;
- `.json`;
- images/figures;
- optional `outline.md`.

## AI
- Codex App Server;
- Sign in with ChatGPT;
- structured responses.

## References
- BibTeX parsing;
- local PDF extraction;
- citation suggestion;
- exact source quotation;
- page navigation;
- highlighted evidence where extraction coordinates are available.

## Empirical results
- CSV/JSON indexing;
- data preview;
- relevant result retrieval;
- provenance on numerical claims.

## Figures
- registry of existing figures;
- figure/table suggestions;
- connection to relevant data where discoverable.

## Safety
- read-only suggestion modes;
- explicit acceptance before manuscript modifications.

That is enough to determine whether the central interaction model is genuinely useful.

---

# 33. Explicitly Out of Scope for the MVP

Do not initially build:

- cloud collaboration;
- accounts;
- custom LaTeX compiler infrastructure;
- journal submission;
- complete Zotero replacement;
- autonomous literature reviews;
- automatic experiment execution;
- automatic figure generation;
- perfect experiment lineage;
- multiplayer editing;
- mobile applications;
- proprietary document formats;
- large cloud vector database;
- elaborate agent swarm.

These features would distract from testing the fundamental product hypothesis.

---

# 34. Implementation Stack

Recommended:

```text
UI / extension
TypeScript
VS Code Extension API

Sidebar
React or lightweight webview UI

Local metadata
SQLite

PDF extraction
Python helper + PyMuPDF

Data handling
Python
pandas / pyarrow as needed

LaTeX structure
TypeScript parser / Tree-sitter-style parser

Code indexing
Python AST + ripgrep

AI
Codex App Server

Optional AI
OpenAI Responses API
Ollama/OpenAI-compatible local endpoint
```

There should be only two meaningful local processes beyond VS Code:

```text
research-indexer
codex app-server
```

The indexer can expose a small JSON-RPC interface to the extension.

---

# 35. Local Data Flow

Example: GUIDE request.

```text
User finishes sentence
        │
        ▼
VS Code detects cursor position
        │
        ▼
Locate LaTeX AST node
        │
        ▼
Context engine retrieves:
- current paragraph
- section objective
- outline node
- nearby results
- existing figures
        │
        ▼
Construct structured GUIDE request
        │
        ▼
Codex
        │
        ▼
Structured suggestion
        │
        ▼
Resolve evidence IDs locally
        │
        ▼
Render sidebar card
```

---

# 36. Evidence Data Flow

```text
Current sentence
        │
        ▼
Claim extraction
        │
        ├──────────────┐
        ▼              ▼
Reference search    Result search
        │              │
        ▼              ▼
PDF blocks        Result slices
        │              │
        └──────┬───────┘
               ▼
             Model
               │
               ▼
        Relevant evidence IDs
               │
               ▼
        UI loads exact objects
```

Crucially:

> The model identifies evidence. The local application displays the evidence.

This preserves provenance.

---

# 37. Figure Suggestion Data Flow

```text
Current Results subsection
          │
          ▼
Claims already discussed
          │
          ├───────────────┐
          ▼               ▼
Results registry      Figure registry
          │               │
          └───────┬───────┘
                  ▼
                Model
                  │
                  ▼
        Figure/table proposal
```

Possible decisions:

```text
Use existing figure
Modify existing figure
Create new figure
Use table instead
No visualization needed
```

The system should be permitted to recommend **no visualization**.

---

# 38. Persistent Section Memory

Each LaTeX section may maintain lightweight metadata:

```json
{
  "section_id": "results.constraint_strength",
  "summary": "...",
  "confirmed_evidence": [
    "result:beta_sweep.csv"
  ],
  "confirmed_references": [
    "bib:smith2024"
  ],
  "confirmed_figures": [
    "figure:beta_sweep.pdf"
  ]
}
```

This prevents every request from having to reconstruct the user's intent from scratch.

---

# 39. Research Context vs Conversation Context

These must remain distinct.

Conversation history answers:

> What have the user and AI discussed?

Research context answers:

> What is currently true about the paper and project?

Research context should always dominate stale conversational assumptions.

If `results.csv` changes, the indexed research state changes even if an old chat message says something different.

---

# 40. Inspection and Reproducibility

The user should be able to inspect:

```text
Prompt
Selected manuscript context
Retrieved references
Retrieved result slices
Model response
Applied changes
```

An optional local log may record these interactions.

This makes the AI layer debuggable in the same way that code is debuggable.

---

# 41. Development Stages

## Stage A — Interaction Prototype

Build:

- mode selector;
- GUIDE;
- WRITE;
- STRUCTURE;
- Codex App Server integration;
- basic LaTeX context.

Purpose:

Determine whether controlled-intervention writing actually feels useful.

---

## Stage B — Scientific Grounding

Add:

- `.bib`;
- reference PDFs;
- PDF search;
- exact quote display;
- citation provenance;
- CSV/JSON retrieval.

Purpose:

Make the assistant scientifically trustworthy.

---

## Stage C — Research Project Intelligence

Add:

- code indexing;
- figure registry;
- result-to-code associations;
- figure/table mode;
- evidence graph.

Purpose:

Move from “paper copilot” to “research copilot.”

---

## Stage D — Polished Research IDE

Only after the interaction model is validated:

- standalone desktop shell;
- custom editor layout;
- integrated manuscript PDF;
- richer reference manager;
- Zotero integration;
- collaboration;
- remote repositories.

---

# 42. Standalone Application Path

The VS Code extension should not become an architectural dead end.

Separate:

```text
research-core/
    indexing
    retrieval
    provenance
    modes
    model adapters

vscode-extension/
    VS Code-specific UI

desktop/
    future Tauri UI
```

The eventual desktop application can then reuse `research-core`.

Recommended future desktop stack:

```text
Tauri
TypeScript/React
Monaco or CodeMirror
PDF.js
local filesystem
Git
research-core
Codex App Server
```

---

# 43. Why Not Build the Standalone App First?

Because doing so requires immediately reproducing:

- editor behavior;
- syntax highlighting;
- filesystem navigation;
- Git;
- terminals;
- Python execution;
- notebook support;
- extension architecture;
- LaTeX tooling;
- keybindings;
- diagnostics.

None of those constitutes the novel product.

The novel product is:

\[
\boxed{
\text{mode-controlled AI}
+
\text{research-wide context}
+
\text{scientific provenance}
}
\]

Everything else should initially be borrowed from mature developer tooling.

---

# 44. Key Product Hypotheses

The MVP needs to answer four questions.

### H1 — Controlled intervention

Is switching among:

```text
WRITE
GUIDE
EVIDENCE
VISUAL
STRUCTURE
```

meaningfully better than a generic AI chat sidebar?

### H2 — Project-wide context

Does giving the AI access to code, data, figures, references, and outline materially improve scientific writing assistance?

### H3 — Provenance

Does making every important suggestion inspectably grounded make researchers willing to rely on the system?

### H4 — Authorship

Does GUIDE mode help the researcher retain their own writing voice substantially better than conventional AI-generated prose?

If these hypotheses hold, the product has a reason to exist independently of generic AI editors.

---

# 45. Primary Technical Risks

## Risk 1: Context retrieval quality

The system may retrieve technically related but scientifically irrelevant material.

Mitigation:

- section-specific context;
- user pinning;
- provenance;
- mode-specific retrieval;
- prioritize explicit links over embeddings.

---

## Risk 2: AI suggestions become distracting

Mitigation:

- modes;
- explicit trigger settings;
- GUIDE as default;
- no proactive chat messages;
- subtle UI.

---

## Risk 3: Hallucinated evidence

Mitigation:

- artifact IDs;
- exact locally retrieved quotations;
- result locators;
- never trust model-generated quotation strings.

---

## Risk 4: Repository becomes too large

Mitigation:

- incremental indexing;
- hierarchical summaries;
- targeted retrieval;
- explicit context budgets.

---

## Risk 5: Codex is too heavyweight for autocomplete

Mitigation:

- separate WRITE backend;
- optional local small model;
- optional API model;
- manual/less-frequent completion in subscription-only mode.

---

# 46. Definition of Successful MVP

The MVP is successful if a researcher can open an existing repository and perform the following workflow:

1. Open `results.tex`.
2. Select GUIDE.
3. Write a sentence in their own words.
4. Receive a useful suggestion about what the next sentence should accomplish.
5. Switch to WRITE.
6. Receive a short inline continuation.
7. Switch to EVIDENCE.
8. See an empirical result and/or reference supporting the current claim.
9. Click the reference.
10. See the exact supporting source passage in the PDF.
11. Switch to FIGURE/TABLE.
12. Receive a visualization recommendation based on actual project results.
13. Switch to STRUCTURE.
14. See what argumentative component remains missing from the section.
15. Inspect exactly which project artifacts caused each suggestion.

If that interaction feels natural, then the core product is validated.

---

# 47. Central Design Constraint

At all stages, preserve:

> **The AI should help the researcher think about what to write before it helps the researcher write it.**

That means the product should optimize first for:

```text
orientation
reasoning
evidence
organization
verification
```

and only secondarily for:

```text
text generation
```

That distinction is what separates Research Copilot from ordinary academic AI writing software.
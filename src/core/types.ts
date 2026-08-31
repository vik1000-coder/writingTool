export type Mode =
  "off" | "guide" | "write" | "evidence" | "visual" | "structure";
export type Lens =
  | "prose"
  | "argument"
  | "evidence"
  | "literature"
  | "results"
  | "visualization"
  | "structure";
export type ArtifactKind =
  | "tex"
  | "bib"
  | "pdf"
  | "result"
  | "code"
  | "figure"
  | "table"
  | "outline"
  | "note";
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  path: string;
  title: string;
  text: string;
  hash: string;
  locator: {
    start?: number;
    end?: number;
    line?: number;
    page?: number;
    bbox?: number[];
    rects?: number[][];
    rows?: number[];
    columns?: string[];
    [key: string]: unknown;
  };
  metadata: Record<string, unknown>;
}
export interface Relation {
  source: string;
  target: string;
  relation: string;
  confirmed: boolean;
}
export interface ProjectState {
  pins: string[];
  excluded: string[];
  relations: Relation[];
  sections: Record<string, { summary: string; evidence: string[] }>;
}
export interface ContextPacket {
  mode: Exclude<Mode, "off"> | "chat";
  lens: Lens;
  intervention: number;
  current: {
    path: string;
    offset: number;
    before: string;
    after: string;
    paragraph: string;
    headings: string[];
  };
  artifacts: Artifact[];
  excluded: string[];
  warnings: string[];
  sectionMemory?: { summary: string; evidence: string[] };
}
export interface NumericClaim {
  value: string;
  artifact_id: string;
  source_hash: string;
  row: number | null;
  column: string | null;
}
export interface EditProposal {
  path: string;
  original: string;
  replacement: string;
}
export interface Suggestion {
  source_notes?: { artifact_id: string; summary: string; relevance: string }[];
  mode: ContextPacket["mode"];
  title: string;
  text: string;
  insert_text: string;
  evidence_ids: string[];
  outline_ids: string[];
  citation_keys: string[];
  claims: NumericClaim[];
  proposal: {
    type: "figure" | "table" | "none";
    purpose: string;
    placement: string;
    data_ids: string[];
    existing_artifact_ids: string[];
    panels: string[];
  } | null;
  edit: EditProposal | null;
}
export interface ResolvedSuggestion {
  suggestion: Suggestion;
  evidence: Artifact[];
  warnings: string[];
  insertable: boolean;
  grounding: {
    value: string;
    status: "GROUNDED" | "UNGROUNDED";
    locator?: NumericClaim;
  }[];
}
export interface ResearchRequest {
  context: ContextPacket;
  prompt: string;
  signal?: AbortSignal;
}
export type ResearchEvent =
  { type: "status"; text: string } | { type: "result"; value: unknown };
export interface ResearchModelBackend {
  suggest(request: ResearchRequest): AsyncIterable<ResearchEvent>;
  dispose(): void;
}

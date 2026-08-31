import type { Mode, Lens } from "./types";
export const MODES: Record<
  Mode,
  { label: string; lens: Lens; intervention: number; description: string }
> = {
  off: {
    label: "OFF",
    lens: "argument",
    intervention: 0,
    description: "No suggestions. Explicit Chat remains available.",
  },
  guide: {
    label: "GUIDE",
    lens: "argument",
    intervention: 2,
    description: "Next-sentence purpose with grounded reference suggestions.",
  },
  write: {
    label: "WRITE",
    lens: "prose",
    intervention: 3,
    description: "A short continuation, accepted with Tab.",
  },
  evidence: {
    label: "EVIDENCE",
    lens: "evidence",
    intervention: 1,
    description: "Check this claim against sources and results.",
  },
  visual: {
    label: "FIGURE / TABLE",
    lens: "visualization",
    intervention: 2,
    description: "Plan a figure or table using actual project artifacts.",
  },
  structure: {
    label: "STRUCTURE",
    lens: "structure",
    intervention: 2,
    description: "Find the next missing part of the argument.",
  },
};
export function validateMode(value: unknown): Mode {
  if (typeof value !== "string" || !Object.hasOwn(MODES, value))
    throw new Error("Unknown assistance mode");
  return value as Mode;
}
export function shouldTrigger(
  mode: Mode,
  trigger: "explicit" | "automatic",
  prefix: string,
  automatic = false,
): boolean {
  if (mode === "off") return false;
  if (trigger === "explicit") return true;
  if (!automatic) return false;
  if (mode === "write") return Boolean(prefix.trim());
  if (mode === "guide") return /[.!?]["')\]]?\s*$/.test(prefix);
  return mode === "evidence" && /\n\s*\n$/.test(prefix);
}

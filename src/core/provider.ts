import type { ContextPacket } from "./types";

export type ProviderKind = "grok" | "codex" | "openai" | "local";
export type WriteProvider = ProviderKind | "same";

export function providerForMode(
  mode: ContextPacket["mode"] | "off",
  main: ProviderKind = "grok",
  write: WriteProvider = "same",
): ProviderKind {
  return mode === "write" && write !== "same" ? write : main;
}

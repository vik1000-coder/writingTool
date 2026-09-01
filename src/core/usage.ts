import type { ProviderKind } from "./provider";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface UsageSummary extends TokenUsage {
  totalTokens: number;
  costKind: "reported" | "estimated" | "unavailable";
}

export interface UsageSession {
  requests: number;
  pricedRequests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

// Standard USD per 1M-token rates checked 2026-09-01 against
// https://docs.x.ai/developers/pricing. Provider-reported cost wins when present.
const pricing: Record<
  string,
  {
    threshold: number;
    short: [input: number, cached: number, output: number];
    long: [input: number, cached: number, output: number];
  }
> = {
  "grok-4.6": {
    threshold: 200000,
    short: [2, 0.5, 6],
    long: [4, 1, 12],
  },
  "grok-4.3": {
    threshold: 200000,
    short: [1.25, 0.2, 2.5],
    long: [2.5, 0.4, 5],
  },
};

const cleanCount = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const roundedUsd = (value: number) => Math.round(value * 1e12) / 1e12;

function grokRate(model: string) {
  return Object.entries(pricing).find(
    ([name]) => model === name || model.startsWith(`${name}-`),
  )?.[1];
}

export function summarizeUsage(
  provider: ProviderKind,
  model: string,
  usage: TokenUsage,
): UsageSummary {
  const inputTokens = cleanCount(usage.inputTokens),
    cachedInputTokens = Math.min(
      inputTokens,
      cleanCount(usage.cachedInputTokens),
    ),
    outputTokens = cleanCount(usage.outputTokens),
    reported = usage.costUsd;
  if (Number.isFinite(reported) && reported! >= 0)
    return {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: roundedUsd(reported!),
      costKind: "reported",
    };
  const price = provider === "grok" ? grokRate(model) : undefined;
  if (!price)
    return {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costKind: "unavailable",
    };
  const [inputRate, cachedRate, outputRate] =
    inputTokens >= price.threshold ? price.long : price.short;
  const costUsd =
    ((inputTokens - cachedInputTokens) * inputRate +
      cachedInputTokens * cachedRate +
      outputTokens * outputRate) /
    1_000_000;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: roundedUsd(costUsd),
    costKind: "estimated",
  };
}

export const emptyUsageSession = (): UsageSession => ({
  requests: 0,
  pricedRequests: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
});

export function addSessionUsage(
  session: UsageSession,
  request: UsageSummary,
): UsageSession {
  return {
    requests: session.requests + 1,
    pricedRequests:
      session.pricedRequests + (request.costUsd === undefined ? 0 : 1),
    inputTokens: session.inputTokens + request.inputTokens,
    cachedInputTokens: session.cachedInputTokens + request.cachedInputTokens,
    outputTokens: session.outputTokens + request.outputTokens,
    totalTokens: session.totalTokens + request.totalTokens,
    costUsd: roundedUsd(session.costUsd + (request.costUsd ?? 0)),
  };
}

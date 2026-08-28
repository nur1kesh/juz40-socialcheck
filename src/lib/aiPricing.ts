// $/1M tokens, standard (non-long-context) rates. Update when switching
// models or when OpenAI changes pricing — there's no pricing API to read
// this from automatically.
const PRICING_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5.6-sol': { input: 5.0, output: 30.0 },
  'gpt-5.6-terra': { input: 2.0, output: 12.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

// Returns null for an unrecognized model rather than silently reporting $0
// — callers should treat null as "cost unknown", not "free".
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const pricing = PRICING_PER_MILLION_USD[model];
  if (!pricing) return null;
  return (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
}

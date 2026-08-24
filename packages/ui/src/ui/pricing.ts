/** Rough USD/1M-token pricing by model substring — shared estimator. */

const PRICING: Array<[RegExp, number, number]> = [
  [/gpt-4o-mini/i, 0.15, 0.6],
  [/gpt-4o/i, 2.5, 10],
  [/gpt-4\.1-mini/i, 0.4, 1.6],
  [/gpt-4\.1/i, 2, 8],
  [/gpt-5-mini/i, 0.4, 1.6],
  [/gpt-5/i, 1.25, 10],
  [/claude-sonnet/i, 3, 15],
  [/claude-haiku/i, 0.8, 4],
  [/claude-opus/i, 15, 75],
  [/deepseek/i, 0.27, 1.1],
  [/grok/i, 3, 15],
];

export function estimateCost(model: string, inTok: number, outTok: number): number | null {
  for (const [re, pin, pout] of PRICING) {
    if (re.test(model)) return (inTok / 1e6) * pin + (outTok / 1e6) * pout;
  }
  return null;
}

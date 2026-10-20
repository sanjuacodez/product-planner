/**
 * Estimated cost from recorded tokens. These are API list prices: subscription plans bill
 * differently, so the dashboard labels every figure as an estimate. Override or extend the
 * table with config.json → pricing.models (USD per million tokens), and update verifiedOn.
 */
export const PRICING = {
  verifiedOn: '2026-10-06',
  source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  // Cache writes: 1.25× input for the 5-minute TTL, 2× for the 1-hour TTL.
  cacheWrite5m: 1.25, cacheWrite1h: 2,
  models: {
    'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
    'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25 },
    'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
    'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
    'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
    'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5 },
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
    'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
    // Haiku 5.5 doubles in price above 100K prompt tokens; per-request size is not recorded, so the lower tier is used.
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
    'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  },
};

/** Strip host decorations such as date suffixes, provider prefixes and context tags. */
export function baseModelId(id) {
  return String(id || '').toLowerCase().replace(/^(?:anthropic\.|us\.anthropic\.|global\.anthropic\.)/, '').replace(/\[[^\]]*\]$/, '').replace(/[@-]\d{8}$/, '').replace(/-v\d+(?::\d+)?$/, '');
}

export function priceFor(id, overrides = {}) {
  const models = { ...PRICING.models, ...overrides };
  const base = baseModelId(id);
  if (models[base]) return { model: base, ...models[base] };
  // Longest known id that prefixes the reported one (for example a dated snapshot).
  const match = Object.keys(models).filter((k) => base.startsWith(k + '-')).sort((a, b) => b.length - a.length)[0];
  return match ? { model: match, ...models[match] } : null;
}

/** USD for one token record, or null when the model has no known price. */
export function costOf(tokens, id, overrides) {
  const p = priceFor(id, overrides);
  if (!p) return null;
  const write1h = Math.min(tokens.cacheWrite1h || 0, tokens.cacheWrite || 0);
  const write5m = (tokens.cacheWrite || 0) - write1h;
  return ((tokens.input || 0) * p.input + (tokens.output || 0) * p.output + (tokens.cacheRead || 0) * p.cacheRead
    + write5m * p.input * PRICING.cacheWrite5m + write1h * p.input * PRICING.cacheWrite1h) / 1e6;
}

/** "Sonnet 5.5" from "claude-sonnet-5-5"; custom names from config.json → dashboard.modelNames. */
export function modelLabel(id, names = {}) {
  if (!id) return '';
  if (names[id]) return names[id];
  const base = baseModelId(id);
  if (names[base]) return names[base];
  const m = base.match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?$/);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
  return id;
}

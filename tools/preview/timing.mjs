import { performance } from 'node:perf_hooks';

// Callers supply fixed stage names only; never URLs, errors or API payloads.
export function createTimings() {
  const start = performance.now();
  const stages = {};
  async function measure(name, operation) {
    const started = performance.now();
    try { return await operation(); }
    finally {
      const row = stages[name] ??= { calls: 0, ms: 0 };
      row.calls++;
      row.ms += performance.now() - started;
    }
  }
  function snapshot() {
    return { totalMs: Math.round(performance.now() - start), stages: Object.fromEntries(
      Object.entries(stages).map(([name, row]) => [name, { calls: row.calls, ms: Math.round(row.ms) }])) };
  }
  return { measure, snapshot };
}

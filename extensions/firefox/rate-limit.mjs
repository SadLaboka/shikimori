// Fit a complete five-request publication into Shikimori's 5 rps budget.
// Keep a 100 ms second-window margin and headroom below 90 rpm.
// Count completed requests and all in-flight reservations. A slow response
// occupies its slot until completion, so persistence/IPC delays cannot cause
// a burst beyond the limit. Session state survives event-page restarts.
export const API_WINDOWS = Object.freeze([
  Object.freeze({ count: 5, period: 1100 }),
  Object.freeze({ count: 80, period: 60025 }),
]);
const STORAGE_KEY = 'apiRateEntries';
export class ApiRateLimiter {
  constructor({ storage = null, now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), windows = API_WINDOWS } = {}) {
    Object.assign(this, { storage, now, sleep, windows });
    this.entries = []; this.loaded = false; this.tail = Promise.resolve(); this.waiters = new Set();
  }
  serial(action) {
    const result = this.tail.then(action);
    this.tail = result.catch(() => {});
    return result;
  }
  async load() {
    if (this.loaded) return;
    const state = this.storage ? await this.storage.get(STORAGE_KEY) : {};
    const saved = state[STORAGE_KEY];
    const now = this.now(), longest = Math.max(...this.windows.map(window => window.period));
    this.entries = (Array.isArray(saved) ? saved : []).filter(entry =>
      typeof entry?.id === 'string' && Number.isFinite(entry.at) && (entry.pending || entry.at > now - longest)
    ).map(entry => ({ id: entry.id, at: entry.pending ? now : entry.at, pending: false }));
    this.loaded = true;
  }
  persist() {
    return this.storage ? this.storage.set({ [STORAGE_KEY]: this.entries.map(entry => ({ ...entry })) }) : Promise.resolve();
  }
  async reserve() {
    while (true) {
      const decision = await this.serial(async () => {
        await this.load();
        const now = this.now(), longest = Math.max(...this.windows.map(window => window.period));
        this.entries = this.entries.filter(entry => entry.pending || entry.at > now - longest);
        const full = this.windows.map(window => ({ ...window,
          entries: this.entries.filter(entry => entry.pending || entry.at > now - window.period),
        })).filter(window => window.entries.length >= window.count);
        if (!full.length) {
          const id = crypto.randomUUID();
          this.entries.push({ id, at: now, pending: true });
          try { await this.persist(); }
          catch (error) { this.entries = this.entries.filter(entry => entry.id !== id); throw error; }
          return { id };
        }
        let waitMs = 1;
        for (const window of full) {
          const completed = window.entries.filter(entry => !entry.pending);
          if (!completed.length) {
            return { changed: new Promise(resolve => this.waiters.add(resolve)) };
          }
          waitMs = Math.max(waitMs, Math.min(...completed.map(entry => entry.at)) + window.period - now + 1);
        }
        return { waitMs };
      });
      if (decision.id) return decision.id;
      if (decision.changed) await decision.changed;
      else await this.sleep(decision.waitMs);
    }
  }
  async complete(id) {
    try {
      await this.serial(async () => {
        const entry = this.entries.find(entry => entry.id === id);
        if (entry) { entry.at = this.now(); entry.pending = false; await this.persist(); }
      });
    } finally {
      const waiters = [...this.waiters]; this.waiters.clear();
      for (const resolve of waiters) resolve();
    }
  }
  async run(action) {
    const id = await this.reserve();
    try { return await action(); } finally { await this.complete(id); }
  }
}

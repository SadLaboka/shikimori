import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRateLimiter } from '../extensions/firefox/rate-limit.mjs';

function fixture({ persistenceDelay = 0 } = {}) {
  let time = 0; const state = {}; const sleeps = []; const control = { fail: false };
  const now = () => time;
  const sleep = async ms => { sleeps.push(ms); time += ms; };
  const storage = {
    async get(key) { return structuredClone({ [key]: state[key] }); },
    async set(value) { if (control.fail) throw Error('Test storage failure'); time += persistenceDelay; Object.assign(state, structuredClone(value)); },
  };
  return { now, sleep, storage, sleeps, state, control, advance: ms => { time += ms; },
    make: () => new ApiRateLimiter({ now, sleep, storage }) };
}
function checkWindows(starts) {
  for (const at of starts) {
    assert.ok(starts.filter(time => time > at - 1000 && time <= at).length <= 4, 'Second burst limit exceeded');
    assert.ok(starts.filter(time => time > at - 60000 && time <= at).length <= 80, 'Minute limit exceeded');
  }
}
test('short burst has no fixed delays; subsequent requests obey second and minute budgets', async () => {
  const f = fixture(), limiter = f.make(), starts = [];
  for (let i = 0; i < 4; i++) await limiter.run(() => starts.push(f.now()));
  assert.deepEqual(starts, [0, 0, 0, 0]); assert.equal(f.sleeps.length, 0);
  for (let i = 4; i < 85; i++) await limiter.run(() => starts.push(f.now()));
  assert.ok(starts[4] >= 1025); assert.ok(starts[80] >= 60025);
  checkWindows(starts);
});
test('persisted budget survives background restart', async () => {
  const f = fixture(), first = f.make();
  for (let i = 0; i < 4; i++) await first.run(() => {});
  let dispatched;
  await f.make().run(() => { dispatched = f.now(); });
  assert.ok(dispatched >= 1025);
});
test('unfinished persisted reservations get a fresh conservative window after a crash', async () => {
  const f = fixture(), first = f.make();
  for (let i = 0; i < 4; i++) await first.reserve();
  f.advance(2000); const restartedAt = f.now(); let dispatched;
  await f.make().run(() => { dispatched = f.now(); });
  assert.ok(dispatched >= restartedAt + 1025);
});
test('concurrent callers cannot exceed the in-flight budget or deadlock completion', async () => {
  const f = fixture(), limiter = f.make(), started = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = Array.from({ length: 5 }, (_, index) => limiter.run(async () => { started.push(index); if (index < 4) await gate; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3]);
  release(); await Promise.all(calls);
  assert.deepEqual(started, [0, 1, 2, 3, 4]); assert.ok(f.now() >= 1025);
});
test('slow persistence and network responses cannot move actual dispatch outside the budget', async () => {
  const f = fixture({ persistenceDelay: 180 }), limiter = f.make(), starts = [];
  for (let i = 0; i < 20; i++) await limiter.run(async () => { starts.push(f.now()); f.advance(80); });
  checkWindows(starts);
});
test('failed requests consume their rate slot and are never retried by the scheduler', async () => {
  const f = fixture(), limiter = f.make(); let attempts = 0;
  for (let i = 0; i < 4; i++) await assert.rejects(limiter.run(() => { attempts++; throw Error('network'); }));
  await limiter.run(() => { attempts++; });
  assert.equal(attempts, 5); assert.ok(f.now() >= 1025);
});
test('reservation persistence failure stops dispatch without poisoning the scheduler', async () => {
  const f = fixture(), limiter = f.make(); let attempts = 0;
  f.control.fail = true;
  await assert.rejects(limiter.run(() => { attempts++; })); assert.equal(attempts, 0);
  f.control.fail = false;
  await limiter.run(() => { attempts++; }); assert.equal(attempts, 1);
});

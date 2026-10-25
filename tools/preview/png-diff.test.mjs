import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { comparePng } from './png-diff.mjs';
import { createTimings } from './timing.mjs';

// Independent reference: the original algorithm always allocates and pads.
function reference(before, after) {
  const width = Math.max(before.width, after.width), height = Math.max(before.height, after.height);
  const pad = image => {
    const output = new PNG({ width, height });
    output.data.fill(255);
    for (let y = 0; y < image.height; y++) image.data.copy(output.data, y * width * 4, y * image.width * 4, (y + 1) * image.width * 4);
    return output.data;
  };
  const result = new PNG({ width, height });
  const pixels = pixelmatch(pad(before), pad(after), result.data, width, height, { threshold: 0.1 });
  return { pixels, result };
}

test('PNG fast path preserves original diff bytes, counts, sizes and inputs', () => {
  for (const [w, h] of [[17, 11], [13, 11], [17, 9], [19, 15], [19, 9]]) {
    const before = new PNG({ width: 17, height: 11 }), after = new PNG({ width: w, height: h });
    // Opaque and transparent pixels, identical images and changed edges.
    for (const image of [before, after]) for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 37 + 19) % 256;
    for (const changed of [false, true]) {
      if (changed) after.data.fill(255, 0, 16);
      const inputs = [Buffer.from(before.data), Buffer.from(after.data)];
      const expected = reference(before, after), actual = comparePng(before, after);
      assert.equal(actual.pixels, expected.pixels);
      assert.deepEqual(actual.result.data, expected.result.data);
      assert.deepEqual(PNG.sync.write(actual.result), PNG.sync.write(expected.result));
      assert.equal(actual.sizeChanged, w !== 17 || h !== 11);
      assert.deepEqual(actual.beforeSize, { width: 17, height: 11 });
      assert.deepEqual(actual.afterSize, { width: w, height: h });
      assert.equal(actual.ratio, expected.pixels / (Math.max(w, 17) * Math.max(h, 11)));
      assert.deepEqual(before.data, inputs[0]);
      assert.deepEqual(after.data, inputs[1]);
    }
  }
});

test('timings preserve returns and failures and emit numeric aggregates only', async () => {
  const timings = createTimings();
  const value = {};
  assert.equal(await timings.measure('stage', async () => value), value);
  const failure = new Error('PRIVATE_SENTINEL');
  await assert.rejects(timings.measure('stage', async () => { throw failure; }), error => error === failure);
  const result = timings.snapshot();
  assert.equal(result.stages.stage.calls, 2);
  assert.ok(result.totalMs >= 0 && result.stages.stage.ms >= 0);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

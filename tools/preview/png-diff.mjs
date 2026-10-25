import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// Equal dimensions need no padding: the original RGBA bytes are identical to
// the former padded copy. Keep white padding for genuine size differences.
export function comparePng(before, after) {
  const canvas = { width: Math.max(before.width, after.width), height: Math.max(before.height, after.height) };
  const padded = input => {
    if (input.width === canvas.width && input.height === canvas.height) return input.data;
    const png = new PNG(canvas);
    png.data.fill(255);
    for (let y = 0; y < input.height; y++) {
      input.data.copy(png.data, y * canvas.width * 4, y * input.width * 4, (y + 1) * input.width * 4);
    }
    return png.data;
  };
  const result = new PNG(canvas);
  const pixels = pixelmatch(padded(before), padded(after), result.data, canvas.width, canvas.height, { threshold: 0.1 });
  return { result, pixels, ratio: pixels / (canvas.width * canvas.height),
    beforeSize: { width: before.width, height: before.height },
    afterSize: { width: after.width, height: after.height },
    sizeChanged: before.width !== after.width || before.height !== after.height };
}

import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {assembleCss, sha256} from './build-css.mjs';
import {recolorCss} from './build-emerald-scarlet.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const variants = ['1-1', '1-2', '2-1', '2-2'];
const gold = {light: '255, 216, 66', deep: '193, 151, 34', dark: '83, 68, 25', hex: '#ffd842'};
const jade = {light: '59, 235, 192', deep: '30, 166, 134', dark: '15, 65, 53', hex: '#3bebc0'};

export function variantSpec(variant) {
  if (!variants.includes(variant)) throw new Error('Variant must be 1-1, 1-2, 2-1 or 2-2.');
  const mirrored = variant.startsWith('2');
  const reversed = mirrored !== variant.endsWith('2');
  const [left, right] = reversed ? [jade, gold] : [gold, jade];
  const colors = {
    hex: {'#333dff': left.hex, '#99003e': right.hex, '#bd0f56': right.hex},
    rgb: {'51,61,255': left.light, '189,15,86': right.light,
      '153,0,62': right.deep, '30,38,185': left.deep,
      '1,4,75': left.dark, '20,20,20': '17, 21, 19'},
  };
  const palette = `/* Variant ${variant.replace('-', '.')}: ${mirrored ? 'mirrored and swapped' : 'original'} images; ${variant.endsWith('2') ? 'opposite' : 'matching'} accents. */
html:root {
  --gj-left: ${left.light};
  --gj-left-deep: ${left.deep};
  --gj-left-dark: ${left.dark};
  --gj-right: ${right.light};
  --gj-right-deep: ${right.deep};
  --gj-positions: left center, right center;
  --gj-mirror: ${mirrored ? '-1' : '1'};
}
`;
  return {colors, palette};
}

export async function assembleVariant(variant, workspace = root) {
  const spec = variantSpec(variant);
  const base = (await assembleCss(workspace)).toString('utf8');
  const palette = await readFile(path.join(workspace, 'css/themes/gold-jade/palette.css'), 'utf8');
  const overrides = variant === '2-2'
    ? '\n' + await readFile(path.join(workspace, 'css/themes/gold-jade/variants/2-2/overrides.css'), 'utf8') : '';
  return Buffer.from(recolorCss(base, spec.colors) + '\n' + spec.palette + '\n' + palette + overrides);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options: {variant: {type: 'string', default: '2-2'}, candidate: {type: 'boolean'}, write: {type: 'boolean'}, check: {type: 'boolean'}}});
    if ([values.candidate, values.write, values.check].filter(Boolean).length !== 1)
      throw new Error('Choose --candidate, --write or --check.');
    const variant = values.variant;
    const bytes = await assembleVariant(variant);
    const candidate = `.preview/yoruichi-ulquiorra/${variant}/candidate.css`;
    const target = values.candidate ? candidate : `css/themes/gold-jade/variants/${variant}/styles.css`;
    const targets = !values.candidate && variant === '2-2' ? [target, 'css/themes/gold-jade/styles.css'] : [target];
    if (values.check) {
      for (const file of targets)
        if (!bytes.equals(await readFile(path.join(root, file)))) throw new Error(`Variant CSS is stale: ${file}`);
    } else {
      if (values.write && !bytes.equals(await readFile(path.join(root, candidate))))
        throw new Error('Candidate differs. Rebuild and verify it first.');
      for (const file of targets) {
        await mkdir(path.dirname(path.join(root, file)), {recursive: true});
        await writeFile(path.join(root, file), bytes);
      }
    }
    console.log(JSON.stringify({variant, output: targets, bytes: bytes.length, sha256: sha256(bytes)}));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

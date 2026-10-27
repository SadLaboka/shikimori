import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {assembleCss, sha256} from './build-css.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const theme = 'css/themes/emerald-scarlet';
export const candidate = '.preview/emerald-scarlet/candidate.css';
export const output = `${theme}/styles.css`;

// Only color literals are translated. RGB alpha, keyframe timing, layout,
// URLs, external imports and the original source files stay intact.
export function recolorCss(css, colors) {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\((?:\\.|[^)\\])*\)|#[\da-f]{6}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?=\s*[,\)])/gi, value => {
    if (value.startsWith('#')) return colors.hex[value.toLowerCase()] ?? value;
    if (!/^rgba?\(/i.test(value)) return value;
    const key = value.slice(value.indexOf('(') + 1).replace(/\s/g, '');
    return colors.rgb[key] ? `${value.slice(0, value.indexOf('(') + 1)}${colors.rgb[key]}` : value;
  });
}

export async function assembleVariant(workspace = root) {
  const colors = JSON.parse(await readFile(path.join(workspace, theme, 'colors.json'), 'utf8'));
  const base = (await assembleCss(workspace)).toString('utf8');
  const palette = await readFile(path.join(workspace, theme, 'palette.css'), 'utf8');
  return Buffer.from(recolorCss(base, colors) + '\n' + palette);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {values} = parseArgs({options: {candidate: {type: 'boolean'}, write: {type: 'boolean'}, check: {type: 'boolean'}}});
    if (Object.values(values).filter(Boolean).length !== 1) throw new Error('Choose --candidate, --write or --check.');
    const bytes = await assembleVariant();
    const target = values.candidate ? candidate : output;
    if (values.check) {
      if (!bytes.equals(await readFile(path.join(root, target)))) throw new Error('Alternative CSS is stale.');
    } else {
      if (values.write && !bytes.equals(await readFile(path.join(root, candidate))))
        throw new Error('Candidate differs. Rebuild and verify the candidate first.');
      await mkdir(path.dirname(path.join(root, target)), {recursive: true});
      await writeFile(path.join(root, target), bytes);
    }
    console.log(JSON.stringify({output: target, bytes: bytes.length, sha256: sha256(bytes)}, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

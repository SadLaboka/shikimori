// Only writes disposable files under .preview; never edits the working CSS.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { LAYOUT_SOURCE } from './css.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const current = await readFile(path.join(root, 'styles_optimized.css'), 'utf8');
const compiledPath = process.argv[2];
if (!compiledPath) throw new Error('Pass a saved pre-migration published-compiled.css path.');
const compiled = await readFile(path.resolve(root, compiledPath), 'utf8');
if (!compiled.includes(`/* ${LAYOUT_SOURCE} */`)) throw new Error('Historical import marker missing.');
const target = /  #profiles_show \.profile-content > \.cc-2 > \.c-left \{\r?\n[\s\S]*?\r?\n  \}/g;
if ([...current.matchAll(target)].length !== 1) throw new Error('Expected one left-column rule to omit.');
const missing = current.replace(target, '/* Intentionally omitted left-column rule for audit */');
const module = /\/\* BEGIN LOCAL PROFILE LAYOUT[\s\S]*?\/\* END LOCAL PROFILE LAYOUT \*\//g;
if ([...current.matchAll(module)].length !== 1) throw new Error('Local module markers missing or duplicated.');
const anchor = '/* Замена стандартных постеров */';
if (current.split(anchor).length !== 2) throw new Error('Import insertion anchor is not unique.');
const historical = current.replace(module, '').replace(anchor, `@import url("${LAYOUT_SOURCE}");\n${anchor}`);
const output = path.join(root, '.preview/layout-audit-input');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'missing-rule.css'), missing);
await writeFile(path.join(output, 'historical-source.css'), historical);
await writeFile(path.join(output, 'historical-compiled.css'), compiled);
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  mainHash: createHash('sha256').update(current).digest('hex'),
  omittedSelector: '#profiles_show .profile-content > .cc-2 > .c-left',
  historicalCompiledSource: compiledPath,
  note: 'Historical raw source reconstructed; its CSSOM must match the saved real compiled baseline.',
}, null, 2));
console.log('Created .preview/layout-audit-input; main CSS unchanged.');

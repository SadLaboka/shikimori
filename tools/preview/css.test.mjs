import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCompiled, extractLocal, assertSameImports, prepareUser, joinCompiled, planFoundation, LAYOUT_SOURCE } from './css.mjs';

test('extracts imports after an earlier media query without discarding that query', () => {
  const source = '/* AUTO=sticky */ @media(min-width:1025px){a{position:sticky}}\n@import url("https://a.test/a.css");\n@import "https://a.test/b.css";\nb{color:red}';
  const result = extractLocal(source);
  assert.deepEqual(result.imports, ['https://a.test/a.css', 'https://a.test/b.css']);
  assert.match(result.user, /@media/);
  assert.match(result.user, /b\{color:red\}/);
  assert.doesNotMatch(result.user, /@import/);
});

test('boundary must be unique and replacement removes the old user rules', () => {
  const text = '/* https://a.test/a.css */a{color:red}\n/* User Custom Styles */b{color:blue}';
  const parts = splitCompiled(text);
  const next = joinCompiled(parts.foundation, 'b{color:green}');
  assert.equal(splitCompiled(next).foundation, parts.foundation);
  assert.doesNotMatch(next, /blue/);
  assert.throws(() => splitCompiled('a{}'));
  assert.throws(() => splitCompiled(text + '/* User Custom Styles */'));
});

test('refuses changed imports and qualified imports instead of silently overlaying', () => {
  assert.throws(() => assertSameImports(['a'], ['b'], ''));
  assert.throws(() => extractLocal('@import url("a") screen;'));
  assert.throws(() => assertSameImports(['https://a.test/a'], ['https://a.test/a'], ''));
});

test('matches the observed media-wrapper decision; keeps existing malformed tokens', () => {
  assert.match(prepareUser('a{color:red}'), /^@media only screen and \(min-width: 1024px\)/);
  assert.equal(prepareUser('/* AUTO=x */ @media(min-width:1px){a{color:red}}\n*/'), '@media(min-width:1px){a{color:red}}\n*/');
});

test('profile-layout migration removes only its original foundation section', () => {
  const foundation = `/* https://a.test/base.css */a{color:red}\n/* ${LAYOUT_SOURCE} */@media(min-width:768px){b{width:77%}}\n/* https://a.test/posters.css */b{color:blue}\n`;
  const published = `@import url("https://a.test/base.css");@import url("${LAYOUT_SOURCE}");@import url("https://a.test/posters.css");`;
  const local = '@import url("https://a.test/base.css");@import url("https://a.test/posters.css");/* BEGIN LOCAL PROFILE LAYOUT */b{width:77%}/* END LOCAL PROFILE LAYOUT */';
  const result = planFoundation(local, published, foundation);
  assert.equal(result.foundation, '/* https://a.test/base.css */a{color:red}\n/* https://a.test/posters.css */b{color:blue}\n');
  assert.match(result.migration.originalBlock, /width:77%/);
  assert.throws(() => planFoundation(local.replace('BEGIN LOCAL PROFILE LAYOUT', 'unmarked'), published, foundation));
  assert.throws(() => planFoundation(local.replace('base.css', 'different.css'), published, foundation));
});

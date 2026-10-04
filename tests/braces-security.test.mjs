import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const braces = require('braces');
const nested = (depth, open = '{', close = '}') => open.repeat(depth) + 'a,b' + close.repeat(depth);
const guarded = run => assert.throws(run, error => error instanceof SyntaxError && /nesting.*depth/i.test(error.message));

void test('deep brace, parentheses and mixed patterns stop before recursive processing', () => {
  for (const pattern of [nested(3500), nested(3500, '(', ')'), nested(1500, '{(', ')}')]) {
    for (const call of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) guarded(() => call(pattern));
  }
  guarded(() => braces(nested(101), { maxDepth: Infinity }));
  assert.doesNotThrow(() => braces.compile(nested(100)));
});

void test('pre-built ASTs cannot bypass recursion guards or loop through cyclic parents', () => {
  let ast = { type: 'text', value: 'a' };
  for (let depth = 0; depth < 3500; depth++) ast = { type: 'paren', nodes: [ast] };
  for (const call of [braces.compile, braces.expand, braces.stringify]) guarded(() => call(ast));
  const parent = { type: 'paren' }; parent.parent = parent;
  const child = { type: 'paren', nodes: [], parent };
  guarded(() => braces.expand(child));
});

void test('ordinary glob patterns, ranges, quoted and escaped literals keep their meaning', () => {
  assert.deepEqual(braces.expand('src/{components,features}/**/*.{ts,tsx}'), ['src/components/**/*.ts','src/components/**/*.tsx','src/features/**/*.ts','src/features/**/*.tsx']);
  assert.equal(braces.compile('src/{components,features}/**/*.{ts,tsx}'), 'src/(components|features)/**/*.(ts|tsx)');
  assert.deepEqual(braces.expand('file{01..03}.{js,ts}'), ['file01.js','file01.ts','file02.js','file02.ts','file03.js','file03.ts']);
  assert.deepEqual(braces.expand('{{a,b},c}'), ['a','b','c']);
  assert.deepEqual(braces.expand('{a,b,a}', { nodupes: true }), ['a','b']);
  for (const pattern of ['"' + '{'.repeat(150) + '"', '\\{'.repeat(150), '[' + '{'.repeat(150) + ']']) assert.doesNotThrow(() => braces.compile(pattern));
  const micromatch = require('micromatch');
  assert.deepEqual(micromatch(['src/app.ts','src/app.tsx','src/app.css'],'src/*.{ts,tsx}'), ['src/app.ts','src/app.tsx']);
  guarded(() => micromatch.braces(nested(3500)));
});

void test('hardening verifies nested installs, is idempotent and refuses unknown source bytes', async () => {
  await mkdir('.ui-review', { recursive: true });
  const fixture = await mkdtemp(join(process.cwd(), '.ui-review', 'braces-security-'));
  await mkdir(join(fixture,'scripts'));
  const script = join(fixture,'scripts','harden-braces.mjs');
  await copyFile('scripts/harden-braces.mjs',script);
  const files = ['constants','parse','compile','expand','stringify'];
  const installations = [join(fixture,'node_modules','braces'),join(fixture,'node_modules','@fixture','tool','node_modules','braces')];
  for (const installed of installations) {
    await mkdir(join(installed,'lib'),{recursive:true});
    await writeFile(join(installed,'package.json'),JSON.stringify({name:'braces',version:'3.0.3'}));
    for (const name of files) await copyFile(require.resolve('braces/lib/'+name),join(installed,'lib',name+'.js'));
  }
  assert.match(execFileSync(process.execPath,[script],{encoding:'utf8'}),/verified 2 installation\(s\); hardened 0 file/);
  const changed = join(installations[1],'lib','parse.js');
  await writeFile(changed,(await readFile(changed,'utf8'))+'\n// unrecognized dependency modification\n');
  const paths = installations.flatMap(installed=>files.map(name=>join(installed,'lib',name+'.js')));
  const before = await Promise.all(paths.map(path=>readFile(path,'utf8')));
  const result = spawnSync(process.execPath,[script],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Unrecognized braces parse.js/);
  assert.deepEqual(await Promise.all(paths.map(path=>readFile(path,'utf8'))),before,'unknown dependency bytes must never be partially rewritten');
});

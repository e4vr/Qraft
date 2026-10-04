// GHSA-vfj7-8cjw-p6xm / CVE-2026-93687. Apply a reversible, hash-verified
// local patch until upstream publishes a fixed package. Never alter its version.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const hash = source => createHash('sha256').update(source).digest('hex');
const astGuard = "    if (depth > MAX_DEPTH + 1) throw new SyntaxError('AST nesting exceeds maximum depth (100)');\n";
const parseGuard = "      if (stack.length > MAX_DEPTH) throw new SyntaxError('Input nesting exceeds maximum depth (100)');\n";
const parentGuard = "      if (++parentSteps > MAX_DEPTH + 1) throw new SyntaxError('AST parent nesting exceeds maximum depth (100)');\n";
const blockGuard = "      if (++blockSteps > MAX_DEPTH + 1) throw new SyntaxError('AST parent nesting exceeds maximum depth (100)');\n";
const importDepth = ["const utils = require('./utils');", "const utils = require('./utils');\nconst { MAX_DEPTH } = require('./constants');"];
const recipes = [
  ['constants', 'c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b', [["  MAX_LENGTH: 10000,", "  MAX_LENGTH: 10000,\n  MAX_DEPTH: 100,"]]],
  ['parse', 'e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310', [
    ['  MAX_LENGTH,', '  MAX_LENGTH,\n  MAX_DEPTH,'],
    ['    if (value === CHAR_LEFT_PARENTHESES) {\n', '    if (value === CHAR_LEFT_PARENTHESES) {\n' + parseGuard],
    ['    if (value === CHAR_LEFT_CURLY_BRACE) {\n', '    if (value === CHAR_LEFT_CURLY_BRACE) {\n' + parseGuard],
  ]],
  ['compile', 'dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f', [importDepth,
    ['  const walk = (node, parent = {}) => {\n', '  const walk = (node, parent = {}, depth = 0) => {\n' + astGuard],
    ['walk(child, node);', 'walk(child, node, depth + 1);'],
  ]],
  ['expand', '41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7', [importDepth,
    ['  const walk = (node, parent = {}) => {\n', '  const walk = (node, parent = {}, depth = 0) => {\n' + astGuard],
    ['    let p = parent;', '    let parentSteps = 0;\n    let p = parent;'],
    ["    while (p.type !== 'brace' && p.type !== 'root' && p.parent) {\n", "    while (p.type !== 'brace' && p.type !== 'root' && p.parent) {\n" + parentGuard],
    ['    let block = node;', '    let blockSteps = 0;\n    let block = node;'],
    ["    while (block.type !== 'brace' && block.type !== 'root' && block.parent) {\n", "    while (block.type !== 'brace' && block.type !== 'root' && block.parent) {\n" + blockGuard],
    ['walk(child, node);', 'walk(child, node, depth + 1);'],
  ]],
  ['stringify', '379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a', [importDepth,
    ['  const stringify = (node, parent = {}) => {\n', '  const stringify = (node, parent = {}, depth = 0) => {\n' + astGuard],
    ['stringify(child);', 'stringify(child, {}, depth + 1);'],
  ]],
];

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Unexpected braces source; refusing to apply a partial security patch.');
  return source.replace(before, after);
}
function transform(source, replacements, reverse = false) {
  for (const [before, after] of reverse ? [...replacements].reverse() : replacements)
    source = reverse ? replaceOnce(source, after, before) : replaceOnce(source, before, after);
  return source;
}
async function installations(modules) {
  let entries;
  try { entries = await readdir(modules, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(modules, entry.name);
    if (entry.name.startsWith('@')) { found.push(...await installations(path)); continue; }
    if (entry.name === 'braces') found.push(path);
    found.push(...await installations(join(path, 'node_modules')));
  }
  return found;
}

const paths = await installations(root), updates = [];
for (const path of paths) {
  const metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  if (metadata.version !== '3.0.3') throw new Error(`Review braces ${String(metadata.version)} before removing/replacing the 3.0.3 security patch.`);
  for (const [name, expected, replacements] of recipes) {
    const file = await realpath(join(path, 'lib', name + '.js'));
    const within = relative(await realpath(root), file);
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('Refusing to patch braces outside this checkout.');
    const current = await readFile(file, 'utf8');
    const original = hash(current) === expected ? current : transform(current, replacements, true);
    if (hash(original) !== expected) throw new Error(`Unrecognized braces ${String(name)}.js; restore with npm ci and review upstream changes.`);
    const hardened = transform(original, replacements);
    if (current !== hardened) updates.push({ file, hardened });
  }
}
// Validate every file first; atomic file replacements make an interrupted patch
// safe to rerun. npm ci obtains pristine package bytes using lockfile integrity.
for (const { file, hardened } of updates) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, hardened);
  await rename(temporary, file);
}
console.log(`braces security: verified ${paths.length} installation(s); hardened ${updates.length} file(s), nesting limit 100.`);

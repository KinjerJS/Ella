/**
 * Reads the installed Blockbench app.asar and checks which plugin APIs actually exist,
 * so the plugin is written against this build rather than from memory.
 *
 * Not part of the plugin — a development aid, kept so the check can be repeated when
 * Blockbench updates.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const asarPath = path.join(
  process.env.LOCALAPPDATA,
  'Programs', 'Blockbench', 'resources', 'app.asar',
);

const buffer = readFileSync(asarPath);
const headerPickleSize = buffer.readUInt32LE(4);
const headerStringSize = buffer.readUInt32LE(12);
const header = JSON.parse(buffer.toString('utf8', 16, 16 + headerStringSize));
const baseOffset = 8 + headerPickleSize;

function* walk(node, prefix = '') {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const full = prefix ? `${prefix}/${name}` : name;
    if (child.files) yield* walk(child, full);
    else yield [full, child];
  }
}

const entries = [...walk(header)];
const bundle = entries.find(([name]) => name === 'dist/bundle.js');
const start = baseOffset + Number(bundle[1].offset);
const source = buffer.toString('utf8', start, start + Number(bundle[1].size));

const probes = [
  'save_project',
  'trigger()',
  '.trigger(',
  'Codecs.project',
  'Codecs[',
  'new Codec(',
  'format.codec',
  'Project.format',
  'saveFile(',
  'export(',
  'compile(',
  'Blockbench.writeFile',
  'Blockbench.showQuickMessage',
  'Plugin.register',
  'onunload',
  'about:',
];

console.log('API probes:');
for (const probe of probes) {
  const count = source.split(probe).length - 1;
  console.log('  ', probe.padEnd(26), count > 0 ? `found (${count})` : 'NOT FOUND');
}

console.log('\ncodec ids registered:');
const codecIds = new Set(
  (source.match(/new Codec\(['"]([\w_]+)['"]/g) ?? []).map((m) => m.replace(/.*['"]([\w_]+)['"].*/, '$1')),
);
console.log('  ', [...codecIds].sort().join(', ').slice(0, 400) || '(none matched)');

console.log('\nsave-related identifiers:');
for (const pattern of [/save_project[\w.]*/g, /saveFile\s*\([^)]{0,40}/g]) {
  const found = new Set((source.match(pattern) ?? []).slice(0, 12));
  console.log('  ', [...found].join(' | ').slice(0, 300));
}

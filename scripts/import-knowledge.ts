import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { archiveSchema, buildKnowledge, extractDocx } from '../server/ai/knowledge-import.ts';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run knowledge:import -- <reviewed.docx | archived.source.json>');
if ((await stat(input)).size > 10 * 1024 * 1024) throw new Error('Input exceeds 10 MiB');
const bytes = await readFile(input);
const archive = extname(input).toLowerCase() === '.docx' ? extractDocx(bytes, basename(input)) : archiveSchema.parse(JSON.parse(bytes.toString('utf8')));
const knowledge = buildKnowledge(archive);
// Validate fully before touching either output. The archive is a tracked, inference-free rebuild input.
const directory = new URL('../server/ai/knowledge/', import.meta.url);
await writeFile(new URL('window-of-world.source.json', directory), `${JSON.stringify(archive, null, 2)}\n`);
await writeFile(new URL('window-of-world.json', directory), `${JSON.stringify(knowledge, null, 2)}\n`);
console.log(`Imported ${knowledge.entries.length} entries, ${knowledge.sources.length} sources; snapshot ${knowledge.document.snapshot_date}; sha256 ${archive.sha256}`);

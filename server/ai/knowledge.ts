// Migrated from VirtourV2/server/knowledge.js; the snapshot is not verified live data.
import { readFileSync } from 'node:fs';

interface Source { id: string; title: string; url: string; accessed_at: string; published_at: string; verification: string }
interface Entry { id: string; title: string; kind: string; source_ids: string[]; keywords: string[]; content: string }
interface Knowledge { name: string; version: number; aliases: string[]; sources: Source[]; entries: Entry[] }
const knowledge: Knowledge = JSON.parse(readFileSync(new URL('./knowledge/window-of-world.json', import.meta.url), 'utf8'));
const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export const isWindowOfWorld = (text: string) => knowledge.aliases.some(alias => normalize(text).includes(normalize(alias)));

export function searchKnowledge({ query, limit = 4 }: { query: string; limit?: number }) {
  const normalized = normalize(query);
  const topic = knowledge.aliases.reduce((text, alias) => text.replaceAll(normalize(alias), ''), normalized);
  const hits = knowledge.entries.map(entry => ({
    ...entry,
    score: entry.keywords.reduce((sum, word) => sum + (topic.includes(normalize(word)) ? word.length : 0), 0),
  })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  const selected = (hits.length ? hits : isWindowOfWorld(query) && !topic ? [knowledge.entries[0]] : []).slice(0, limit);
  return {
    knowledge_base: knowledge.name, version: knowledge.version, retrieval: 'local-keyword',
    status: selected.length ? 'found' : 'not_found',
    results: selected.map(entry => ({ ...entry, citation: `WOW:${entry.id}`, sources: knowledge.sources.filter(source => entry.source_ids.includes(source.id)) })),
    disclaimer: '本地知识快照，非实时查询；网页来源身份待复核。编辑建议不是园区承诺。票价、开放时间、演出和设施政策请通过已核实的官方渠道确认；未检索到的内容不能推断为不存在。',
  };
}

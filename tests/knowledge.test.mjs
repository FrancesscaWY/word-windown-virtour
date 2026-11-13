import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { archiveSchema, buildKnowledge, extractDocx } from '../server/ai/knowledge-import.ts';
import { knowledgeSchema } from '../server/ai/knowledge-schema.ts';
import { searchKnowledge, knowledgeLandmarks } from '../server/ai/knowledge.ts';
import { executeTool } from '../server/ai/tools.ts';
import { runAgent, systemPrompt } from '../server/ai/llm.ts';
import { parkCatalog } from '../src/data/park-catalog.js';

const source = JSON.parse(readFileSync(new URL('../server/ai/knowledge/window-of-world.source.json', import.meta.url)));
const knowledge = JSON.parse(readFileSync(new URL('../server/ai/knowledge/window-of-world.json', import.meta.url)));
const first = query => searchKnowledge({ query, limit: 1 }).results[0];

test('tracked source archive rebuilds the complete knowledge snapshot deterministically', () => {
  assert.deepEqual(buildKnowledge(source), knowledge);
  assert.equal(source.blocks.filter(b => b.type === 'table').length, 25);
  assert.equal(source.blocks.filter(b => b.type === 'table').reduce((n, b) => n + b.rows.length, 0), 242);
  assert.equal(knowledge.entries.length, 110);
  assert.equal(knowledge.sources.length, 23);
  assert.equal(knowledgeLandmarks.length, 18);
  for (const topic of ['overview', 'history', 'zones', 'tickets', 'hours', 'shows', 'facilities', 'transport', 'itinerary']) {
    assert.ok(knowledge.entries.some(e => e.topic === topic), topic);
  }
  assert.equal(knowledge.entries.filter(e => /^route-r0[1-5]$/.test(e.id)).length, 5);
});

test('table relationships, provenance and time constraints survive import', () => {
  const tickets = first('门票多少钱');
  assert.equal(tickets.id, 'tickets');
  assert.match(tickets.content, /门票类型：全日成人票；参考价格：¥220；说明：常见平台/);
  assert.equal(tickets.kind, 'dynamic'); assert.equal(tickets.current_status, 'not_verified');
  assert.match(tickets.content, /不能视为今天/);
  const discounts = first('儿童身高免费半价优惠');
  assert.equal(discounts.id, 'discounts');
  assert.match(discounts.content, /适用人群：儿童；优待政策：免费；条件：身高不超过1.2米/);
  assert.match(discounts.content, /日场半价政策不能直接理解为夜场/);
  const hours = first('世界之窗几点闭园');
  assert.equal(hours.id, 'hours'); assert.match(hours.content, /2026年11月12日/);
  assert.match(hours.content, /21:30/);
  for (const entry of knowledge.entries) {
    assert.ok(entry.source_ids.includes('document'));
    assert.equal(entry.snapshot_date, '2026-11-12');
  }
  assert.equal(knowledge.sources[0].url, null);
  assert.ok(knowledge.sources.every(s => s.accessed_at === null && s.published_at === null));
  assert.ok(knowledge.sources.slice(1).every(s => /未独立核验/.test(s.verification)));
});

for (const [query, id, content] of [
  ['埃菲尔铁塔复制比例是多少', 'eiffel-scale', /1:3/],
  ['Eiffel Tower复制比例', 'eiffel-scale', /108米/],
  ['泰姬陵为什么建造', 'taj-original', /纪念妻子/],
  ['悉尼歌剧院故事', 'sydney-story', /约恩·乌松/],
  ['尼亚加拉瀑布历史', 'niagara-original', /天然瀑布群/],
  ['阿布辛贝神庙故事', 'abu-simbel-story', /搬运|搬迁|重新组装/],
  ['大金塔八根佛发传说', 'shwedagon-story', /根据佛教传统|相传/],
  ['厕所在哪里', 'toilets', /仰光大金塔/],
  ['哪里可以吃饭', 'restaurants', /东南亚水乡餐厅/],
  ['游客中心行李寄存', 'services', /游客中心与票务中心不能自动合并/],
  ['世界之窗J出口开放吗', 'transport-j-exit', /无法证明已经恢复开放/],
  ['带孩子推荐哪条路线', 'route-r03', /4—6小时/],
  ['R02世界地标精华游', 'route-r02', /2.5—3.5小时/],
  ['R05夜景演艺游', 'route-r05', /不能|不可自动推断每天举行/],
]) {
  test(`retrieval: ${query}`, () => {
    const hit = first(query);
    assert.equal(hit?.id, id);
    assert.match(hit.content, content);
    assert.equal(hit.citation, `WOW:${id}`);
  });
}

test('landmark retrieval does not substitute unrelated landmarks or confuse the original with its replica', () => {
  const result = searchKnowledge({ query: '泰姬陵故事和历史' });
  assert.ok(result.results.some(e => e.id === 'taj-story'));
  assert.ok(result.results.every(e => !e.entities.length || e.entities.includes('印度泰姬陵')));
  assert.match(first('泰姬陵历史').content, /不是深圳园内复制景观的建造年代/);
  assert.match(first('金字塔名称胡夫').content, /群称|不能自动等同/);
  assert.equal(searchKnowledge({ query: '世界之窗火星基地暗号' }).status, 'not_found');
  assert.equal(searchKnowledge({ query: ' ' }).status, 'not_found');
  assert.equal(first('世界之窗').id, 'overview');
  assert.equal(searchKnowledge({ query: '东京铁塔复制比例' }).status, 'not_found');
  assert.ok(searchKnowledge({ query: '泰姬陵为什么建造' }).results.every(e => e.id !== 'founding'));
  assert.ok(searchKnowledge({ query: '路线', limit: Infinity }).results.length <= 4);
});

test('routes retain editorial estimates, ordered stops and the source discrepancy', () => {
  const route = first('R01');
  assert.equal(route.kind, 'editorial');
  assert.match(route.content, /顺序：1；区域：世界广场/);
  assert.match(route.content, /顺序：2；区域：亚洲区/);
  assert.match(route.content, /350分钟.*355分钟/);
  assert.match(route.content, /非官方路线、最短路径或实地计时/);
});

test('all attraction tools consume the document while preserving budget and coordinate boundaries', () => {
  const story = executeTool('get_attraction_story', { attraction: 'taj' });
  assert.match(story.story, /沙贾汗/);
  assert.ok(story.results.some(e => e.citation === 'WOW:taj-story'));
  const details = executeTool('get_attraction_details', { attraction: '巴黎铁塔' });
  assert.ok(details.results.some(e => e.entities.includes('埃菲尔铁塔')));
  assert.equal(details.ticket_price, null); assert.equal(details.opening_hours, null);
  const discovery = executeTool('search_attractions', { keyword: '艾尔斯变色石' });
  assert.equal(discovery.attractions.length, 1);
  assert.equal(discovery.attractions[0].locationVerified, false);
  const plan = executeTool('plan_itinerary', { city: '深圳', days: 1, interests: ['亲子'] });
  assert.equal(plan.results[0].id, 'route-r03');
  assert.equal(plan.route, null); assert.equal(plan.ticket_total, null);
  assert.equal(executeTool('estimate_budget', { attractions: ['世界之窗'], people: 2 }).total, null);
  assert.equal(executeTool('get_weather', { city: '深圳' }).status, 'unavailable');
});

test('all documented landmarks resolve through names, aliases and existing catalog IDs', () => {
  for (const landmark of knowledgeLandmarks) {
    const catalog = parkCatalog.find(a => a.id === landmark.id || [landmark.name, ...landmark.aliases].some(n => a.name === n || a.aliases.includes(n)));
    for (const name of new Set([landmark.name, ...landmark.aliases, ...(catalog ? [catalog.id, catalog.name] : [])])) {
      const story = executeTool('get_attraction_story', { attraction: name });
      assert.ok(story.results?.some(e => e.id === `${landmark.id}-original`), `${name}: original evidence`);
      const detail = executeTool('get_attraction_details', { attraction: name });
      assert.ok(detail.results?.some(e => e.entities.includes(landmark.name)), `${name}: detail evidence`);
    }
  }
});

test('text agent receives actual document evidence with citations, not just a stub response', async () => {
  let calls = 0;
  const result = await runAgent({ provider: {}, city: '深圳', messages: [{ role: 'user', content: '埃菲尔铁塔比例' }], complete: async (_provider, body) => {
    if (!calls++) return { choices: [{ message: { tool_calls: [{ id: 'kb-doc', function: { name: 'search_knowledge_base', arguments: JSON.stringify({ query: '埃菲尔铁塔复制比例', limit: 1 }) } }] } }] };
    const evidence = JSON.parse(body.messages.at(-1).content);
    assert.equal(evidence.results[0].citation, 'WOW:eiffel-scale');
    assert.match(evidence.results[0].content, /1:3/);
    assert.match(evidence.disclaimer, /未独立核验/);
    return { choices: [{ message: { content: '文档记载园内铁塔按1:3仿建。[WOW:eiffel-scale]' } }] };
  } });
  assert.match(result.content, /WOW:eiffel-scale/);
  assert.equal(result.traces[0].status, 'done');
  assert.match(systemPrompt, /2026-11-12/); assert.match(systemPrompt, /url为空/);
});

const docx = xml => zipSync({ 'word/document.xml': strToU8(xml) });
test('DOCX parser preserves body/table order, cell headers, Unicode and escaped text', () => {
  const result = extractDocx(docx('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>标题 &amp; 中文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>条件</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1.2米</w:t></w:r></w:p><w:p><w:r><w:t>须核验</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>结束</w:t></w:r></w:p></w:body></w:document>'), 'fixture.docx');
  assert.deepEqual(result.blocks, [{ type: 'paragraph', text: '标题 & 中文' }, { type: 'table', rows: [['条件', '1.2米\n须核验']] }, { type: 'paragraph', text: '结束' }]);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('offline importer rejects unsafe, oversized, malformed or mismatched input before generation', () => {
  assert.throws(() => extractDocx(new Uint8Array(10 * 1024 * 1024 + 1), 'large.docx'), /10 MiB/);
  assert.throws(() => extractDocx(zipSync({ 'word/media/large': new Uint8Array(33 * 1024 * 1024) }), 'bomb.docx'), /expanded size/);
  assert.throws(() => extractDocx(zipSync({ 'other.xml': strToU8('<root/>') }), 'missing.docx'), /Missing/);
  assert.throws(() => extractDocx(docx('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x/>'), 'entity.docx'), /forbidden/);
  assert.throws(() => extractDocx(docx('<w:document><w:body></w:document>'), 'broken.docx'), /Invalid/);
  assert.throws(() => extractDocx(docx('<root/>'), 'not-word.docx'), /Missing Word/);
  assert.throws(() => buildKnowledge({ ...source, blocks: source.blocks.slice(1) }), /profile/);
  assert.throws(() => archiveSchema.parse({ ...source, sha256: 'bad' }));
  const missingGroup = structuredClone(source);
  missingGroup.blocks = missingGroup.blocks.filter(b => b.text !== '门票类型与参考价格');
  assert.throws(() => buildKnowledge(missingGroup), /Missing operational group tickets/);
});

test('runtime schema rejects duplicate IDs, missing sources and untrusted URL schemes', () => {
  const duplicate = structuredClone(knowledge); duplicate.entries.push(duplicate.entries[0]);
  assert.throws(() => knowledgeSchema.parse(duplicate), /Duplicate/);
  const missing = structuredClone(knowledge); missing.entries[0].source_ids = ['nonexistent'];
  assert.throws(() => knowledgeSchema.parse(missing), /Unknown source/);
  const unsafe = structuredClone(knowledge); unsafe.sources[1].url = 'javascript:alert(1)';
  assert.throws(() => knowledgeSchema.parse(unsafe));
});

import { readFileSync } from 'node:fs';
import { knowledgeSchema } from './knowledge-schema.ts';
import { parkCatalog } from '../../src/data/park-catalog.js';

const knowledge = knowledgeSchema.parse(JSON.parse(readFileSync(new URL('./knowledge/window-of-world.json', import.meta.url), 'utf8')));
export const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
export const isWindowOfWorld = (text: string) => knowledge.aliases.some(alias => normalize(text).includes(normalize(alias)));

export const knowledgeLandmarks = knowledge.entries.filter(e => e.id.endsWith('-original')).map(entry => {
  const id = entry.id.replace(/-original$/, '');
  const location = knowledge.entries.find(e => e.id === `${id}-location`);
  return {
    id, name: entry.entities[0], aliases: entry.entities.slice(1),
    region: /世界之窗园内位置：([^；\n，,]+)/.exec(location?.content ?? '')?.[1] ?? '',
    summary: entry.content, sourceKind: '用户文档 · 附录来源未独立核验', locationVerified: false,
    source: null, snapshot_date: entry.snapshot_date,
  };
});
export function findKnowledgeLandmark(name: string) {
  const key = normalize(name);
  return knowledgeLandmarks.find(a => a.id === name || [a.name, ...a.aliases].some(alias => normalize(alias) === key));
}

const intents: [string, string[]][] = [
  ['overview', ['介绍', '是什么', '特色', '规模', '面积', '口号']],
  ['zones', ['分区', '区域', '八大', '国际街', '雕塑园']],
  ['history', ['历史', '建造', '建成', '年代', '建设', '开园', '缘由', '为什么', '背景', '发展', '周年']],
  ['story', ['故事', '讲解', '传说', '文化', '佛发', '梦碑', '搬迁']],
  ['replica', ['复制', '仿建', '比例', '缩尺', '缩小', '高度', '多高', '多少米', '观察', '外观']],
  ['location', ['哪里', '在哪', '位置', '哪个区', '国家', '原址', '坐标']],
  ['photo', ['拍照', '摄影', '机位', '构图', '打卡']],
  ['transport', ['交通', '地铁', '怎么去', '怎么到', '几号线', '出口', 'J口', 'I口', 'H口', '施工', '车站']],
  ['tickets', ['票', '价格', '多少钱', '费用', '预算', '优惠', '免费', '半价', '生日', '学生']],
  ['hours', ['开放', '营业', '几点', '闭园', '关门', '夜场', '入园']],
  ['shows', ['演出', '表演', '巡游', '灯光秀', '烟花', '焰火', '无人机', '节目', '活动']],
  ['rules', ['规则', '证件', '实名', '退改', '重复入园', '宠物', '安全', '商业拍摄']],
  ['facilities', ['厕所', '卫生间', '洗手间', '如厕', '吃饭', '餐厅', '餐饮', '美食', '午餐', '小吃', '休息', '座椅', '遮阴', '累了', '游客中心', '服务中心', '咨询', '电话', '寄存', '行李', '童车', '婴儿车', '推车', '租借']],
  ['itinerary', ['路线', '行程', '规划', '安排', '一日', '半天', '半日', '一天', '小时', '推荐', '怎么玩', '夜游', '亲子', '孩子', '小孩', '带娃', '儿童', '长辈', '刺激', '情侣', 'R01', 'R02', 'R03', 'R04', 'R05']],
  ['names', ['胡夫', '群称', '名称', '吴哥遗址', '梵蒂冈']],
];
// "东京铁塔" must not accidentally match the short Eiffel alias "铁塔".
const otherLandmarkNames = parkCatalog.filter(a => ![a.id, a.name, ...a.aliases].some(findKnowledgeLandmark))
  .flatMap(a => [a.name, ...a.aliases]).map(normalize).sort((a, b) => b.length - a.length);

export function searchKnowledge({ query, limit = 4 }: { query: string; limit?: number }) {
  const normalized = normalize(query);
  const topic = [...knowledge.aliases].sort((a, b) => b.length - a.length).reduce((text, alias) => text.replaceAll(normalize(alias), ''), normalized);
  const requested = intents.filter(([, words]) => words.some(word => topic.includes(normalize(word)))).map(([name]) => name);
  const entityQuery = otherLandmarkNames.reduce((text, name) => text.replaceAll(name, ''), normalized);
  const mentioned = knowledgeLandmarks.filter(a => [a.name, ...a.aliases].some(alias => entityQuery.includes(normalize(alias))));
  const unsupportedLandmark = entityQuery !== normalized && !mentioned.length;
  const routeCode = /r0[1-5]/.exec(normalized)?.[0];
  const hits = knowledge.entries.map(entry => {
    const entityMatch = mentioned.some(a => entry.entities.includes(a.name));
    const topicMatch = requested.includes(entry.topic);
    const words = entry.keywords.filter(word => topic.includes(normalize(word)));
    if (unsupportedLandmark && !['facilities', 'transport', 'tickets', 'hours', 'rules', 'shows', 'itinerary'].includes(entry.topic)) return { entry, score: 0 };
    // Specific landmark questions never pull in a different landmark merely because it shares a topic.
    if (entry.entities.length && !entityMatch) return { entry, score: 0 };
    if (mentioned.length && !entry.entities.length && ['history', 'story', 'overview', 'zones', 'location', 'photo'].includes(entry.topic)
      && !mentioned.some(a => [a.name, ...a.aliases].some(alias => normalize(entry.content).includes(normalize(alias))))) return { entry, score: 0 };
    if (entityMatch && requested.length && !topicMatch && !(requested.includes('overview') && ['history', 'replica', 'location'].includes(entry.topic))) return { entry, score: 0 };
    let score = entityMatch ? 60 : 0;
    if (topicMatch && (words.length || entityMatch)) score += 20;
    if (!entityMatch && !words.length) score = 0;
    score += score ? words.reduce((sum, word) => sum + Math.min(normalize(word).length, 6), 0) : 0;
    if (entityMatch && entry.id.endsWith('-original')) score += 2;
    if (routeCode && entry.id === `route-${routeCode}`) score += 150;
    // Prefer the dedicated restriction over generic "open" / "exit" hits.
    if (/j(?:出口|口)/i.test(topic) && entry.id === 'transport-j-exit') score += 120;
    return { entry, score };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(8, Math.trunc(limit))) : 4;
  const selected = (hits.length ? hits : isWindowOfWorld(query) && !topic ? [{ entry: knowledge.entries.find(e => e.id === 'overview')!, score: 1 }] : []).slice(0, safeLimit);
  return {
    knowledge_base: knowledge.name, version: knowledge.version, retrieval: 'local-keyword', snapshot_date: knowledge.document.snapshot_date,
    status: selected.length ? 'found' : 'not_found',
    results: selected.map(({ entry, score }) => ({ ...entry, score, citation: `WOW:${entry.id}`,
      current_status: entry.kind === 'dynamic' ? 'not_verified' : 'not_applicable',
      sources: knowledge.sources.filter(source => entry.source_ids.includes(source.id)),
    })),
    disclaimer: `用户提供的文档知识快照（资料截至${knowledge.document.snapshot_date}），不是实时查询。附录链接未独立核验，关联来源不等于逐句背书。参考票价、开放时间、节目、出口和服务政策不能当作当天承诺；编辑路线与时长不是精确导航或实地计时。未命中不能推断为不存在。`,
  };
}

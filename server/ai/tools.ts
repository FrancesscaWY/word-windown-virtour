// Migrated from VirtourV2/server/tools.js. Both text and voice use this allowlist.
import { z } from 'zod';
import { parkCatalog } from '../../src/data/park-catalog.js';
import { searchKnowledge, isWindowOfWorld, findKnowledgeLandmark, knowledgeLandmarks, normalize } from './knowledge.ts';
import type { ToolOutput } from './types.ts';
import { routeSchema, planRoute } from './routes.ts';

const city = z.string().trim().min(1).max(80);
const spot = z.string().min(1).max(80);
const disclaimer = '深圳世界之窗目录及用户文档资料；文档口径截至2026-11-12，附录来源未独立核验，非实时信息。票价、开放安排与交通请通过已核实的官方渠道确认。';
const find = (name: string) => parkCatalog.find(a => a.id === name || a.name === name || a.aliases.includes(name));
const landmarkFor = (name: string, record = find(name)) => findKnowledgeLandmark(name)
  ?? (record && (findKnowledgeLandmark(record.id) ?? findKnowledgeLandmark(record.name) ?? record.aliases.map(findKnowledgeLandmark).find(Boolean)));
// Document-only landmarks enrich backend discovery without inventing coordinates or changing map data.
const documented = knowledgeLandmarks.map(a => {
  const catalog = find(a.id) ?? [a.name, ...a.aliases].map(find).find(Boolean);
  return catalog ? { ...catalog, aliases: [...new Set([...catalog.aliases, a.name, ...a.aliases])] } : a;
});
const attractions = [...parkCatalog.filter(a => !documented.some(d => d.id === a.id)), ...documented];
function defineTool<S extends z.ZodType>(definition: { name: string; label: string; description: string; schema: S; run: (args: z.infer<S>) => ToolOutput }) {
  return { ...definition, execute(args: unknown): ToolOutput {
    const parsed = definition.schema.safeParse(args);
    if (!parsed.success) return { error: '工具参数不合法', details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
    return definition.run(parsed.data);
  } };
}
const definitions = [
  defineTool({
    name: 'search_attractions', label: '搜索景点', description: '检索有来源的深圳世界之窗景点目录，按名称、别名或园区筛选。未收录其他城市；没有实时票价，不支持按价格筛选。',
    schema: z.object({ city: city.optional(), keyword: z.string().max(80).optional(), category: z.string().max(80).optional(), max_price: z.number().min(0).max(10000).optional() }).strict(),
    run: ({ city, keyword, category, max_price }) => {
      if (max_price !== undefined) return { status: 'unavailable', error: '景点当前票价未核实，无法按价格筛选，也不能把未知票价当作免费。', attractions: [], disclaimer };
      return { attractions: attractions.filter(a => (!city || city === '深圳') && (!category || a.region.includes(category)) && (!keyword || normalize(`${a.name}${a.aliases.join('')}${a.summary}${a.region}`).includes(normalize(keyword)))).map(a => ({ id: a.id, name: a.name, region: a.region, summary: a.summary, source: a.source, sourceKind: a.sourceKind, locationVerified: a.locationVerified })), disclaimer };
    },
  }),
  defineTool({
    name: 'get_attraction_details', label: '景点详情', description: '查询深圳世界之窗景点资料和来源。没有实时票价、开放时间或游玩时长，不编造未收录字段。',
    schema: z.object({ attraction: spot }).strict(),
    run: ({ attraction }) => {
      if (isWindowOfWorld(attraction)) return searchKnowledge({ query: `${attraction}介绍` });
      const record = find(attraction) ?? findKnowledgeLandmark(attraction);
      const landmark = landmarkFor(attraction);
      return { ...(landmark ? searchKnowledge({ query: `${landmark.name}介绍 原址 园内` }) : {}), attraction: record ?? null, ticket_price: null, opening_hours: null, disclaimer };
    },
  }),
  defineTool({
    name: 'plan_route', label: '规划路线', description: '将你为用户规划的深圳世界之窗游览顺序交给后端校验，沿手绘底图上人工描绘的道路生成路线示意，返回几何与站点序号供前端直接绘制。先查询知识库或景点工具，再根据用户需求决定2—12个不重复景点及顺序；传入路线标题、安排说明、景点ID和各站建议。只支持枚举中的有坐标景点，路网不连通时返回不可用。手绘路网是图像坐标示意，不是实测地理道路，不返回真实距离、精确耗时、实时通行或无障碍保证。路线必须调用此工具才能在地图展示，仅文字回答不会绘制路线。',
    schema: routeSchema,
    run: planRoute,
  }),
  defineTool({
    name: 'plan_itinerary', label: '游览建议', description: '查询深圳世界之窗知识库中的编辑行程参考资料及限制。此工具只检索资料，不展示路线；需要前端显示路线时，查询后必须再调用 plan_route 传入你规划的景点顺序。不生成门票合计或分钟级安排。',
    schema: z.object({ city, days: z.number().int().min(1).max(3), interests: z.array(z.string().max(20)).max(6).optional(), budget: z.number().min(0).max(10000).optional() }).strict(),
    run: ({ city, days, interests }) => {
      if (city !== '深圳') return { status: 'unavailable', error: '未收录该城市的已核实行程资料。', route: null };
      return { ...searchKnowledge({ query: `世界之窗路线 ${interests?.join(' ') || 'R01'} 行程安排`, limit: 4 }), requested_days: days, route: null, ticket_total: null, disclaimer: '文档编辑路线与时长估算，不是地图导航、实时排队或运营承诺；不能保证多日安排，不计算未经核实的票价。' };
    },
  }),
  defineTool({
    name: 'estimate_budget', label: '预算信息', description: '当前未接入已核实的票价，预算返回不可用和确认渠道，不计算虚构金额或将未知价格当免费。',
    schema: z.object({ attractions: z.array(spot).min(1).max(10), people: z.number().int().min(1).max(30) }).strict(),
    run: ({ attractions: names, people }) => {
      return { attractions: names, people, total: null, complete: false, status: 'unavailable', error: '当前票价未核实，无法计算确定预算；请通过已核实的官方购票渠道确认。', disclaimer };
    },
  }),
  defineTool({
    name: 'get_attraction_story', label: '文化讲解', description: '获取景点背景故事与文化讲解素材。',
    schema: z.object({ attraction: spot }).strict(),
    run: ({ attraction }) => {
      if (isWindowOfWorld(attraction)) return searchKnowledge({ query: `${attraction}建园 历史` });
      const a = find(attraction), landmark = landmarkFor(attraction, a);
      if (landmark) {
        const result = searchKnowledge({ query: `${landmark.name}故事 历史`, limit: 2 });
        return { ...result, name: landmark.name, story: result.results.map(e => e.content).join('\n\n') };
      }
      return { name: a?.name ?? attraction, story: a?.summary ?? null, source: a?.source ?? null, status: a ? 'found' : 'not_found', disclaimer: '仅目录摘要及其来源，未收录的建筑历史不得补写。' };
    },
  }),
  defineTool({
    name: 'search_knowledge_base', label: '知识库检索', description: '检索世界之窗文档知识库：建园历史、18个景点的原景与仿建、比例、故事、摄影、厕所餐饮等设施、地铁出口、门票参考和R01—R05路线。query保留景点名和完整问题，按主题返回来源及截至2026-11-12的资料限制，非实时；查不到明确说明。',
    schema: z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(8).optional() }).strict(),
    run: searchKnowledge,
  }),
];

export const tools = definitions.map(({ name, description, schema }) => {
  const parameters = z.toJSONSchema(schema, { target: 'draft-7' });
  parameters.required ??= [];
  return { type: 'function', function: { name, description, parameters } };
});
export const toolCatalog = definitions.map(({ name, label, description }) => ({ name, label, description }));

export function executeTool(name: string, args: unknown): ToolOutput {
  const def = definitions.find(d => d.name === name);
  if (!def) return { error: `不支持的工具：${name}` };
  return def.execute(args);
}

/** Keep full road geometry in frontend traces, not in the model's context window. */
export function modelToolOutput(name: string, output: ToolOutput): ToolOutput {
  if (name !== 'plan_route' || output.status !== 'success' || !output.route) return output;
  const { geometry, stops, ...route } = output.route as NonNullable<ReturnType<typeof planRoute>['route']>;
  return { ...output, route: { ...route,
    stops: stops.map(({ position: _position, roadAnchor, ...stop }) => ({ ...stop, roadAnchor: { entranceVerified: roadAnchor.entranceVerified } })),
    geometry: { kind: geometry.kind, legs: geometry.legs, sourceSha256: geometry.sourceSha256 },
  } };
}

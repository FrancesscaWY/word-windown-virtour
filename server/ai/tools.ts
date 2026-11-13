// Migrated from VirtourV2/server/tools.js. Both text and voice use this allowlist.
import { z } from 'zod';
import { attractions, cities } from './data.ts';
import { searchKnowledge, isWindowOfWorld } from './knowledge.ts';
import type { ToolOutput } from './types.ts';

const city = z.enum(cities);
const spot = z.string().min(1).max(80);
const disclaimer = '本地演示数据，非实时信息；门票、开放时间与交通请以官方信息为准。';
const find = (name: string) => attractions.find(a => a.id === name || a.name === name || a.name.includes(name));
function defineTool<S extends z.ZodType>(definition: { name: string; label: string; description: string; schema: S; run: (args: z.infer<S>) => ToolOutput }) {
  return { ...definition, execute(args: unknown): ToolOutput {
    const parsed = definition.schema.safeParse(args);
    if (!parsed.success) return { error: '工具参数不合法', details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
    return definition.run(parsed.data);
  } };
}
const definitions = [
  defineTool({
    name: 'search_attractions', label: '搜索景点', description: '按城市、关键词、类别、最高票价搜索本地示例景点库（杭州、北京、成都、上海）。深圳世界之窗请使用 search_knowledge_base，不在此示例库中。',
    schema: z.object({ city: city.optional(), keyword: z.string().max(80).optional(), category: z.enum(['自然风光', '人文古迹', '城市漫游']).optional(), max_price: z.number().min(0).max(10000).optional() }).strict(),
    run: ({ city, keyword, category, max_price }) => ({ attractions: attractions.filter(a => (!city || a.city === city) && (!category || a.category === category) && (max_price === undefined || a.price <= max_price) && (!keyword || `${a.name}${a.description}${a.tags.join('')}`.includes(keyword))), disclaimer }),
  }),
  defineTool({
    name: 'get_attraction_details', label: '景点详情', description: '查询指定景点的示例门票、地址、游玩时长、开放时间和注意事项。',
    schema: z.object({ attraction: spot }).strict(),
    run: ({ attraction }) => isWindowOfWorld(attraction) ? searchKnowledge({ query: `${attraction}介绍 地址 门票 开放` }) : ({ attraction: find(attraction) || null, disclaimer }),
  }),
  defineTool({
    name: 'get_weather', label: '出行天气', description: '获取城市的模拟天气和出游建议，始终明确告知不是实际预报。不要用于真实天气决策。',
    schema: z.object({ city, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
    run: ({ city, date }) => ({ city, date: date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), condition: '多云（模拟）', temperature: '18–25°C（模拟）', suggestion: '此处仅演示天气工具。真实出行前请查询当地气象部门的实时预报。', simulated: true, disclaimer: '模拟天气，不是真实预报。' }),
  }),
  defineTool({
    name: 'plan_itinerary', label: '规划行程', description: '按城市、1至3天、兴趣和单人景点门票预算生成本地示例行程。不包含交通、餐饮、住宿。',
    schema: z.object({ city, days: z.number().int().min(1).max(3), interests: z.array(z.string().max(20)).max(6).optional(), budget: z.number().min(0).max(10000).optional() }).strict(),
    run: ({ city, days, interests = [], budget = 10000 }) => {
      const pool = attractions.filter(a => a.city === city).sort((a, b) => {
        const score = (a: typeof attractions[number]) => interests.filter(i => `${a.category}${a.tags.join('')}`.includes(i)).length;
        return score(b) - score(a) || b.rating - a.rating;
      });
      let total = 0;
      const selected = pool.filter(a => { if (total + a.price > budget) return false; total += a.price; return true; }).slice(0, days * 2);
      return { city, days: Array.from({ length: days }, (_, i) => ({ day: i + 1, stops: selected.slice(i * 2, i * 2 + 2), note: selected.length <= i * 2 ? '本地景点资料不足，建议自由活动或补充数据。' : '按每日上午、下午各一站安排；顺序仅供参考，未接入地图路线。' })), ticket_total: selected.reduce((s, a) => s + a.price, 0), budget_scope: '每人景点门票，不含交通、餐饮、住宿和园内付费项目', disclaimer };
    },
  }),
  defineTool({
    name: 'estimate_budget', label: '估算预算', description: '计算指定景点与人数对应的门票合计。只算示例门票，不做任何实际预订。',
    schema: z.object({ attractions: z.array(spot).min(1).max(10), people: z.number().int().min(1).max(30) }).strict(),
    run: ({ attractions: names, people }) => {
      if (names.some(isWindowOfWorld)) return { people, total: null, complete: false, error: '世界之窗当前票价未核实，无法计算确定预算；请使用 search_knowledge_base 查询票务边界。', disclaimer };
      const items = [...new Set(names)].map(name => { const a = find(name); return a ? { name: a.name, price: a.price, subtotal: a.price * people } : { name, error: '未找到该景点，不计入合计' }; });
      return { people, items, total: items.reduce((s, a) => s + (a.subtotal || 0), 0), currency: 'CNY', scope: '仅门票示例，不含交通、餐饮、住宿及优惠政策', disclaimer };
    },
  }),
  defineTool({
    name: 'get_attraction_story', label: '文化讲解', description: '获取景点背景故事与文化讲解素材。',
    schema: z.object({ attraction: spot }).strict(),
    run: ({ attraction }) => { if (isWindowOfWorld(attraction)) return searchKnowledge({ query: `${attraction}文化 讲解` }); const a = find(attraction); return { name: a?.name, story: a?.story || '本地暂无该景点的讲解资料。', disclaimer }; },
  }),
  defineTool({
    name: 'search_knowledge_base', label: '知识库检索', description: '检索深圳世界之窗知识库：园区介绍、区域、交通、票务边界、开放与演出、亲子和游览建议。返回片段、来源与时效限制，不是实时查询。涉及世界之窗优先调用此工具；查不到时明确说明。',
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

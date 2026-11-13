// Rule-based fallback migrated from VirtourV2, with Shenzhen as the guide default.
import { attractions, cities } from './data.ts';
import { executeTool } from './tools.ts';
import { isWindowOfWorld, searchKnowledge } from './knowledge.ts';
import type { AgentInput, AgentResult, ToolOutput, Trace } from './types.ts';

type Attraction = typeof attractions[number];
type Weather = ToolOutput & { condition: string; temperature: string };
type Itinerary = ToolOutput & { days: { day: number; stops: Attraction[]; note: string }[]; ticket_total: number };
type Budget = ToolOutput & { items: { name: string; subtotal?: number; error?: string }[]; total: number };

export async function runDemo({ messages, city, onEvent = () => {}, signal }: AgentInput): Promise<AgentResult> {
  const input = messages.at(-1)?.content;
  if (!input) throw new Error('请输入问题。');
  const context = messages.map(m => m.content).join(' ');
  const selectedCity = cities.find(c => input.includes(c)) || city;
  const currentSpot = attractions.find(a => input.includes(a.name));
  const contextualSpot = currentSpot || [...attractions].sort((a, b) => context.lastIndexOf(b.name) - context.lastIndexOf(a.name)).find(a => context.includes(a.name));
  const traces: Trace[] = [], sections: string[] = [];
  const call = <T extends ToolOutput>(name: string, args: unknown): T => {
    if (signal?.aborted) throw new Error('请求已取消。');
    const trace: Trace = { id: `demo-${traces.length}-${Date.now()}`, name, args, status: 'running', result: null, duration: 0 };
    onEvent({ type: 'tool_start', trace: { ...trace } });
    const start = Date.now();
    trace.result = executeTool(name, args);
    trace.status = trace.result.error ? 'error' : 'done';
    trace.duration = Date.now() - start;
    traces.push(trace);
    onEvent({ type: 'tool_end', trace });
    return trace.result as T;
  };
  onEvent({ type: 'status', message: '正在运行离线规则演示…' });
  const recentTopic = [...messages].reverse().find(m => m.role === 'user' && (isWindowOfWorld(m.content) || attractions.some(a => m.content.includes(a.name))));
  if (isWindowOfWorld(input) || (selectedCity === '深圳' && !contextualSpot) || (!currentSpot && recentTopic && isWindowOfWorld(recentTopic.content))) {
    if (/天气|下雨|气温/.test(input)) {
      const weather = call<Weather>('get_weather', { city: '深圳' });
      sections.push(`### 深圳天气（模拟）\n${weather.condition}，${weather.temperature}。不是实际天气预报。`);
    }
    const result = call<ReturnType<typeof searchKnowledge>>('search_knowledge_base', { query: input.slice(0, 500) });
    sections.push(result.results.length ? result.results.map(entry => `### ${entry.title} [${entry.citation}]\n${entry.content}\n\n${entry.sources.length ? entry.sources.map(source => `来源：[${source.title}](${source.url}) · 访问日期 ${source.accessed_at} · ${source.verification}`).join('\n') : '来源：本项目编辑建议，非官方承诺。'}`).join('\n\n') : '知识库未收录与该问题匹配的资料，请补充问题或通过已核实的园区官方渠道确认。');
    return { content: `${sections.join('\n\n')}\n\n> 离线规则演示 · ${result.disclaimer}`, traces, usage: { total_tokens: 0 } };
  }
  if (/天气|下雨|气温/.test(input)) {
    const weather = call<Weather>('get_weather', { city: selectedCity });
    sections.push(`### ${selectedCity}出行天气（模拟）\n${weather.condition}，${weather.temperature}。**这不是实际天气预报**，请查询当地气象部门信息。`);
  }
  if (/行程|路线|规划|安排|一日|两日|三日|[123]天/.test(input)) {
    const days = /三|3天/.test(input) ? 3 : /两|二|2天/.test(input) ? 2 : 1;
    const itinerary = call<Itinerary>('plan_itinerary', { city: selectedCity, days, ...(/免费|零预算/.test(input) ? { budget: 0 } : {}), interests: /亲子|孩子/.test(input) ? ['亲子'] : /文化|古迹/.test(input) ? ['文化'] : [] });
    sections.push(`### ${selectedCity} · ${days}日示例行程\n${itinerary.days.map(d => `Day ${d.day}：${d.stops.map(a => a.name).join('、') || d.note}`).join('\n')}\n每人示例门票合计 ¥${itinerary.ticket_total}，不含交通、餐饮、住宿。顺序仅供参考，未接入地图路线。`);
  } else if (/预算|多少钱|费用|合计/.test(input)) {
    const names = attractions.filter(a => input.includes(a.name)).map(a => a.name);
    const people = Number(input.match(/(\d+)\s*[人位]/)?.[1]) || (/两人|双人/.test(input) ? 2 : 1);
    const result = call<Budget>('estimate_budget', { attractions: names.length ? names : contextualSpot ? [contextualSpot.name] : attractions.filter(a => a.city === selectedCity).slice(0, 2).map(a => a.name), people });
    sections.push(result.error ? '演示工具支持 1–30 人的门票预算，请调整人数后再试。' : `### 门票预算 · ${people}人\n${result.items.map(a => a.error ? `${a.name}：未收录` : `${a.name}：¥${a.subtotal}`).join('\n')}\n合计 ¥${result.total}，仅含示例门票。`);
  } else if (/故事|讲解|历史|文化背景/.test(input)) {
    const target = contextualSpot || attractions.find(a => a.city === selectedCity);
    if (target) { const result = call('get_attraction_story', { attraction: target.name }); sections.push(`### ${result.name}\n${result.story}`); }
  } else if (currentSpot || (/门票|开放|几点|地址|这里|这个景点/.test(input) && contextualSpot)) {
    const result = call('get_attraction_details', { attraction: (currentSpot || contextualSpot)!.name });
    const a = result.attraction as Attraction;
    sections.push(`### ${a.name} · ${a.city}\n${a.description}\n门票参考：¥${a.price}；开放：${a.hours}\n${a.tip}`);
  } else if (!sections.length || /推荐|景点|免费/.test(input)) {
    const result = call<ToolOutput & { attractions: Attraction[] }>('search_attractions', { city: selectedCity, ...(/免费/.test(input) ? { max_price: 0 } : {}), ...(/亲子|孩子/.test(input) ? { keyword: '亲子' } : {}), ...(/人文|古迹/.test(input) ? { category: '人文古迹' } : {}) });
    sections.push(result.attractions.map(a => `${a.name}：${a.description}（示例门票 ¥${a.price}）`).join('\n') || '当前筛选条件下没有景点，请换个条件。');
  }
  return { content: `${sections.join('\n\n')}\n\n> 离线规则演示 · 景点资料为本地示例，票价与开放安排请以官方信息为准。`, traces, usage: { total_tokens: 0 } };
}

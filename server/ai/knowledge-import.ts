// Offline, deterministic importer for the reviewed 世界之窗知识库 document profile.
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { knowledgeSchema } from './knowledge-schema.ts';
import type { Entry, Knowledge } from './knowledge-schema.ts';

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: z.string() }),
  z.object({ type: z.literal('table'), rows: z.array(z.array(z.string())) }),
]);
export const archiveSchema = z.object({
  profile: z.literal('window-of-world-2026-11-12'), filename: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), blocks: z.array(blockSchema).min(1),
});
export type Block = z.infer<typeof blockSchema>;
export type Archive = z.infer<typeof archiveSchema>;
type XmlNode = { [key: string]: XmlNode[] | string | number | undefined };
const textOf = (nodes: XmlNode[]): string => nodes.map(node => Object.entries(node).map(([key, value]) => {
  if (key === '#text') return String(value ?? '');
  if (key === 'w:tab') return '\t';
  if (key === 'w:br') return '\n';
  if (key === 'w:del' || key === 'w:instrText' || key === ':@') return '';
  return Array.isArray(value) ? textOf(value) : '';
}).join('')).join('');
const clean = (text: string) => text.replace(/[\t\u00a0 ]+/g, ' ').trim();
const paragraphsOf = (nodes: XmlNode[]): string[] => nodes.flatMap(node => Object.entries(node).flatMap(([key, value]) =>
  key === 'w:p' && Array.isArray(value) ? [clean(textOf(value))] : Array.isArray(value) ? paragraphsOf(value) : []));

export function extractDocx(bytes: Uint8Array, filename: string): Archive {
  if (bytes.length > 10 * 1024 * 1024) throw new Error('DOCX exceeds 10 MiB');
  let total = 0, count = 0;
  const files = unzipSync(bytes, { filter(file) {
    if (++count > 1000 || (total += file.originalSize) > 32 * 1024 * 1024) throw new Error('DOCX expanded size limit exceeded');
    if (/\.\.\/|^\//.test(file.name)) throw new Error('Unsafe DOCX entry');
    if (file.name === 'word/document.xml' && file.originalSize > 8 * 1024 * 1024) throw new Error('Document XML exceeds limit');
    return file.name === 'word/document.xml';
  } });
  if (!files['word/document.xml']) throw new Error('Missing DOCX document.xml');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(files['word/document.xml']);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entities are forbidden');
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid document XML');
  const nodes = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: false, parseTagValue: false }).parse(xml) as XmlNode[];
  const body = nodes.find(n => n['w:document'])?.['w:document'];
  const children = Array.isArray(body) ? body.find(n => n['w:body'])?.['w:body'] : undefined;
  if (!Array.isArray(children)) throw new Error('Missing Word document body');
  const blocks: Block[] = [];
  for (const node of children) {
    if (Array.isArray(node['w:p'])) {
      const text = clean(textOf(node['w:p']));
      if (text) blocks.push({ type: 'paragraph', text });
    } else if (Array.isArray(node['w:tbl'])) {
      const rows = node['w:tbl'].flatMap(row => Array.isArray(row['w:tr']) ? [row['w:tr'].flatMap(cell =>
        Array.isArray(cell['w:tc']) ? [paragraphsOf(cell['w:tc']).filter(Boolean).join('\n')] : [])] : []);
      blocks.push({ type: 'table', rows });
    }
  }
  return archiveSchema.parse({ profile: 'window-of-world-2026-11-12', filename, sha256: createHash('sha256').update(bytes).digest('hex'), blocks });
}

const snapshot = '2026-11-12';
const entities = [
  ['eiffel', '埃菲尔铁塔', '巴黎铁塔', 'Eiffel Tower', '铁塔', '埃菲尔'],
  ['arc', '巴黎雄狮凯旋门', '巴黎凯旋门', '凯旋门', 'Arc de Triomphe'],
  ['pisa', '比萨斜塔', "Pisa's Leaning Tower", '斜塔'],
  ['colosseum', '古罗马斗兽场', '罗马斗兽场', '罗马竞技场', '斗兽场', 'Colosseum'],
  ['st-peter', '圣彼得大教堂', '圣伯多禄大殿', "St. Peter's Basilica"],
  ['taj', '印度泰姬陵', '泰姬陵', '泰姬玛哈尔陵', 'Taj Mahal'],
  ['angkor', '柬埔寨吴哥窟', '吴哥窟', '吴哥寺', '吴哥窑', 'Angkor Wat'],
  ['katsura', '日本桂离宫', '桂离宫', 'Katsura Imperial Villa'],
  ['shwedagon', '缅甸仰光大金塔', '仰光大金塔', '瑞光大金塔', '大金塔', 'Shwedagon Pagoda'],
  ['pyramid', '埃及金字塔', '吉萨金字塔群', '吉萨金字塔', '基撒金字塔', '金字塔', 'Pyramids of Giza'],
  ['sphinx', '狮身人面像', '吉萨大狮身人面像', 'Great Sphinx'],
  ['abu-simbel', '阿布辛伯勒神庙', '阿布辛贝神庙', '阿布辛贝勒神庙', 'Abu Simbel Temples'],
  ['sydney', '悉尼歌剧院', '歌剧院', 'Sydney Opera House'],
  ['uluru', '艾尔斯变色石', '乌鲁鲁', '乌卢鲁', 'Uluru', 'Ayers Rock'],
  ['liberty', '自由女神像', '自由女神', '自由照耀世界', 'Statue of Liberty'],
  ['rushmore', '美国总统山', '总统山', '拉什莫尔山', 'Mount Rushmore'],
  ['niagara', '尼亚加拉大瀑布', '尼亚加拉瀑布', '尼加拉大瀑布', 'Niagara Falls'],
  ['whitehouse', '美国白宫', '白宫', 'The White House'],
];
const entityFor = (name: string) => entities.find(([, ...names]) => names.some(n => name === n || name.startsWith(`${n}（`)));
const originalSources = (id: string) => id === 'eiffel' ? [20] : ['pyramid', 'sphinx', 'abu-simbel'].includes(id) ? [17, 18]
  : id === 'angkor' ? [17, 19] : ['liberty', 'rushmore', 'whitehouse'].includes(id) ? [21] : [17];
function render(block: Block): string {
  if (block.type === 'paragraph') return block.text;
  const [headers, ...rows] = block.rows;
  return rows.map(row => row.map((cell, i) => `${headers[i] || `列${i + 1}`}：${cell}`).join('；')).join('\n');
}
const tablesIn = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');

export function buildKnowledge(input: Archive): Knowledge {
  const archive = archiveSchema.parse(input);
  if (archive.blocks[0]?.type !== 'paragraph' || archive.blocks[0].text !== '世界之窗知识库') throw new Error('Unexpected document title/profile');
  const sections = new Map<string, Block[]>();
  let section = '';
  // The source uses visually numbered Normal paragraphs, not Heading styles.
  for (const block of archive.blocks) {
    const heading = block.type === 'paragraph' && /^(\d+\.\d+)\s/.exec(block.text);
    if (heading) { section = heading[1]; sections.set(section, []); continue; }
    if (block.type === 'paragraph' && /^(?:[1-4]\.\s(?:景区资料|景点资料|服务设施|游玩路线)$|附录A)/.test(block.text)) {
      section = block.text.startsWith('附录A') ? 'appendix' : ''; if (section) sections.set(section, []); continue;
    }
    if (section) sections.get(section)!.push(block);
  }
  const get = (id: string) => {
    const blocks = sections.get(id);
    if (!blocks?.length) throw new Error(`Missing document section ${id}`);
    return blocks;
  };
  const sourceRows = tablesIn(get('appendix'))[0]?.rows.slice(1);
  if (!sourceRows || sourceRows.length !== 22) throw new Error('Expected 22 appendix sources; review the import profile');
  const sources: Knowledge['sources'] = [{
    id: 'document', title: '用户提供的《世界之窗知识库》', url: null,
    accessed_at: null, published_at: null,
    verification: `用户提供的文档，资料口径截至${snapshot}；导入不代表独立事实核验。原文件 SHA-256：${archive.sha256}。`,
  }, ...sourceRows.map(([title, url], i) => ({
    id: `doc-source-${i + 1}`, title, url, accessed_at: null, published_at: null,
    verification: '文档附录列出的相关参考来源；关联由导入规则按章节用途建立，不等于已逐句核对网页，未独立核验网页身份、内容及当前有效性。',
  }))];
  const sourceIds = (indices: number[]) => ['document', ...indices.map(i => `doc-source-${i}`)];
  const entries: Entry[] = [];
  function add(id: string, title: string, topic: string, kind: Entry['kind'], section: string, content: string,
    keywords: string[], sourceIndices: number[], entityNames: string[] = []) {
    entries.push({ id, title, topic, kind, section, snapshot_date: snapshot, content: content.trim(), keywords,
      source_ids: sourceIds(sourceIndices), entities: entityNames });
  }
  function chunks(id: string, title: string, topic: string, kind: Entry['kind'], sec: string, blocks: Block[], words: string[], refs: number[]) {
    let text = '', index = 0;
    const flush = () => { if (text) { add(index ? `${id}-${index + 1}` : id, title, topic, kind, sec, text, words, refs); index++; text = ''; } };
    for (const block of blocks) {
      // Table headers travel with every row even across chunk boundaries.
      const lines = render(block).split('\n');
      for (const line of lines) {
        if (text.length + line.length > 1200) flush();
        text += `${text ? '\n' : ''}${line}`;
      }
    }
    flush();
  }
  const intro = get('1.1');
  chunks('overview', '园区简介与基本资料', 'overview', 'reference', '1.1', intro.slice(0, 2), ['介绍', '是什么', '特色', '规模', '开园', '面积', '口号'], [2, 3, 5]);
  chunks('zones', '八大区域与历史名称兼容', 'zones', 'reference', '1.1', intro.slice(2), ['分区', '区域', '八大', '国际街', '雕塑园', '阿尔卑斯', '梅拉尼亚'], [2, 3, 7]);
  chunks('founding', '建园缘由与建设构想', 'history', 'reference', '1.2', get('1.2'), ['建园', '缘由', '为什么建', '马志民', '构思', '改革开放'], [1]);
  chunks('history', '发展历史与代表性建设故事', 'history', 'reference', '1.3', get('1.3'), ['历史', '发展', '开园', '建设', '时间轴', '周年'], [1, 4]);
  // Keep each operational topic and its qualifications together.
  const rules = get('1.4');
  let group: Block[] = [], groupNo = 0;
  const configs: [string, string, string, string[], number[]][] = [
    ['hours', '营业时间与夜场（日期快照）', 'hours', ['开放', '营业', '几点', '闭园', '关门', '夜场', '入园'], [5, 8, 9]],
    ['tickets', '门票参考价格与购票渠道', 'tickets', ['票', '价格', '多少钱', '费用', '预算', '购票', '生日', '学生'], [5, 8, 9]],
    ['discounts', '免费及优惠入园条件', 'tickets', ['优惠', '免费', '半价', '儿童', '身高', '老人', '长者', '军人', '残障'], [11]],
    ['park-rules', '入园与游览规则', 'rules', ['规则', '证件', '实名', '退改', '重复入园', '宠物', '无人机', '收费', '安全'], [12]],
    ['shows', '演出与项目开放限制', 'shows', ['演出', '表演', '巡游', '灯光', '烟花', '焰火', '无人机', '节目', '活动'], [3, 5]],
  ];
  const flushRules = () => {
    if (!groupNo) return;
    const [id, title, topic, words, refs] = configs[groupNo - 1];
    chunks(id, title, topic, 'dynamic', '1.4', [{ type: 'paragraph', text: `以下是截至${snapshot}的文档参考，不能视为今天或出游日已核实的运营安排。` }, ...group], words, refs);
  };
  const ruleHeadings = ['营业时间', '门票类型与参考价格', '免费及优惠入园政策', '游客入园与游览规则', '演出与项目开放规则'];
  for (const b of rules) {
    // Word's auto-number labels (1)…(5) are not literal XML text.
    const headingIndex = b.type === 'paragraph' ? ruleHeadings.indexOf(b.text.replace(/^\([1-5]\)\s*/, '')) : -1;
    if (headingIndex >= 0) { flushRules(); groupNo = headingIndex + 1; group = []; }
    if (groupNo) group.push(b);
  }
  flushRules();
  for (const [id] of configs) if (!entries.some(e => e.id === id)) throw new Error(`Missing operational group ${id}`);
  const naming = get('2.1');
  const namingStart = naming.findIndex(b => b.type === 'paragraph' && b.text.startsWith('特别注意名称'));
  if (namingStart < 0) throw new Error('Missing landmark naming qualifications');
  chunks('names', '景点名称层级与原景辨别', 'names', 'reference', '2.1', naming.slice(namingStart), ['原景', '群称', '名称', '胡夫', '吴哥遗址', '梵蒂冈'], [17, 18, 19]);
  for (const [sec, suffix, topic, title, words, refs] of [
    ['2.2', 'location', 'location', '原景与园内位置', ['哪里', '位置', '在哪', '哪个区', '国家', '原址'], [2, 3]],
    ['2.4', 'replica', 'replica', '园内仿建与观察重点', ['园内', '仿建', '复制', '外观', '观察'], [2, 6, 22]],
    ['2.7', 'photo', 'photo', '拍照与游玩建议', ['拍照', '摄影', '机位', '构图', '打卡'], [10]],
  ] as const) {
    const table = tablesIn(get(sec))[0];
    if (table?.rows.length !== 19) throw new Error(`Expected 18 landmark rows in ${sec}`);
    for (const row of table.rows.slice(1)) {
      const entity = entityFor(row[0]);
      if (!entity) throw new Error(`Unmapped landmark ${row[0]}`);
      const [id, ...names] = entity;
      add(`${id}-${suffix}`, `${names[0]}：${title}`, topic, topic === 'photo' ? 'editorial' : 'reference', sec,
        `${topic === 'photo' ? '编辑性拍摄建议，不保证现场机位、光照或设施开放。\n' : ''}${render({ type: 'table', rows: [table.rows[0], row] })}`,
        [...words], [...refs], names);
    }
  }
  // Repair the source's run-on paragraph joining Mount Rushmore and Niagara's heading.
  const original = get('2.3').flatMap(b => b.type === 'paragraph' && b.text.endsWith('尼亚加拉大瀑布（美洲区）') && !b.text.startsWith('尼亚加拉')
    ? [{ type: 'paragraph' as const, text: b.text.slice(0, -'尼亚加拉大瀑布（美洲区）'.length) }, { type: 'paragraph' as const, text: '尼亚加拉大瀑布（美洲区）' }] : [b]);
  let landmark: string[] | undefined, details: string[] = [];
  const flushOriginal = () => {
    if (!landmark) return;
    const [id, ...names] = landmark;
    add(`${id}-original`, `${names[0]}：原景历史与文化`, 'history', 'reference', '2.3', `以下介绍的是世界原景，不是深圳园内复制景观的建造年代。\n${details.join('\n')}`,
      ['历史', '建造', '建成', '年代', '为什么', '背景', '介绍', '文化'], originalSources(id), names);
  };
  for (const b of original) {
    if (b.type !== 'paragraph') continue;
    const match = entityFor(b.text);
    if (match) { flushOriginal(); landmark = match; details = []; }
    details.push(b.text);
  }
  flushOriginal();
  if (entries.filter(e => e.id.endsWith('-original')).length !== 18) throw new Error('Expected 18 original-landmark introductions');
  chunks('replica-scale', '复制比例的适用范围', 'replica', 'reference', '2.5', get('2.5'), ['复制', '比例', '缩尺', '缩小', '多大'], [6]);
  const towerFact = tablesIn(intro)[0]?.rows.find(row => row[0] === '代表性标志')?.[1];
  const towerHistory = get('1.3').find(b => b.type === 'paragraph' && b.text.startsWith('108米埃菲尔铁塔的建设'));
  if (!towerFact || !towerHistory) throw new Error('Missing reviewed Eiffel replica facts');
  add('eiffel-scale', '埃菲尔铁塔：园内高度与复制比例', 'replica', 'reference', '1.1 / 1.3 / 2.5',
    `${towerFact}\n${render(towerHistory)}\n此比例只适用于园内埃菲尔铁塔，不可推及其他景观。`, ['比例', '复制', '缩尺', '高度', '多高', '多少米', '建造'], [1, 2], entities[0].slice(1));
  const stories = get('2.6');
  for (let i = 0; i < stories.length; i++) {
    const b = stories[i];
    if (b.type !== 'paragraph' || !b.text.startsWith('关联景点：')) continue;
    const entity = entityFor(b.text.split('｜')[0].replace('关联景点：', '').trim());
    if (!entity) throw new Error('Unmapped story');
    const [id, ...names] = entity;
    add(`${id}-story`, `${names[0]}：${render(stories[i - 1])}`, 'story', 'reference', '2.6',
      `${render(stories[i - 1])}\n${b.text}\n${render(stories[i + 1])}\n宗教传统、碑文叙述及传说必须保留其身份，不得当作已证实的超自然史实。`, ['故事', '讲解', '传说', '文化', '为什么'], originalSources(id), names);
  }
  chunks('photo-tips', '重点拍照机位与参考游览顺序', 'photo', 'editorial', '2.7', get('2.7').filter(b => b.type !== 'table'), ['拍照', '机位', '喷泉', '风车', '花田', '构图'], [8, 10]);
  for (const [sec, id, title, words, refs] of [
    ['3.1', 'toilets', '卫生间与地铁站厕所', ['厕所', '卫生间', '洗手间', '如厕', '无障碍厕所', 'C2'], [8, 14]],
    ['3.2', 'restaurants', '餐厅与餐饮区域', ['吃饭', '餐厅', '餐饮', '美食', '吃的', '午餐', '小吃'], [3, 8]],
    ['3.3', 'rest', '休息区与座椅资料边界', ['休息', '座椅', '坐下', '遮阴', '累了'], [3, 8]],
    ['3.4', 'services', '游客中心、票务中心与寄存', ['服务', '游客中心', '服务中心', '咨询', '电话', '寄存', '行李', '童车', '婴儿车', '推车', '租借'], [5, 8, 13]],
    ['3.5', 'entrances', '景区出入口与咨询渠道', ['入口', '出口', '正门', '出入口', '中华门', '电话', '票务中心'], [5, 14]],
    ['3.6', 'transport', '地铁交通、出口与施工限制', ['交通', '地铁', '怎么去', '怎么到', '几号线', '出口', 'J口', 'J出口', 'I口', 'H口', '施工', '车站'], [14, 15, 16]],
  ] as const) {
    chunks(id, title, id === 'transport' ? 'transport' : 'facilities', 'dynamic', sec, [{ type: 'paragraph', text: `资料截至${snapshot}，设施收录不等于当前开放、收费或服务保证；地标级位置不是精确导航坐标。` }, ...get(sec)], [...words], [...refs]);
  }
  // A dedicated high-priority chunk keeps the contradictory J-exit reports together.
  const jExit = get('3.6').filter(b => b.type === 'paragraph' && /J出口|J口/.test(b.text));
  add('transport-j-exit', '世界之窗站 J 出口施工与开放状态', 'transport', 'dynamic', '3.6',
    `资料截至${snapshot}，不能确认今天已恢复开放。\n${jExit.map(render).join('\n')}`, ['J出口', 'J口', '施工', '关闭', '恢复', '开放'], [14, 15]);
  const routes = get('4.2');
  for (let no = 1; no <= 5; no++) {
    const code = `R0${no}`;
    const start = routes.findIndex(b => b.type === 'paragraph' && b.text.startsWith(code));
    const end = routes.findIndex((b, i) => i > start && b.type === 'paragraph' && /^R0\d/.test(b.text));
    if (start < 0) throw new Error(`Missing route ${code}`);
    const selected = routes.slice(start, end < 0 ? undefined : end);
    const title = render(selected[0]);
    add(`route-${code.toLowerCase()}`, title, 'itinerary', 'editorial', '4.2',
      `编辑推荐模板，非官方路线、最短路径或实地计时；时长为估算，需核对当日开放与演出。\n${selected.map(render).join('\n')}${no === 1 ? '\n校对说明：4.2明细合计350分钟；原文4.3写约355分钟，存在5分钟口径差异，保留5—7小时估算范围，不作为精确承诺。' : ''}`,
      [code, '路线', '行程', '顺序', '安排', '怎么玩', '推荐', ...([
        ['全景', '经典', '一日', '一天', '首次'], ['精华', '地标', '三小时', '3小时', '半日', '半天'],
        ['亲子', '孩子', '小孩', '带娃', '儿童'], ['游乐', '刺激', '朋友', '青少年', '动感'], ['夜游', '夜景', '晚上', '夜场', '浪漫', '情侣', '演艺'],
      ][no - 1])], [8, 10]);
  }
  for (const [sec, id, title] of [['4.1', 'itinerary', '路线总览与适用人群'], ['4.3', 'route-duration', '路线时长估算与误差'], ['4.4', 'route-audience', '按游客需求选择路线'], ['4.5', 'route-planning', '路线规划原因与实时限制']] as const) {
    chunks(id, title, 'itinerary', 'editorial', sec, get(sec), ['路线', '行程', '规划', '时长', '适合', '人群', '推荐'], [8, 10]);
  }
  return knowledgeSchema.parse({ id: 'shenzhen-window-of-world', name: '深圳世界之窗', aliases: ['深圳世界之窗', '世界之窗', 'Window of the World'],
    version: 2, sources, entries, document: { filename: archive.filename, sha256: archive.sha256, snapshot_date: snapshot } });
}

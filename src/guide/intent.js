import { pois, getHotspot } from '../data/pois.js';

const ALL_POIS = pois.map(poi => poi.id);
const STOP = /^(?:小旅|星遥|沐沐|绒绒|汪可|赤狐)?(?:请)?(?:先)?(?:结束陪游|结束对话|结束聊天|停止陪游|关闭麦克风|关闭语音|停|停一下|暂停(?:一下|讲解|解说)?|停止(?:讲解|解说|播放)?|别说了|不要讲了|不讲了|安静|打断)(?:吧|了)?$/;
const YES = /^(?:好|好的|好呀|好啊|可以|行|确认|确定|就它|就这个|去吧|走吧|开始吧|带我去|嗯|是的|对|ok|yes)$/i;
const NO = /^(?:不|不要|不用|不用了|不了|不去|不看|先不了|算了|取消|拒绝|不是|不对|不是这个|不需要|暂时不要)(?:了|吧|谢谢)?$/;
const NEGATION = /不(?:去|看|介绍|了解|讲|听|返回|回到|切换|打开|展开)|(?:不想|不要|别|不愿|不需要|不用|先不|暂不).{0,6}(?:去|看|打开|切换|介绍|展开|讲|听|了解|返回|回|退出|推荐)|不用|取消|不是|先不|暂不/;
const DISTANCE = /远不远|远吗|有多远|多远|距离|离.{0,8}远|怎么走|多久能到|走多久|步行|到.{0,8}多久/;
const CROWD = /人多|人流|拥挤|排队|挤不挤|队伍|人少|人多不多/;
const DETAILS = /详情|详细|故事|文物|展开|结构|细节|介绍这个|介绍它|介绍这里|介绍这座|讲讲这个|讲讲它/;
const RECOMMEND = /推荐|第一次|首次|不知道.*(?:去|看)|先.*(?:去|看).*哪|逛哪里|去哪|看什么|带我逛/;
const OPEN = /带我(?:去|看|到)|看看|看一下|想看|我要看|^看|打开|进入|全景|去|介绍|了解|讲讲|是什么|什么是/;
const OUT_OF_SCOPE = /天气|下雨|温度|门票|票价|营业|开门|闭园|厕所|洗手间|餐厅|吃饭|买票|地铁|公交/;
// Any words remaining after this finite vocabulary could be an unknown named target.
// In that case ask which supported point, rather than substituting the old topic.
const GENERIC_REFERENCE_WORDS = [
  '能不能', '可不可以', '我想知道', '我想了解', '人多不多', '远不远', '挤不挤', '这座建筑', '这个建筑', '那座建筑', '那个建筑', '这个景点', '那个景点',
  '请问', '请你', '麻烦你', '麻烦', '小旅', '星遥', '沐沐', '绒绒', '汪可', '赤狐', '帮我', '让我', '带我', '可以', '我想', '想要', '我要', '一下', '看看', '看一下', '介绍', '了解', '讲讲', '说说',
  '这个', '那个', '这座', '那座', '这里', '那里', '这儿', '那儿', '这边', '那边', '该景点', '它', '目前', '现在', '实时',
  '有多远', '多远', '距离', '步行', '过去', '多久', '需要', '排队', '人流', '人多', '人少', '拥挤', '队伍', '多少', '分钟', '情况', '时间', '演示入口', '入口', '起点', '到底', '究竟', '怎么', '是否',
  '详情页', '详情', '详细', '展开', '打开', '进入', '全景', '文物', '景点', '建筑', '细节', '有什么', '故事', '结构',
  '请', '我', '我们', '想', '要', '的', '吗', '呢', '啊', '呀', '吧', '不', '有', '多', '少', '远', '近', '从', '离', '到', '走', '能', '去', '看', '讲', '给', '为', '替', '米',
].sort((a, b) => b.length - a.length);

function cleanText(value) {
  return String(value ?? '').trim().replace(/[\s，。！？、；：,.!?;:]/g, '').toLowerCase();
}

export function mentionedPois(text) {
  // Match longest names first: “卢浮宫金字塔” must not also match “金字塔”.
  const names = pois.flatMap(poi => [poi.name, ...poi.aliases, poi.id].map(name => ({ name:name.toLowerCase(), id:poi.id }))).sort((a,b) => b.name.length-a.name.length);
  const spans = []; const found = new Set();
  for (const item of names) {
    let offset = text.indexOf(item.name);
    while (offset !== -1) {
      const end = offset + item.name.length;
      if (!spans.some(span => offset < span.end && end > span.start)) { spans.push({start:offset,end}); found.add(item.id); }
      offset = text.indexOf(item.name, end);
    }
  }
  return pois.filter(poi => found.has(poi.id)).map(poi => poi.id);
}

function clarification(kind, pendingIntent, candidates = ALL_POIS) {
  return { type: 'clarify', kind, candidates: [...candidates], pendingIntent: { ...pendingIntent } };
}

function isGenericReference(text) {
  let rest = text;
  for (const word of GENERIC_REFERENCE_WORDS) rest = rest.split(word).join('');
  return !rest;
}

function isBarePoi(text, id) {
  const poi = pois.find(item => item.id === id);
  return [poi.name, ...poi.aliases, poi.id].some(name => ['', '呢', '吧', '呀', '啊'].some(suffix => text === `${name.toLowerCase()}${suffix}`));
}

/** Finite local rules, deliberately not an open-ended language model. No UI changes occur here. */
export function resolveLocalIntent(input, state = {}) {
  const text = cleanText(input);
  if (!text) return { type: 'empty' };
  if (STOP.test(text)) return { type: 'stop' };
  if (/^(?:继续|继续讲|继续讲解|继续解说|接着说|接着讲)$/.test(text)) return { type: 'resume' };
  if (NO.test(text)) return { type: 'reject' };
  if (YES.test(text)) {
    const pending = state.clarification;
    if (pending?.candidates?.length === 1 && pending.pendingIntent) return { ...pending.pendingIntent, poiId: pending.candidates[0] };
    if (pending) return clarification('choose-poi', pending.pendingIntent ?? { type: 'open-poi' }, pending.candidates?.length ? pending.candidates : ALL_POIS);
    return { type: 'acknowledge' };
  }
  if (/保存|下载/.test(text)) return { type: 'unsupported-save' };
  // Route constraints (including exclusions) must not be mistaken for a local POI command.
  if (/路线|行程|规划|先.{0,12}再|从.{0,20}到|怎么逛|怎么玩|游览顺序|安排.{0,20}(?:游|逛|景点)/.test(text)
    || state.plannedRoute && /调整|换成|去掉|加上|加入|反过来|倒过来|不要去|不去/.test(text)) return { type: 'unknown' };
  const ids = mentionedPois(text);
  if (NEGATION.test(text.replace(/是不是/g, '是否'))) return { type: 'reject' };
  if (/返回地图|回到地图|打开地图|看地图|平面地图|回地图|退出全景/.test(text)) return { type: 'map' };
  const facilityKind = /卫生间|洗手间|厕所|洗手|洗漱/.test(text) ? 'toilets' : /出入口|出口|离园|出园|园界门|大门/.test(text) ? 'gate' : /服务区|服务中心|服务点|票务中心|客服电话|联系园区|国际街/.test(text) ? 'service' : /餐厅|吃饭|餐饮/.test(text) ? 'food' : /停车场|停车/.test(text) ? 'parking' : null;
  if (facilityKind) return /不找|别找|不想|不需要|不要|不用/.test(text) ? {type:'reject'} : {type:'facility',kind:facilityKind};
  if (OUT_OF_SCOPE.test(text)) return { type: 'unknown' };
  if (!ids.length && !DETAILS.test(text) && !DISTANCE.test(text) && !CROWD.test(text) && /拍照|摄影|打卡|建筑|历史|亲子|孩子/.test(text)) return { type: 'recommend', preference: /亲子|孩子/.test(text) ? 'family' : /建筑|历史/.test(text) ? 'architecture' : 'photo' };

  let type;
  if (DISTANCE.test(text)) type = 'distance';
  else if (CROWD.test(text)) type = 'crowd';
  else if (DETAILS.test(text)) type = 'details';
  else if (!ids.length && RECOMMEND.test(text)) return { type: 'recommend' };
  else if (OPEN.test(text)) type = 'open-poi';
  else if (ids.length && state.clarification?.pendingIntent) type = state.clarification.pendingIntent.type;
  else if (ids.length === 1 && isBarePoi(text, ids[0])) type = text.endsWith('呢') && ['distance', 'crowd', 'details'].includes(state.lastIntent?.type) ? state.lastIntent.type : 'open-poi';
  else if (ids.length > 1) type = 'open-poi';
  else return { type: 'unknown' };

  if (ids.length > 1) return clarification('multiple-pois', { type }, ids);
  if (ids.length === 1) {
    const poi = pois.find(item => item.id === ids[0]);
    let rest = text;
    for (const name of [poi.name, ...poi.aliases, poi.id].sort((a, b) => b.length - a.length)) rest = rest.split(name.toLowerCase()).join('');
    if (!isGenericReference(rest.replace(/是不是/g, '是否'))) return clarification('unknown-poi', { type });
    return { type, poiId: ids[0] };
  }

  if (!isGenericReference(text)) return clarification('unknown-poi', { type });
  if (state.clarification) {
    const pending = state.clarification;
    if (pending.kind === 'confirm-recommendation' && pending.candidates?.length === 1) return { type, poiId: pending.candidates[0] };
    return clarification(pending.kind ?? 'choose-poi', { type }, pending.candidates?.length ? pending.candidates : ALL_POIS);
  }
  const hotspot = getHotspot(state.selectedPoiId, state.activeHotspotId);
  const topic = state.mentionedPoiId;
  // A visible default selection is not evidence of the visitor's conversation topic.
  if (type === 'details' && hotspot) return { type, poiId: state.selectedPoiId, hotspotId: hotspot.id };
  if (topic) return { type, poiId: topic };
  return clarification('choose-poi', { type });
}

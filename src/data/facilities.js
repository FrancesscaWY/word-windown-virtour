import { parkServices } from './park-services.js';
export { parkServices };
export const facilities = [...parkServices.facilities, {
  id:'official-ticket-center',kind:'service',name:'前广场票务中心',position:null,
  source:'https://www.ctgii.com/scenic/theme_park/62',sourceKind:'中旅国际 · 运营方',
  note:'官方公布的线下票务办理地点：世界之窗前广场票务中心。咨询电话 0755-26608000（票务分机 8105）。尚未取得可核实坐标。',phone:'075526608000',
}, {
  id:'international-street',kind:'service',name:'国际街商业服务区',position:null,
  source:'https://m.bendibao.com/show3448_5.html',sourceKind:'深圳本地宝 · 2024 年资料',
  note:'公开资料介绍为休憩、购物和餐饮区域。尚未取得可核实坐标，当前营业内容请以现场为准。',
}];
export const facilityKinds = {toilets:'卫生间',gate:'出入口',service:'服务',food:'餐饮',parking:'停车场'};
export function facilityResult(kind, id = null) {
  const items = facilities.filter(item => id ? item.id === id : item.kind === kind);
  const title = id && items.length ? items[0].name : facilityKinds[kind] ?? '园区服务';
  const text = kind === 'gate' ? '找到两处园界门，还不能确认是否开放。离园请跟随现场出口指示。'
    : kind === 'toilets' ? '卫生间标好啦。还没有你的定位，不能判断哪一处最近；开放情况以现场为准。'
    : kind === 'service' ? '想歇歇脚，看看国际街；票务问题找前广场票务中心，也可以拨打园区电话。'
    : items.length ? `已标出公开地图中的${title}，开放情况以现场为准。` : `还没有核实园内${title}的位置，可以向工作人员询问，或点服务气泡联系园区。`;
  return {kind,id,title,text,items:items.length ? items : facilities.filter(item => item.kind === 'service')};
}

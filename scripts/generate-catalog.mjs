import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { osmAttractions, buildOsmMap, osmParkServices } from './osm-map.mjs';
import { externalAssets } from '../src/data/external-assets.js';
const root = new URL('../', import.meta.url);
const raw = JSON.parse(await readFile(new URL('public/assets/world-window-osm-source.json', root), 'utf8'));
const anchors = osmAttractions(raw, externalAssets.map.bbox);
// Names verified against each OSM object; descriptions describe the represented landmark.
const rows = [
[264187661,'eiffel','埃菲尔铁塔','欧洲区','铁塔|埃菲尔','世界之窗的铁塔以巴黎埃菲尔铁塔为原型。观察轮廓，从宽阔的塔脚到细长塔尖，线条一路向上收拢。'],
[264187657,'arc','凯旋门','欧洲区','巴黎凯旋门','这里重现了巴黎凯旋门的建筑形象。中央大拱门和两侧厚实的墩柱，构成庄重的对称轮廓。'],
[1150884224,'pyramid','金字塔','非洲区','吉萨金字塔|基撒金字塔','这里表现埃及吉萨金字塔群。沿着三角形的边缘看，古老建筑的几何秩序就显现出来了。'],
[1150884223,'taj','泰姬陵','亚洲区','泰姬玛哈尔陵','泰姬陵的原型位于印度阿格拉。中央穹顶与左右对称的布局，是认识这座建筑的线索。'],
[1150884236,'katsura','桂离宫','亚洲区','','桂离宫的原型位于日本京都。它将建筑与庭园联系在一起，适合从屋顶、廊道与周围绿意慢慢看起。'],
[1150884237,'colosseum','罗马斗兽场','欧洲区','罗马竞技场|斗兽场','罗马斗兽场的原型是古罗马圆形竞技场。观察一层层重复的拱券，想象它们如何环绕整座建筑。'],
[245754224,'caesar','凯撒宫','欧洲区','','OSM 将这里标为凯撒宫。园内的实际开放内容与活动安排，请以现场公告为准。'],
[2698464241,'fuji','富士山','亚洲区','','这里用微缩景观呈现日本富士山。它的标志是近似圆锥的山体轮廓。'],
[2700408827,'sydney','悉尼歌剧院','大洋洲区','歌剧院','悉尼歌剧院的原型位于澳大利亚悉尼港。白色屋顶像展开的帆，也像层叠的贝壳。'],
[2700408840,'cologne','科隆大教堂','欧洲区','科隆主教座堂','科隆大教堂的原型位于德国科隆。双塔与尖拱构成向上的节奏，可以先从正面寻找对称轴。'],
[2700416312,'niagara','尼亚加拉大瀑布','美洲区','尼亚加拉瀑布|尼加拉大瀑布','这里以北美尼亚加拉瀑布为原型营造水景。现场水景开放状态以园区安排为准。'],
[2700416319,'liberty','自由女神像','美洲区','自由女神','自由女神像的原型位于美国纽约。举起的火炬与头冠，是最容易辨认的轮廓。'],
[2700416390,'moai','复活节岛石像','大洋洲区','复活岛|复活节岛|摩艾石像','这里展示智利复活节岛摩艾石像的形象。细长脸庞与厚重轮廓，让石像显得安静而有力量。'],
[4235757660,'pyramid-adventure','金字塔探秘','非洲区','','OSM 记录了金字塔探秘这个游览点。具体体验与开放安排，请查看现场指示。'],
[9630527158,'warriors','墨西哥凝神武士像','美洲区','凝神武士','这里以墨西哥武士石像为题材。看一看直立的姿态与装饰细节，和旁边的建筑景观作个比较。'],
[10705991223,'egypt-gate','埃及门','非洲区','','OSM 将这里标为埃及门。它是认识园内埃及主题景观的一个入口线索。'],
[10705991224,'versailles','凡尔赛宫','欧洲区','','凡尔赛宫的原型位于法国。对称立面与庭园轴线，是观察宫殿空间的好起点。'],
[10705991225,'pisa','比萨斜塔','欧洲区','斜塔','比萨斜塔的原型位于意大利。除了倾斜的姿态，还可以留意塔身一层层环绕的柱廊。'],
[10705991238,'manhattan','曼哈顿建筑群','美洲区','曼哈顿|纽约建筑群','这里以纽约曼哈顿的高层建筑为原型。高低不同的楼群一起组成城市天际线。'],
[10705991239,'whitehouse','白宫','美洲区','','白宫的原型位于美国华盛顿。白色立面和柱廊是辨认它的线索。'],
[10705991240,'capitol','美国国会大厦','美洲区','美国国会','美国国会大厦的原型位于华盛顿。穹顶处在中轴线上，左右两翼向外伸展。'],
[10705991241,'lincoln','林肯纪念堂','美洲区','','林肯纪念堂的原型位于美国华盛顿。环绕建筑的柱廊令人想到古典神庙。'],
[10705991242,'jefferson','杰斐逊纪念堂','美洲区','杰弗逊纪念堂','杰斐逊纪念堂的原型位于美国华盛顿。圆形穹顶与柱廊是它的主要建筑特征。'],
[10705991276,'rushmore','总统山','美洲区','拉什莫尔山','这里表现美国拉什莫尔山的总统头像雕刻。可以从不同面孔的轮廓辨认这组山体雕塑。'],
[10705991277,'nazca','纳斯卡图线','美洲区','纳斯卡线条|那斯卡图线','纳斯卡图线的原型位于秘鲁。它以巨大的几何线条和图案闻名，这里用景观形式进行表现。'],
[10705991308,'tower-bridge','伦敦塔桥','欧洲区','塔桥','伦敦塔桥的原型横跨英国泰晤士河。两座塔楼和相连的桥面，组成鲜明的轮廓。'],
[10705991309,'westminster','英国国会大厦','欧洲区','大本钟|威斯敏斯特宫|英国国会','英国国会大厦的原型是伦敦威斯敏斯特宫。钟塔与沿河展开的建筑立面，构成经典的伦敦景象。'],
[10705991310,'buckingham','白金汉宫','欧洲区','','白金汉宫的原型位于英国伦敦。平整而对称的立面，可以与附近宫殿主题景观对照着看。'],
[10705991311,'winter','冬宫','欧洲区','圣彼得堡冬宫','冬宫的原型位于俄罗斯圣彼得堡。立面上的柱式、窗框与装饰带，形成连续的节奏。'],
[10705991312,'kuwait','科威特水塔','亚洲区','科威特塔','科威特水塔以科威特城的水塔建筑为原型。塔身上的球形结构让它容易辨认。'],
[10705991313,'stonehenge','巨石阵','欧洲区','斯顿亨治|环状列石','巨石阵的原型位于英国。竖立的石块与横向石梁，形成古老的环状空间。'],
[10705991314,'alhambra','阿尔罕布拉宫狮子院','欧洲区','狮子庭院|狮子院','狮子院的原型位于西班牙阿尔罕布拉宫。庭院、柱廊与喷泉彼此呼应。'],
[10705991315,'shwedagon','仰光大金塔','亚洲区','大金塔','仰光大金塔的原型位于缅甸仰光。由下而上收拢的塔身与金色外观是它的代表形象。'],
[10705991316,'borobudur','婆罗浮屠','亚洲区','','婆罗浮屠的原型位于印度尼西亚爪哇岛。层层台基和钟形佛塔，可以从整体轮廓慢慢辨认。'],
[10705991317,'angkor','吴哥窟','亚洲区','吴哥窑','吴哥窟的原型位于柬埔寨。中央塔群与回廊构成层层深入的建筑布局。'],
[10705991339,'gyeongbok','景福宫','亚洲区','','景福宫的原型位于韩国首尔。可以从殿宇屋顶与台基的关系观察宫殿建筑。'],
[10705991340,'grand-palace','泰王宫','亚洲区','泰国大皇宫','泰王宫以泰国曼谷的大皇宫建筑群为原型。层叠屋顶与尖顶装饰是值得留意的细节。'],
[10705991341,'himeji','姬路城','亚洲区','姬路城天守阁','姬路城的原型位于日本。白色城楼与层叠屋檐，使它又有白鹭城的美称。'],
[10705991342,'isfahan','伊斯法罕清真寺','亚洲区','伊斯法罕清真大寺','这里以伊朗伊斯法罕的清真寺建筑为主题。拱门、穹顶与装饰纹样，可以作为观察线索。'],
[10705991343,'kremlin','克里姆林宫','欧洲区','克里姆林宫墙及钟楼','这里呈现莫斯科克里姆林宫的城墙和钟楼形象。城墙与高塔共同组成防御建筑轮廓。'],
[10705991370,'continents','四大洲喷泉','欧洲区','','四大洲喷泉以巴黎的同名喷泉为原型。雕塑与水景结合，形成可以环绕观看的空间。'],
[10705991371,'notre-dame','巴黎圣母院','欧洲区','圣母院','巴黎圣母院的原型位于法国巴黎。正面的双塔、门洞与圆形窗，是认识它的线索。'],
[10705991372,'world-fountain','世界地图喷泉','世界广场','','OSM 在这里记录了世界地图喷泉。可以结合全园地图，看看不同区域如何安排在一起。'],
[10705991373,'merlion','鱼尾狮','亚洲区','狮头鱼身像','鱼尾狮是新加坡的代表形象。狮头与鱼身的组合，把城市象征与海洋联系起来。'],
];
const catalog = rows.map(([osmId,id,name,region,aliases,summary]) => {
  const anchor = anchors.find(item => item.osmId === osmId);
  if (!anchor) throw new Error(`Unverified coordinate: ${name}`);
  return { id,name,region,aliases:aliases.split('|').filter(Boolean),summary,position:anchor.position,source:anchor.source,sourceKind:'OSM 地点记录',locationVerified:true };
});
// Supplementary names are from the encyclopedia's park list, not a current official inventory.
const supplemental = {
'世界广场':['卢浮宫金字塔','世界文化浮雕墙','环球舞台'],
'亚洲区':['东京塔','皇居','严岛神社鸟居','普通门','玉佛寺','桑吉大佛塔','坎德里雅湿婆神庙','摩诃菩提寺','太阳神庙','巴贾石窟','卡拉石窟','将东寺','一柱寺','斯瓦扬布纳特','极乐寺','星期五清真寺','伊什塔尔门','圣索菲亚大教堂'],
'非洲区':['狮身人面像','阿布辛贝勒神庙','亚历山大灯塔','蒙巴萨象牙门','马赛马拉野生动物园'],
'欧洲区':['圣米歇尔山','加尔桥','雅典卫城','圣彼得大教堂','圣马可广场','荷兰风车','郁金香田园','奎尔公园','红场','圣瓦西里主教座堂','马特洪峰'],
'美洲区':['洛杉矶迪士尼乐园','五角大楼','金门大桥','印第安图腾柱','基督山','卡斯蒂略金字塔'],
'大洋洲区':['悉尼港湾大桥','乌卢鲁','毛利民居'],
};
const ids = { '荷兰风车':'windmills','伊什塔尔门':'ishtar','圣米歇尔山':'saint-michel','圣瓦西里主教座堂':'saint-basil','奎尔公园':'guell' };
let sequence = 0;
for (const [region,names] of Object.entries(supplemental)) for (const name of names) catalog.push({
 id:ids[name] ?? `listed-${++sequence}`,name,region,aliases:name==='东京塔'?['东京铁塔']:[],
 summary:`公开景点名录将${name}列入世界之窗${region}。该条目尚未核对园内具体位置，现场是否保留及开放，请以园区公告为准。`,
 position:null,source:'https://zh.wikipedia.org/w/index.php?title=世界之窗_(深圳)&oldid=93793150',sourceKind:'百科景点名录 · 待现场核对',locationVerified:false,
});
for (const name of ['丛林捣蛋','侏罗纪水世界','米开朗琪罗奇遇','暹罗小飞象','马丘比丘迷城','空中花园','追梦乐园','激流大峡谷','大战金刚','穿越欧罗巴','亚马逊丛林穿梭','法老归来','富士山影院']) catalog.push({
 id:`ride-${++sequence}`,name,region:'游乐体验',aliases:[],summary:`中国旅游集团的世界之窗介绍列有${name}。具体开放时间、身高限制和排队情况，请以现场公示为准。`,position:null,source:'https://www.ctg.cn/article/95',sourceKind:'中国旅游集团',locationVerified:false,
});
for (const [id,name] of [['roaring-valley','咆哮山谷'],['speed-car','极速飞车'],['spartan','斯巴达勇士训练营']]) catalog.push({
 id,name,region:'游乐体验',aliases:[],summary:`中旅国际的世界之窗介绍列有${name}。具体开放安排和参与限制请以现场公示为准。`,position:null,source:'https://www.ctgii.com/scenic/theme_park/62',sourceKind:'中旅国际 · 运营方介绍',locationVerified:false,
});
const services = osmParkServices(raw, externalAssets.map.bbox);
await writeFile(new URL('src/data/park-services.js', root), `// Generated from OSM; no guessed facility coordinates.\nexport const parkServices = ${JSON.stringify(services,null,2)};\n`);
await writeFile(new URL('public/assets/park-services.json', root), JSON.stringify({checkedAt:'2026-11-09',complete:false,...services},null,2));
await writeFile(new URL('src/data/park-catalog.js', root), `// Generated by node scripts/generate-catalog.mjs. Coordinates are never guessed.\nexport const parkCatalog = ${JSON.stringify(catalog,null,2)};\n`);
await writeFile(new URL('public/assets/park-catalog.json', root), JSON.stringify({checkedAt:'2026-11-09',completeOfficialInventory:false,officialScale:'130多处景观（中国旅游集团）',entries:catalog},null,2));
const map = buildOsmMap(raw, { bbox:externalAssets.map.bbox });
await writeFile(new URL('public/assets/world-window-map.svg', root), map.svg);
externalAssets.map.sha256 = createHash('sha256').update(map.svg).digest('hex');
await writeFile(new URL('src/data/external-assets.js', root), `export const externalAssets = ${JSON.stringify(externalAssets,null,2)};\n`);
const manifestUrl = new URL('public/assets/downloaded-manifest.json', root);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
manifest.active.map = externalAssets.map;
await writeFile(manifestUrl, JSON.stringify(manifest,null,2));
console.log(`${catalog.length} sourced entries; ${catalog.filter(p=>p.position).length} OSM anchors`);

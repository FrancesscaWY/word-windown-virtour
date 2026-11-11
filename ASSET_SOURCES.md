# 世界之窗资源来源

更新：2026-11-09。可核对名录不等于完整官方名录；历史照片不代表今日运营状态。

## 地理底图

OSM 官方 API：<https://api.openstreetmap.org/api/0.6/map.json?bbox=113.9624,22.533,113.9736,22.5421>。
园界：[way/236402460](https://www.openstreetmap.org/way/236402460)。原始数据为 `public/assets/world-window-osm-source.json`；本地底图为 `public/assets/world-window-map.svg`。

© OpenStreetMap contributors，ODbL 1.0：<https://www.openstreetmap.org/copyright>。SVG 将 OSM 几何转为项目配色，采用等比例局部投影。目录的 44 个坐标均来自园界内的具名对象，外部华侨城湿地展厅已排除。三个金字塔模型按一个游览点归并；金字塔探秘作为独立 OSM 条目保留。

完整园界已纳入下载范围；首页采用全园适配视角，只绘制园界内的地理细节，园外由页面背景留白。SVG 不再内嵌白色署名条，来源保留在 SVG 描述与清单中；页面右下角统一显示可点击的 © OpenStreetMap contributors 署名。原始数据和 SVG 的 SHA-256 见 `downloaded-manifest.json`。

## 景点名录

- 44 条园内 OSM 具名地点：逐项链接和坐标见 `public/assets/park-catalog.json`。
- 46 条补充景观名称：[维基百科世界之窗（深圳）固定版本](https://zh.wikipedia.org/w/index.php?title=世界之窗_(深圳)&oldid=93793150)。该页面为 CC BY-SA 4.0，项目按名称整理、简体化，并重新编写说明。标注“百科景点名录 · 待现场核对”，不编造坐标或当日开放状态。
- 13 条游乐体验：[中国旅游集团世界之窗介绍](https://www.ctg.cn/article/95)。该页同时介绍园内 130 多处景观，但没有给出完整清单。本项目只引用列出的体验名称和来源，不复制其文章或图片。

- 3 条新增运营方记录：[中旅国际世界之窗介绍](https://www.ctgii.com/scenic/theme_park/62)：咆哮山谷、极速飞车、斯巴达勇士训练营。共 106 条来源记录，仍非全量在营清单。

结构化名录中的 OSM 衍生地点信息适用 ODbL；百科整理内容按 CC BY-SA 4.0 提供来源。讲解将园内微缩景观与其原型区分，不推断园内建筑尺寸或现场设施。

## 设施与服务区

- [卫生间 node/4809251648](https://www.openstreetmap.org/node/4809251648)：园界内 `amenity=toilets`。当前 OSM 数据只有这一处可用记录，不表示全园只有一个卫生间。记录时间为 2017 年，开放状态未核实。
- [园界门 node/2444331156](https://www.openstreetmap.org/node/2444331156)及[node/2698482340](https://www.openstreetmap.org/node/2698482340)：位于园界节点，只有门标签。未验证游客通行方向与开放状态，UI 明示“园界门 · 待核实”，不输出出口路线。内部围栏门、园外设施、private/no/foot=no 记录被排除。
- [中旅国际运营方介绍](https://www.ctgii.com/scenic/theme_park/62)明确前广场票务中心、咨询电话 0755-26608000（票务分机8105）。未提供可靠坐标，只作为服务卡；电话由游客点击后调用系统拨号。
- [深圳本地宝 2024 年攻略](https://m.bendibao.com/show3448_5.html)介绍国际街商业服务区的休憩、购物、餐饮用途。保留时效说明，不虚构地图位置或开放状态。
- 生成的园界和设施几何在 `public/assets/park-services.json`，OSM 衍生部分适用 ODbL。设施覆盖不全，没有实时开放核验或游客定位。

## 园内照片

从 [Wikimedia Commons 世界之窗分类](https://commons.wikimedia.org/wiki/Category:Window_of_the_World) 的官方 API 获取元数据。成功下载并目视核对 10 张普通照片，展示 12 个地点：铁塔与金字塔共享一张园内同框照片；白宫与总统山共享一张园内同框照片。其余为凯旋门、英国国会大厦、白金汉宫、荷兰风车、婆罗浮屠、科隆大教堂、罗马斗兽场、比萨斜塔。

每张照片的源页面、原下载地址、作者、CC / CC0 许可、拍摄时间、原始 SHA-256 与本地 SHA-256 均在 `public/assets/park-photos-manifest.json`。许可链接及署名显示于景点详情。图片等比缩小至最长边 1600 像素、JPEG 质量 87，未裁切或拉伸，合计约 4.6 MB。后续未成功下载的图片没有激活。

这些照片全部属于普通平面实拍，不传给球形全景播放器；宽高比不能证明一张图片是 360°。

## 单轨参考图

[Commons 来源](https://commons.wikimedia.org/wiki/File:Windows_On_The_World_(Shenzhen)_Monorail_route_map_(OpenStreetMaps).jpg)，OpenStreetMap contributors; Tjej / Timothy Joy，CC BY-SA 4.0。805 × 519 JPEG，本地 `world-window-reference-map.jpg`。仅在说明页供路线参考，不作为全园地图或定位依据。

## 360° 查找结果与缺口

- [指尖上世界之窗](https://www.zhijianshang.com/shenzhen-window-of-the-world/)公开介绍全园、美洲、亚洲及凯旋门等全景；其影像配置请求返回 403，条款未授予重新分发许可，未下载或接入受限制素材。
- [720云作品](https://www.720yun.com/t/b6424mrOmu6)及[另一园区作品](https://www.720yun.com/t/f5vkzlq7g2q)在当前环境请求返回 502，不能验证播放或逐景点覆盖。
- [全景再现园区作品](https://www.720real.com/t/56cb25cd4d73ff63)返回会员登录与付费提示，不是可直接接入的免费资源。

- [官方微信小程序落地页](https://mp.weixin.qq.com/miniprogram/landing_page/YBJw_6MEoVO7ubwi5Pq3ntHU/en)：开发者为深圳世界之窗有限公司。[2021年智慧导览介绍](https://sz.bendibao.com/tour/2021114/ly856329.html)提及 360 实景 AR，但公开页面没有可导出的完整名录、逐场景图像或可验证的 Web 播放器。关于页面提供官方入口，未宣称嵌入成功。
- [9kvr 世界之窗页](https://web.9kvr.cn/index/scenic/detail.html?id=19589)：标题包含 VR，正文显示 0 个全景作品、暂无 VR 全景作品，因此没有接入。
- 搜索中出现的 `s.sjzc100.cc` 无法核实为景区官方，内容与景区不符，未用作官方来源。

因此当前园区可用 360° 为 0。需要园方授权的全景图、可合法嵌入的播放器及场景清单，或自行拍摄的完整球面素材，才能补齐逐景点全景。未复制付费内容，也未将全园鸟瞰冒充各景点独立全景。

`demo-panorama.png` 按用户要求恢复为铁塔的示例漫游入口：2048×1024 原创程序绘制的球面插画，CC0-1.0，来源与哈希见 `public/assets/manifest.json`。页面标注“示例全景”，不计入真实园区全景覆盖。旧下载器里的巴黎铁塔候选也不会写入当前游客景点数据。

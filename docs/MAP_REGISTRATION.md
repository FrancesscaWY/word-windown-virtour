# 手绘地图路网配准

> 路网部分已被后续方案替代：用户反馈 OSM 配准仍无法贴合插画，当前页面与路线改用 [沿底图人工描绘的路网](ARTWORK_ROADS.md)。本文保留旧 OSM 配准方案的历史记录；景点和设施的显示投影仍在使用。

## 显示与坐标

地图继续使用 `public/assets/map.jpg`（1339 × 1174）。用 68 个图像控制点和四个画布角点建立分片仿射网格，将 OSM 包围盒百分比坐标投影到手绘图百分比坐标。生成器检查全部 138 个三角形，拒绝翻转或退化的配准。

控制点来自手绘图上的地标基座、道路交点和转弯，并通过 OSM node ID 或景点目录 ID 关联源位置。铁塔、凯旋门、斗兽场、金字塔、泰姬陵和歌剧院使用可辨认的插画锚点。

这是**视觉配准**，不是地理测量。手绘图对道路和建筑做了艺术化处理，部分细支路没有一一对应的画线，局部仍为近似贴合，不能将其作为实测入口或导航精度保证。拟合控制点命中不等于独立测量误差为零。

源景点、设施和定位继续保留原地理坐标；仅在展示时经过 `projectMapPosition`。景点标记、设施标记、聚焦与路线适配、规划道路折线、游客位置及移动轨迹共用这个投影。距离计算与定位到达判断仍使用原经纬度。

## 路网图层

- 使用已有 `public/assets/world-window-osm-source.json`，不依赖浏览器实时请求地图服务。
- 图层生成与后端寻路共用 `buildWalkingGraph`：允许园内 pedestrian、footway、steps、service、path、living_street 线性道路；排除面状广场、施工、明确禁止步行/私有的线段与不可通行节点。
- 本次生成 61 个有园内可显示线段的 OSM way；这不是 61 条独立命名道路。统一边界判定后，包含恰在园界上的门节点对应道路。每条路径保留 `data-osm-way`，便于追溯。
- 长边按原图不超过 2 像素的间距采样后配准，保持共享节点的位置一致。
- 绿色细线叠层位于底图上、景点标记下。台阶使用短虚线，次级步道较细；图层不拦截点击或拖动。
- 右侧「路网」按钮默认打开，使用 `aria-pressed` 表示状态，支持键盘。设置存入 `virtour.map.roads.visible`；存储不可用时仍可切换。
- 路网可见性与紫色规划路线相互独立。`plan_route` 已接入后端沿路寻路，紫色路线与绿色路网共用 `projectMapLine` 的两像素采样和显示投影。

## 规划路线

LLM 负责选择 2—12 个景点及游览顺序，后端 `server/ai/walking-network.ts` 读取已有 OSM 快照并缓存道路图，在相邻站点的道路锚点间运行 Dijkstra。仅实际共享 OSM 节点的道路相连；交叉但无共享节点、端点相近的道路不自动连接，不生成跨越园外的捷径。节点与道路的步行限制、已锁门、台阶及步行单向标签纳入计算；车辆单向不直接等同于步行单向。

景点锚定到目录中心 100 米以内最近的已收录道路节点，**不等于已核实入口**。当前 44 个有坐标景点均可匹配且连接到主路网，但个别点的偏移接近 100 米。不会绘制景点到道路的虚构连接线。共享道路节点的相邻景点可有零长度路段；全部站点共享同一节点、缺少锚点、道路不连通或数据不可用时返回 unavailable，前端保留之前的路线。

成功结果包含：

- `stops[].roadAnchor`：节点 ID、地理百分比坐标、距目录点的偏移及 `entranceVerified:false`。
- `geometry`：`osm-walking` 类型、原始道路节点百分比 `points`、`nodeIds`、每条边的 `wayIds`、`stopIndices`、分段 `legs` 及源文件 SHA-256。`stopIndices` 可重复，含绕行与折返，不能用站点数代替折线节点数。
- `distanceMeters`：各路网段取整米数之和，不含入口连接、入场及景点内部行走；`hasSteps`、`hasGates` 仅反映快照标签，不保证实时开放或无障碍。
- OSM 来源、署名、许可及说明。

前端校验坐标范围、数量上限、节点/边/分段长度、站点索引与锚点一致性，并要求源文件哈希与配准数据一致。缺失或不合法几何不会回退成直线。动画按采样后的路程推进，在 `stopIndices` 对应节点到达时显现站点序号；清除、替换、减少动态效果与后台页面都能正确结束动画。地图适配同时包含完整道路折线和景点标记。

文字、一次性语音和全双工通话都把完整几何留在前端工具事件中；模型只接收路线摘要、分段距离与限制，避免坐标挤占上下文。后续浏览器请求也仅传景点顺序，不把整条几何再上传到 API。

## 文件与再生成

- 人工配准标注：`scripts/map-control-points.mjs`
- 离线三角剖分：`scripts/map-triangulation.mjs`
- 生成器：`scripts/calibrate-map.mjs`
- 运行时投影：`src/components/map-projection.js`
- 显示图层与开关：`src/components/road-network.js`
- 生成网格、路网：`src/data/map-calibration.js`、`src/data/map-roads.js`
- 可下载配准元数据与控制点：`public/assets/map-registration.json`

再生成命令：`node scripts/calibrate-map.mjs`。更换手绘图时须重新标注控制点；仅运行生成器不能自动校准另一张图。源数据和底图的 SHA-256 写入元数据，回归测试会发现底图或原始数据改变后未更新配准的情况。

OSM 数据署名与许可：© OpenStreetMap contributors，ODbL 1.0，<https://www.openstreetmap.org/copyright>。配准文件保留原始数据 URL、哈希与图像尺寸；页面沿用统一署名。

## 验证

- `tests/map-registration.test.mjs`：网格完整覆盖、无翻转与接缝、画布外定位不被拉入图内、源坐标保持不变、文件哈希及道路来源过滤。
- `tests/walking-network.test.mjs`：来源邻接关系、断路、园界、通行方向与限制、道路锚点、数据不可用及重复锚点。
- `tests/routes.test.mjs`：后端顺序、道路几何校验、同路网采样、完整结果与模型摘要分流、后续请求大小。
- `scripts/verify-road-network.mjs`：桌面/手机开关、键盘操作、刷新记忆、缩放对齐、路网与规划线独立显示。
- `scripts/verify-routes.mjs`：文字及语音工具结果、逐段动画、取消与减少动态效果的回归。

浏览器截图在 `agent-tmp/road-network/`；临时全尺寸标注图在 `agent-tmp/real-routes/registered.png`。

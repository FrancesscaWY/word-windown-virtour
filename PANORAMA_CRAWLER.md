# 按坐标采集全景图

运行环境：Node.js 22+，无需额外依赖。坐标取自本地景点目录和 OSM 底图范围，均为深圳园内 WGS84 坐标。默认处理 44 个有坐标的景点；没有坐标的条目不猜填。

```bash
# 离线检查全部任务
npm run panoramas:crawl -- --dry-run
# 先搜索截图中的铁塔、凯旋门、金字塔
npm run panoramas:crawl -- --ids eiffel,arc,pyramid --platforms commons --radius 60
# 全部有坐标景点；Mapillary 需要在 .env 配置 MAPILLARY_ACCESS_TOKEN
npm run panoramas:crawl
```

Mapillary token 从 https://www.mapillary.com/dashboard/developers 申请。不要将 token 提交到 Git。程序只调用公开 API；Commons 每地点最多 50 条，Mapillary 最多 100 条，当前不翻页，不承诺穷尽覆盖。默认检索半径 60 米，可通过 --radius 设置 1–500 米；增大半径会增加相邻景点混入的可能。

输出位于 downloads/panoramas/，report.json 记录每个地点的平台状态、候选距离、来源、许可、拒绝原因、文件和哈希。下载成功仍须人工核对画面是否包含目标景点、作者署名是否完整。不会自动替换网页素材。同一张全景可能覆盖多个附近地点。

Commons 依据图片地理坐标搜索，再要求 JPEG 内包含 GPano 等距柱状投影标记。Mapillary 要求 API is_pano 为真。两者均要求完整 2:1 JPEG、宽度至少 2048，并拒绝能识别的裁切全景。不带标记的真全景可能被保守拒绝；2:1 比例本身不是全景证据。PNG、六面体瓦片和其他投影暂不支持。

## 720云、指尖上等原图链接

这些平台尚未接入自动搜索或瓦片拼接。取得作者授权的 HTTPS 原图链接后，准备 JSON 数组，例如 sources.json：

```json
[
  {
    "poiId": "eiffel",
    "id": "author-scene-1",
    "lat": 22.537039,
    "lon": 113.969433,
    "url": "https://example.com/authorized-original.jpg",
    "source": "https://example.com/scene-page",
    "license": "作者书面授权用于本项目",
    "author": "作者姓名",
    "spherical": true
  }
]
```

spherical:true 表示你已核实该原图为完整球面等距柱状图，不能仅凭宽高比填写。lat/lon 必须是实际拍摄点。

```bash
npm run panoramas:crawl -- --ids eiffel --platforms manual --sources sources.json
```

OSM 本身不提供全景影像；Google Street View 官方静态接口输出视角图片，不提供此程序需要的完整球面原图，因此未作为下载源。没有找到、缺少 token、网络被阻断或 HTTP 403 都会写入报告，不会以普通照片补齐，也不绕过登录和付费限制。平台错误不终止其他任务，命令正常结束不代表已经取得影像，请检查报告。

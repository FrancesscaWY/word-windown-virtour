# VirTour 前后端技术调研与迁移路线

调研日期：2026-11-13。实施更新：用户已确认**仅改后端为 Fastify + TypeScript，前端保持不动**，并直接迁入 `VirtourV2/server` 的 AI 能力、删除旧远端转发，不保留过渡代理。当前实施说明见 [BACKEND_MIGRATION.md](BACKEND_MIGRATION.md)。下文技术表和阶段划分保留调研参考，未实施项不代表当前已有能力；前端 Vue/Vite、pnpm、TypeBox、数据库及部署平台仍未启用。

## 1. 结论

建议采用 **Vue 3 + Vite + TypeScript 前端，Fastify + TypeScript 后端，pnpm workspace 单仓库**。

采用模块化单体，而不是微服务。目前已按确认范围直接迁入文字、知识库、工具和语音能力；前端工程化与生产部署增强保留为后续选项，不再规划旧服务代理过渡。

这里的“迁入后端”是接管应用逻辑和数据，不等于本机部署模型权重。新后端直接调用模型供应商 API，不再经过旧导览应用服务。

Vite 是开发服务器和构建工具，不是业务后端，也不是生产环境网站服务器。前端框架、后端框架、生产 HTTPS 入口需要分别确定。

## 2. 迁移前基线（历史记录，不是当前结构）

- `package.json` 无 npm 第三方依赖；前端使用原生 ESM，但 Three.js、Live2D 等以本地资源形式存在，不能理解成完全不依赖第三方代码。
- `src/main.js` 595 行，混合 DOM 绑定、界面状态、定位、语音和导览流程；`src/guide/store.js` 为自写订阅式状态容器。
- 本地 `server/` 四个文件共 279 行，使用 Node 原生 HTTP/HTTPS。
- `POST /api/guide` 将上下文及最近至多 10 条对话转发到远端 `/api/chat`，解析 NDJSON 后一次性返回完整答案。
- `POST /api/voice` 将 Base64 PCM 录音转发到远端同名接口，流式透传 NDJSON。当前前端是先录一轮再提交，不是全双工实时语音。
- `GET /api/status` 从远端 `/api/config` 提取状态，不是本地模型或数据库的健康检查。
- 前端 `src/services/native-voice.js` 使用已弃用的 `createScriptProcessor`；有简单音量阈值和停顿检测。MDN 推荐改用 AudioWorklet。
- `src/components/map.js` 使用静态 OSM 底图、已核实坐标和自定义交互；不是已接入商业导航 SDK。
- 已有 `node:test` 测试和部分 Playwright 验证脚本，需保留测试意图，不能用框架迁移作为删除回归覆盖的理由。
- 根目录目前不是 Git 仓库；子目录 `word-windown-virtour/` 的 `.git` 不能证明根目录源码已纳入版本控制。实施前必须确认源码的版本管理与可恢复备份。

调研时尚未核实远端源码。实施时已读取用户指定的 `VirtourV2/server`，确认它使用 Express、Zod、ws 和本地 JSON 关键词知识库；现已迁入并改为 TypeScript。真实模型权限、供应商运行质量仍需账号联调，未发起付费推理验证。

## 3. 明确推荐的技术栈

| 层 | 推荐 | 作用与引入时机 |
| --- | --- | --- |
| 运行时 | Node.js 24 LTS，锁定补丁版本 | 前后端工具和 API 统一运行环境；实施时复核支持状态 |
| 包管理 | pnpm workspace | 单锁文件，组织 web、api、共享协议与领域模块 |
| 前端框架 | Vue 3，Composition API，SFC | 页面与交互组件化，不再手写全局 DOM 拼装 |
| 前端工程 | Vite 8 稳定版本、TypeScript strict、vue-tsc | 热更新、资源构建、独立类型检查 |
| 路由 / 状态 | Vue Router、Pinia | 欢迎 / 模式 / 导览路由；游客界面、导览和语音状态分域 |
| 样式 | 保留 CSS 设计变量，Vue scoped CSS | 保留水彩与奶油色视觉，不在本轮强行换 UI 设计体系 |
| 图形 | 保留 Three.js / Canvas / SVG / Live2D | 先封装已有引擎，重资产模块按需加载；不同时重写角色与地图 |
| API 框架 | Fastify 5、TypeScript | 插件式业务模块、路由、生命周期与流式响应 |
| 协议校验 | TypeBox + AJV + Fastify type provider | 一套运行时 schema 推导 TS 类型，避免手写重复 DTO |
| 接口文档 | @fastify/swagger + OpenAPI | 描述普通请求和响应；另行定义流事件 schema |
| 日志 / 安全 | Pino、@fastify/helmet、@fastify/rate-limit | 请求追踪、脱敏、安全头、调用配额与滥用保护 |
| 数据库 | PostgreSQL 17 + Drizzle ORM + pg 驱动 | 在接管会话或知识库时引入，不作为第一轮 UI 迁移的依赖 |
| 语义检索 | PostgreSQL pgvector | 知识库迁移阶段引入；初期不另建向量数据库 |
| 测试 | Vitest、Vue Test Utils、Playwright、Fastify inject | 领域 / 组件 / 端到端 / API 测试分层 |
| 规范 | ESLint、Prettier、TypeScript strict | 约束依赖方向、类型边界、代码格式 |
| 部署 | Docker Compose + Caddy 2 | HTTPS、静态资源、同域 API 反向代理；不把 Vite dev/preview 用于生产 |

版本策略：以上给出主版本方向，不代表已完成安装兼容性测试。实施时核对插件 peer dependencies 与 Node engines，选稳定版并锁定 lockfile；不直接照抄文档中的 RC / beta 安装命令。特别是 TypeBox 与其 Fastify 适配器需要按兼容矩阵配套。

第一轮不引入 Redis、BullMQ、Kubernetes、独立向量库或复杂 Agent 框架。持久化后台任务出现后，可先用 PostgreSQL 队列（如 pg-boss）；只有明确出现多副本共享限流、缓存或队列需求时再评估 Redis / Valkey。

## 4. 为什么选择这套，而不是其他路线

### 前端

- **Vue 3 + Vite：首选。** 模板接近已有 HTML，适合逐个组件替换；Composition API 可以承接已有音频、定位和渲染控制逻辑。Vue Router、Pinia 有清晰的配套生态。
- **React + Vite：可行但不是本次首选。** 如果团队已有明显 React 技能优势，应优先利用；当前项目没有 React / JSX 或 React Three Fiber 基础，不能把重写成本视为零。并非 Vue 天然比 React 快。
- **Nuxt / Next.js：暂不选。** 当前核心是客户端地图、麦克风和数字人，尚无需要 SSR 的内容站或 SEO 业务；引入全栈渲染并不能解决语音和领域边界问题。
- **仅给原生 JS 加 Vite：适合作为过渡，不作为终点。** 能快速建立构建，但无法单独解决大量手写 DOM 与状态同步问题。

### 后端

- **Fastify：首选。** 与现有 Node 代码连续，提供 schema 校验、插件封装、日志和测试注入机制；HTTP 流转发无需叠加复杂框架。选择理由是适配当前规模与迁移成本，不是宣传吞吐量。
- **NestJS：有效备选。** 模块、依赖注入、守卫等规范更强，适合多人并行且业务域很多的团队，也可使用 Fastify 作为底层 HTTP adapter。当前先不承担其装饰器、容器与平台抽象成本；若团队明确需要强制统一架构，应重新比较，而不是迁移到一半叠上 Nest。
- **Express：可以实现，但需自行补更多工程约定。** 本次目标正是减少自行拼装的基础设施。
- **FastAPI / Python：不作为主 API。** 如果远端审计发现有真正的 Python-only 推理或检索组件，可以通过接口保留为内部 worker；不能为追求“全 TypeScript”盲目重写有效算法。

## 5. 目标架构与代码组织

开发环境：浏览器访问 Vite，`/api` 代理给 Fastify；两者独立进程、统一根命令启动。建议 web 使用 5174，api 使用 3001，正式配置前检查占用并启用端口冲突即失败，避免自动换端口后认错服务。

生产环境：浏览器只访问一个 HTTPS 域名；Caddy 提供构建后的静态资源，转发 `/api/*` 给 Fastify；数据库仅在内部网络暴露。Caddy 的 SPA fallback 只覆盖页面路由，不应将缺失 API 返回为 `index.html`。

推荐目录（目标，不是当前已存在结构）：

```text
apps/
  web/
    src/
      pages/                 # Welcome / Modes / Tour
      features/              # map / companion / conversation / voice
      stores/                # Pinia，可展示的 UI 状态
      engines/               # 现有图形引擎和资源生命周期封装
      services/              # 音频采集、播放、权限、定位
  api/
    src/
      app.ts                 # 创建 app，测试可注入依赖
      server.ts              # 监听端口与优雅退出
      modules/
        guide/               # 导览用例、上下文、会话协调
        chat/                # 文本回答、工具调用协调
        voice/               # 语音轮次、音频协议、取消
        knowledge/           # 资料入库、切分、检索、引用
        catalog/             # 景点与设施权威数据
        sessions/            # 会话归属、历史、过期与删除
      providers/
        models/              # 模型供应商适配
        speech/              # 原生语音或独立 TTS 适配
      infrastructure/        # 数据库、日志、配置、安全
packages/
  contracts/                 # 公开请求、响应、错误、流事件 schema
  tour-domain/               # 纯领域逻辑，不依赖 DOM / Vue / Fastify
  catalog-data/              # 景点、设施、来源及版本化静态快照
infra/                       # Dockerfile / Compose / Caddyfile
docs/                        # 架构、接口协议、运维与评估
```

后端调用方向：route → application service → domain / provider interface → infrastructure。路由只处理协议，不能把检索、提示词、供应商 SDK 和数据库 SQL 全写在同一 handler。

前端本地页面命令保持即时执行，不因后端暂时不可用而丢失地图和设施操作。位置数据默认留在设备端，只有功能明确需要且获得同意时才传输。

## 6. 前端迁移重点

1. 先让 Vite 托管原页面，建立入口与资源构建；再逐步将欢迎、模式、对话、地图控件迁为 Vue 组件。允许短期保留 JS，新增代码使用 TS，不全仓改扩展名冒充完成迁移。
2. 拆出导览、语音轮次、权限、定位、角色控制等 composable / service；Pinia 只保存可展示状态，不保存 AudioContext、麦克风流、WebGL renderer 等底层对象。
3. 原生渲染器先采用 mount / update / dispose 包装；Vue 不同时改写引擎拥有的 Canvas / SVG 子树。Three.js 对象不做深层响应式；卸载时取消 rAF、释放纹理、几何、音频和订阅。
4. 各角色引擎按选择懒加载，照片、全景、图集保留来源署名；避免把整套重资产打进首屏 bundle。
5. 语音采用明确的状态联合：idle / requesting-permission / recording / submitting / playing / cancelled / error，避免几个布尔值产生“暂停又录音”的组合。
6. 将采音迁到 AudioWorklet，采样率转换、PCM 格式、队列上限和播放清空都需要独立测试。iOS Safari、Android Chrome 与授权 / 切后台场景必须实机验收。
7. 原 `file://` 离线预览保留在迁移基线内。Vite 正常产物不等于可直接双击打开；若仍需要单文件离线包，单独维护导出目标，不让生产入口为其承担复杂内嵌逻辑。

## 7. API 与流式协议

第一阶段保持现有 `/api/guide`、`/api/voice`、`/api/status` 请求和响应兼容，加入适配层，不同时要求前后端重写所有协议。

目标普通接口使用 `/api/v1`，公开错误包含 `code`、可展示的 `message`、`requestId`、`retryable`。流已经开始后不能再修改 HTTP 状态，后续错误通过事件传达。

- 文本：目标 `POST /api/v1/chat` 使用 fetch 读取 SSE，支持 POST 请求体和 AbortController；不是直接用只能发 GET 的原生 EventSource。旧接口可临时将流聚合为完整答案。
- 语音：第一轮保留“录完一轮上传 + NDJSON 流式返回”，先解决稳定性和边界，不为了现代化立即换 WebSocket。
- 只有需要持续上传语音、服务端 VAD 或更低延迟双向打断时，再增加 WebSocket 二进制通道；这需要同时验证模型供应商的实时协议，不是只改浏览器传输。
- 音频事件明确 codec、sampleRate、channels、sequence、turnId；不能硬编码“所有模型都返回 24kHz PCM”。
- 内部用 async event stream 解耦供应商与 HTTP：text.delta、text.done、citation、tool.started、tool.finished、transcript、audio.delta、usage、error、done。兼容层翻译成当前事件；不给用户透传模型内部推理内容或原始工具密钥。
- 每轮都有 sessionId / turnId / requestId；重复提交、取消、超时、断线清理、背压和有界缓冲必须设计。取消应向供应商传播，但不能承诺供应商已产生的费用一定可撤回。

## 8. 已采用的直接接管方式与后续增强

### 8.1 迁移前先审计，不根据三个端点猜内部架构

需要取得旧后端源码或明确 API 文档、知识库原始数据与许可证、提示词、工具清单及权限、模型供应商与区域配置、语音事件协议，以及不含隐私的成功 / 失败样例。

尤其要查：是否有实时信息工具、工具结果如何引用、音频模型是否支持工具调用、是否另有 ASR/TTS、缓存和历史在哪里保存。无法取得的功能记为重建项，而不是承诺原样搬迁。

### 8.2 实施采用直接接管，不保留旧代理

按用户确认的范围，旧远端转发、默认主机配置和对应代理实现已删除。Fastify 直接调用迁入的文字、工具、知识库和 Qwen 语音模块；没有创建旧远端适配器。现有 `/api/guide`、`/api/voice` 与 `/api/status` 仅为保持前端协议，不是旧应用转发。

`TextModelProvider`、`NativeVoiceProvider`、`SpeechSynthesisProvider`、`EmbeddingProvider`、`KnowledgeRetriever` 分开定义能力。文本模型、音频理解、语音生成不是自动等价的能力，不能用一个 `chat()` 函数假装覆盖所有模型。

模型调用优先使用供应商官方 Node SDK；对已确认支持的 OpenAI-compatible 端点可用 OpenAI Node SDK。Qwen 文档确有 Node 调用示例，但各具体模型的音频输出、工具调用、区域和音色必须逐项确认。不能假设任意“兼容接口”都兼容所有音频参数。

不要第一步引入 LangChain / LangGraph 或其他 Agent 框架；先实现可测的受限工具循环，限定最大轮次、时长和预算。只有确有复杂恢复、多节点工作流需求时才评估编排框架。

### 8.3 先迁文字与检索，再迁语音

文字链路：有效会话 → 问题归一化 → 结构化景点 / 设施查询或资料检索 → 构造来源上下文 → 模型回答 → 引用验证 → 流式返回。

知识库优先复用已核实景点、设施、作者与许可，保存 source URL、采集时间、适用时间、校验哈希、知识库版本。事实查找不应一律向量化；名字 / 别名精确检索与结构化记录优先。

长文档入库采用清洗 → 切分 → embedding → pgvector 检索 → 可选重排。初期小规模用精确向量检索建立召回基线，有压测证据再引入 HNSW。中文关键词检索要单独验证分词和召回，不能照抄 PostgreSQL 英文全文检索配置后声称支持中文混合检索。

更换 embedding 模型需要版本化、重建相应向量并通过检索评测；旧向量维度和新模型不能混用。检索为空、资料过期或互相冲突时明确说明，不编造实时票价、人流或路径。

语音接管必须保持两条职责：

- 原生音频理解与回答：在能力验证后接入当前供应商，保持字幕、音频、引用和取消的轮次一致性。若模型不支持所需工具，不可假定它能直接调用知识库；应明确选择支持工具的模型或可验证的语音理解 / 检索编排方案。
- 固定文本讲解的独立 TTS：提供可选 `/api/v1/tts`，与“音频提问后生成回答”分开；按文本、音色、语言、模型与版本缓存。第一轮仍保留浏览器合成，不把它当成后端迁移的既有能力。

### 8.4 渐进切换与退出条件

当前文本和语音分别通过服务端环境变量配置供应商，应用编排均已在本项目内运行，不提供旧远端回退开关。模型切换仍应先跑评测集，再按人工指定会话小范围试用。

不要默认将真实游客录音或私人对话同时影子发送给两个后端；双发需要隐私同意与预算控制。答案已输出或音频已播放后，不自动重放到另一供应商，避免重复回答、工具副作用和双倍计费。

验收时确认代码没有旧服务调用路径，新后端能够独立完成约定的文字 / 知识库 / 语音场景。停止来源项目的部署是单独的运维操作，不能因为代码迁移就擅自删除或关停其他项目。

## 9. 数据、安全与可运维性

- 持久化阶段建立 sessions、messages、turns、knowledge_sources、knowledge_chunks、retrieval_runs、model_calls 等逻辑实体。会话必须验证归属，不能靠前端自报 sessionId 读取历史。
- 默认不持久化原始录音和精确位置；文字历史是否保存、多久删除、如何导出和删除需明确产品策略。日志默认不记录完整对话、录音、定位或模型密钥。
- 模型供应商密钥仅在 API 服务端注入；`VITE_*` 变量会进入前端产物，严禁放密钥。现有模型密钥不是游客访问 API 的鉴权机制，公网部署仍需单独配置入口保护。
- 公开演示初期可使用同源 HttpOnly/Secure/SameSite 会话、IP + 会话限流和每日调用预算；这不等于身份认证或足够的防刷保障。受限演示应加入口鉴权；管理和资料导入接口不得匿名开放。多副本时必须共享限流和会话状态。
- 校验 Origin / CSRF 风险，按已知 Caddy 地址配置 trusted proxy；CORS 不能代替鉴权。工具采用允许列表、参数校验、超时和权限边界，绝不允许模型直接执行任意 SQL / shell / URL 请求。
- 知识库导入防 SSRF、限制文件大小和类型，将资料视为不可信输入；来源文字不能覆盖系统规则。
- 公共 `/health/live` 检查进程，`/health/ready` 检查必要依赖；模型供应商是否可用作为独立能力状态，避免仅因外部 AI 故障就把可浏览地图的站点不断重启。
- Pino 输出 requestId / turnId、耗时、供应商、模型和用量；分别统计首字时间、首音频时间、取消成功率与错误率。目标值需基于设备、网络和真实模型压测，不在调研阶段虚报性能。
- PostgreSQL 定时备份并演练恢复；数据库迁移使用向后兼容的扩展 / 收缩策略。应用镜像回滚不能替代数据库回滚方案。
- 生产 Caddy、CDN 和压缩插件必须验证不会缓冲语音 / SSE；同时验证断开连接向上游传播。不要盲目复制会改变取消行为的代理参数。

## 10. 实施阶段与验收

| 阶段 | 范围 | 完成条件 |
| --- | --- | --- |
| P0 基线 | 确认版本管理、资源清单、当前接口和浏览器行为 | 可恢复快照；记录现有测试结果与已知失败；保存关键截图和协议样例 |
| P1 工程底座 | TS、Fastify、共享协议；前端工程化另行决定 | 前端兼容；端口清晰；检查 / 构建 / 测试通过 |
| P2 前端组件化 | Vue 页面、Pinia、渲染器包装、AudioWorklet | 核心流程与视觉回归通过；资源正确释放；授权 / 打断 / 切后台通过实机验证 |
| P3 新后端完善 | 模块边界、日志、校验、限流、OpenAPI、Compose/Caddy | HTTPS 同域工作；流式不被缓冲；断线取消、输入限制与错误响应有测试 |
| P4 文字 AI 接管 | 源码审计、模型调用与知识库；持久化另行决定 | 新后端独立调用供应商；回答有来源；错误边界有测试 |
| P5 语音接管 | 音频供应商 adapter、语音 / 字幕 / 工具一致性、可选 TTS | 不再依赖旧语音接口；延迟与费用已测量；打断与故障恢复通过 |
| P6 退出旧服务依赖 | 删除转发实现和旧配置，检查网络依赖、更新文档 | 不再存在旧主机调用路径；来源项目不被擅自改动 |

上表为阶段参考，已移除过时的代理过渡方案。当前完成边界以 BACKEND_MIGRATION.md 为准；数据库、Vue 前端与生产部署平台不在此次实施范围。

自动化最低要求：既有 Node 测试继续可运行；新增 Vitest 单元和组件测试；Fastify inject 测试 schema / 错误 / 安全；真实 HTTP 测试流、取消和代理；Playwright 覆盖桌面与移动尺寸、文本、地图、角色、语音 mock 及 API 异常。Mock 测试不能代替 Safari / Android 真实麦克风验证。

## 11. 尚需确认的实施输入

1. 团队是否有强烈 Vue / React / NestJS 既有能力约束。没有则按上述默认路线推进。
2. 旧 chat 服务源码及知识库的实际位置、访问权和迁移许可；目前不假设它就是旁边任何一个项目。
3. 是否必须继续提供双击打开的单文件离线预览。
4. 目标部署机器、域名、模型供应商、数据地域与保存策略；这些决定实际预算与公网安全配置。

以上不阻碍先做 P0 / P1 的详细任务拆解，但会影响后续数据和 AI 能力迁移；本次调研未执行这些阶段。

## 12. 官方参考资料

以下为本次直接读取的官方文档；搜索服务不可用，因此没有采用搜索摘要。文档是功能依据，不是本项目的兼容性或性能实测。

- Vite：<https://vite.dev/guide/>。调研时页面显示 8.3.7，要求 Node 20.19+ / 22.12+，支持 Vue / TS 和多页入口。
- Vue：<https://vuejs.org/guide/introduction.html>。渐进接入、SFC、Composition API 及官方生态。
- Fastify：<https://fastify.dev/docs/latest/Reference/Type-Providers/>、<https://fastify.dev/docs/latest/Reference/LTS/>。schema 类型推导、TypeBox 适配与版本支持政策；实施前复核更新。
- NestJS：<https://docs.nestjs.com/>。模块化架构、依赖注入与可选 Fastify adapter。
- MDN：<https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode>。明确弃用，并指向 AudioWorklet 替代。
- Drizzle：<https://orm.drizzle.team/docs/get-started-postgresql>。PostgreSQL 驱动集成；当前文档含预发布安装示例，落地选型不能不加甄别照抄。
- pgvector：<https://github.com/pgvector/pgvector>。精确 / 近似向量检索、索引与混合检索说明。
- Qwen-Omni：<https://www.alibabacloud.com/help/en/model-studio/qwen-omni>。Node SDK 调用、音频输入 / 输出与不同模型能力差异；不能据此推断旧后端正在使用哪个具体模型。
- Vitest：<https://vitest.dev/guide/>。Vite 集成、TS 测试及版本要求。
- Caddy：<https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>。反向代理、流式响应、WebSocket 与缓冲 / 取消行为。

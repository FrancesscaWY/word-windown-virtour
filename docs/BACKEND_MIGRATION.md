# Fastify + TypeScript 后端迁移

日期：2026-11-13。

## 范围与结果

- 后端所有实现代码使用 `.ts`，Fastify 5 提供统一 HTTP/HTTPS proxy 入口，内部 API 仅监听本机回环地址。
- 从用户指定的 `/home/apricityx/workspaces/VirtourV2/server` 迁入文字模型工具调用、原生 Qwen WebSocket 语音、工具协议和世界之窗 JSON 知识快照。后续按用户要求移除了规则演示、模拟天气与城市测试数据，只保留真实模型和有来源的园区资料。
- 不修改来源项目，不依赖其 node_modules、运行进程或绝对文件路径；不复制其前端、Express 应用、`.env` 或模型密钥。
- 删除当前项目旧远端转发实现及默认地址，不保留旧远端代理，也不提供旧服务回退开关。
- 当前 `src/`、`public/` 不改，继续使用原生前端；未引入 Vue、Vite、pnpm、数据库或容器平台。

## 目录

```text
server/
  index.ts               # proxy 入口、证书、监听与统一关停
  proxy.ts               # 静态页面与 /api 路由到内部 API
  proxy-transport.ts     # 保留 Host 的有界流式传输与断开取消
  app.ts                 # Fastify API、schema、安全边界与并发控制
  network.ts             # 主机、端口和局域网地址
  handler.ts             # 受限静态目录与路径校验，不处理模型 API
  guide.ts               # 有来源的页面上下文、历史清洗与 PCM 校验
  lifecycle.ts           # 单轮超时、取消及资源清理
  ai/
    types.ts             # 请求上下文、模型、工具记录与流事件类型
    config.ts            # 服务端模型配置及模型端点校验
    llm.ts               # 直接请求模型供应商与受限工具循环
    voice.ts             # Qwen 原生音频 WebSocket 协议
    tools.ts             # 文字与语音共用的七个允许工具，Zod 参数校验
    knowledge.ts         # 实体／主题关键词检索与来源引用
    knowledge-schema.ts  # 导入与启动时共用的数据校验
    knowledge-import.ts  # 文档离线解析与确定性条目生成
    knowledge/window-of-world.json
    knowledge/window-of-world.source.json
  tsconfig.json          # strict + noEmit + erasableSyntaxOnly
```

保留迁入项目的 Zod 工具 schema 和生成 JSON Schema 的逻辑，不在这轮再重写为 TypeBox。Fastify 入口使用 JSON Schema / AJV 做请求校验。后端借用现有前端景点数据构造可信页面上下文；这不表示已把整个前端迁成 TypeScript。

## 启动

使用 Node.js 24+。Node 原生擦除可擦除的 TypeScript 语法并执行 `.ts`，不需要运行时打包器；这不能替代类型检查。

```bash
npm ci
npm run typecheck
npm run dev:lan
```

默认 `http://localhost:5174`。`npm run dev` 只监听本机；`dev:lan` 显式监听所有 IPv4 网卡。手机麦克风仍需受信任 HTTPS。

### proxy 单端口入口

`npm run dev` 与 `npm run start` 都通过 `server/index.ts` 创建同一个 proxy；无需额外运行后端命令，前端代码无需配置 API 域名或第二个端口。`npm run preview` 也使用这一入口，附带 `--dist` 选择构建后的页面；dev/start 默认保留读取源码页面的行为。

浏览器 → 对外 proxy（默认 5174）→ 页面直接返回；`/api/*` → 内部 Fastify API（127.0.0.1 随机端口）。内部 API 不提供页面，不绑定局域网地址，端口由系统分配，也不对浏览器公开。这里“单端口”指一个用户访问／防火墙开放端口，内部回环仍有一个 HTTP 监听端口。

proxy 采用 `@fastify/http-proxy` 的前缀路由、路径校验和请求流解析；传输层显式处理客户端中断，包括文字模型尚未返回响应头时的取消，避免继续消耗模型调用。请求和响应逐流转发、剔除逐跳头、保留浏览器 Host 与来源检查，不跟随重定向、不自动重试。代理超时为 130 秒，长于 API 自身 60/120 秒时限。

`HOST`、`PORT`、HTTPS 证书仅控制 proxy；内部 API 固定使用本机回环 HTTP。Ctrl+C 会关闭两层并取消进行中的模型任务；对外端口占用导致启动失败时，也会清理已启动的内部 API。原远端应用转发没有恢复。

外层代理可能保留域名但去掉非标准端口，导致浏览器 Origin 与收到的 Host 不一致。此时使用 `PUBLIC_ORIGINS` 明确列出浏览器完整公开 Origin（协议、域名、端口），例如 `https://tour.example.com:55555`；多个以逗号分隔。允许列表只从服务端配置读取，拒绝通配符、凭据和路径，不信任 `X-Forwarded-Host`，仍拒绝 `Sec-Fetch-Site: cross-site`。不要通过忽略全部端口或关闭同源校验修复此类 403。

可选复制根目录 `.env.example` 到 `.env`，自行填写模型配置。模型地址必须使用公网 HTTPS / WSS，无 URL 内凭据、查询参数和重定向。不是把自建旧 chat 应用的地址填成模型地址：文字端点必须实际提供 Chat Completions，语音端点必须提供对应 Qwen realtime 协议。

- 文字：`CHAT_BASE_URL`、`CHAT_MODEL`、`CHAT_API_KEY`；兼容原 `DEEPSEEK_*` 变量。
- 语音：`DASHSCOPE_API_KEY`、`QWEN_REALTIME_URL`、`QWEN_AUDIO_MODEL`、`QWEN_VOICE`。
- HTTPS：`TLS_CERT_PATH`、`TLS_KEY_PATH`，必须成对设置。

密钥推荐保存到仓库外、属于当前用户且权限为 0600 的私有 `.env`，由项目 `.env` 中的 `AI_CREDENTIALS_FILE` 指向它。凭据文件只提供 Chat / 语音密钥，不覆盖端口或模型地址等设置；拒绝相对路径、符号链接、不安全权限及超过 16KiB 的文件。不向前端或日志展示密钥。

缺文字密钥时文字 API 返回 503；缺语音密钥时语音 API 返回 503；供应商错误时明确失败，不回退演示。修改配置后重启，没有匿名修改密钥的 API。

## 与当前前端兼容的 API

| 接口 | 行为 |
| --- | --- |
| `POST /api/guide` | `{text, context}`；返回 `{status, text, model, traces, usage, mode}`；整轮 60 秒 |
| `POST /api/voice` | `{audio, context}`；保持原 NDJSON 事件；整轮 120 秒 |
| `GET /api/status` | 本服务的 live／unconfigured 状态；不泄漏密钥或模型地址 |
| `GET /api/health` | 进程健康，不执行外部模型调用 |
| `GET /api/tools` | 七项工具的名称和说明 |

未复制来源应用的独立 `/api/chat` 和可写 `/api/config` 路由，因为当前前端无需这些接口，也不应匿名允许更改密钥。它们的业务能力已接入当前导览端点，不是保留两套 HTTP API。

文本上下文保留最近至多 10 条合法 user/assistant 消息，每条至多 2000 字，城市默认深圳。页面上下文单独注入模型指令，不混入规则检索问题；不转发前端自报 system 消息、任意来源信息或游客 GPS。

所有工具仍在后端执行。`get_weather` 已移除，新增 `plan_route`，总数仍为七项。模型查询资料后，用工具参数提交自己规划的景点顺序；后端校验并补充目录坐标。文字通过最终 `traces` 返回路线，语音通过 `tool_end` 提前返回并在最终回答附带同一记录。前端只展示成功的白名单工具结果，不执行模型代码；直接在地图上绘制顺序虚线与编号，不显示路线弹窗，路线说明在对话中呈现。地图连线不是道路导航。已展示的路线在页面内存中保留至清除或被新路线替换，并将最多 12 个合法景点 ID 对应的目录信息作为下一轮上下文，支持后续调整。

语音保持浏览器 16kHz、16bit、单声道 PCM 输入和 24kHz PCM 输出。本服务直接建立带供应商密钥的 WebSocket 并写回工具结果，浏览器不接触密钥。后续固定文本讲解已接入 `/api/tts` 阿里云百炼 Qwen TTS，复用服务端语音密钥，不再使用浏览器语音合成；详见 README 的语音配置。

## 保留的限制

- 知识库已由八个迁入主题扩充为用户文档的 110 个条目，支持景点实体、别名和主题关键词检索，不是向量检索。资料截至 2026-11-12，保留来源未独立核验、非实时及编辑建议标记；重建和边界见 [KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md)。
- 天气工具已移除，实时天气、票价与道路导航服务尚未接入，不生成模拟数值、示例门票合计或已核实可通行的承诺。`plan_route` 只提供 LLM 游览顺序建议，不计算道路、距离或精确时长。景点检索使用当前园区目录，不使用其他城市的测试数据。
- `/api/status` 的语音 ready 只代表配置了密钥；`providerStatus` 为 `configuration-only`，没有验证网络、余额、模型权限或音色兼容性。
- 文字／语音共享三个并发名额，文本请求体 64KiB、音频 JSON 请求体 3MiB；有跨站拒绝、时限、取消和语音缓冲上限，但不是完整的身份认证或公网防刷系统。
- 没有用户隔离、数据库或持久化会话；不默认保存原始录音。公开部署前需补入口鉴权、配额、代理信任与网络隔离。
- 模型端点的 DNS 检查沿用来源项目，不能作为完善的防 DNS 重绑定或网络隔离方案；部署时需信任配置人员与供应商，并限制出站网络。

## 验证

```bash
npm run check
npm test
npm run build
```

测试包括原前端行为回归、新 Fastify API 校验与错误、七项工具和知识库、模型工具调用上限、Qwen 协议，以及本地真实 HTTP + WebSocket 的流式返回、断开取消和共享并发控制。所有模型测试均使用替身或回环测试服务，不产生付费模型请求。

本次验证结果：263 项测试通过，严格类型检查与构建通过；已启动源码入口和构建预览，在 5174 验证页面、脚本、本地知识问答及私有路径隔离，验证进程已停止。迁移前后哈希对比的 158 个前端／素材及来源后端文件均未改变。

新增 proxy 专项测试覆盖同一端口的页面/API、内部回环隔离、同源校验与错误码、大录音上传、逐块语音输出、响应头前的文字取消、语音取消、统一关停与端口释放，以及构建目录模式。

proxy 接入后全量 270 项测试与严格类型检查通过；已分别实际运行 `npm run dev`、`npm run start`，确认页面、知识问答和同源请求均可通过一个访问端口完成，监听检查为一个对外 proxy 加一个回环内部 API。验证进程已关闭，前端文件未修改。

真实 AI 启用更新：已使用用户通过私密卡片提供的凭据完成 Chat 工具调用与知识回答；Qwen 原生语音返回音频分块和字幕；经运行中的 proxy 验证真实模型在天气未接入时明确拒绝模拟数值。语音验证使用合成静音片段，不代表实机采音质量已验收。自动化回归目前为 273 项，使用替身或回环服务，不发起付费调用。

前端采音改为 AudioWorklet、全双工语音和独立 TTS 不在本轮改造范围。应用密钥配置不等于游客访问鉴权；公开暴露实际付费模型前仍需配置入口保护与配额。

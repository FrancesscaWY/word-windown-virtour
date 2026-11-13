# Fastify + TypeScript 后端迁移

日期：2026-11-13。

## 范围与结果

- 后端所有实现代码使用 `.ts`，Fastify 5 提供 HTTP/HTTPS、API 与静态资源入口。
- 从用户指定的 `/home/apricityx/workspaces/VirtourV2/server` 迁入文字模型工具调用、原生 Qwen WebSocket 语音、七项工具、城市示例数据和世界之窗 JSON 知识快照。
- 不修改来源项目，不依赖其 node_modules、运行进程或绝对文件路径；不复制其前端、Express 应用、`.env` 或模型密钥。
- 删除当前项目旧远端转发实现及默认地址，不保留旧远端代理，也不提供旧服务回退开关。
- 当前 `src/`、`public/` 不改，继续使用原生前端；未引入 Vue、Vite、pnpm、数据库或容器平台。

## 目录

```text
server/
  index.ts               # 入口、证书、监听与关停
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
    demo.ts              # 明确标注的本地规则演示
    data.ts              # 保留模拟标记的城市示例数据
    knowledge.ts         # 关键词检索与来源引用
    knowledge/window-of-world.json
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

可选复制根目录 `.env.example` 到 `.env`，自行填写模型配置。模型地址必须使用公网 HTTPS / WSS，无 URL 内凭据、查询参数和重定向。不是把自建旧 chat 应用的地址填成模型地址：文字端点必须实际提供 Chat Completions，语音端点必须提供对应 Qwen realtime 协议。

- 文字：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。
- 语音：`DASHSCOPE_API_KEY`、`QWEN_REALTIME_URL`、`QWEN_AUDIO_MODEL`、`QWEN_VOICE`。
- HTTPS：`TLS_CERT_PATH`、`TLS_KEY_PATH`，必须成对设置。

无文字密钥时为本地规则演示；无语音密钥时原生语音接口返回 503。修改配置后重启。没有匿名修改密钥的 API。

## 与当前前端兼容的 API

| 接口 | 行为 |
| --- | --- |
| `POST /api/guide` | `{text, context}`；返回 `{status, text, model, traces, usage, mode}`；整轮 60 秒 |
| `POST /api/voice` | `{audio, context}`；保持原 NDJSON 事件；整轮 120 秒 |
| `GET /api/status` | 本服务的演示／真实模型配置；不泄漏密钥或模型地址 |
| `GET /api/health` | 进程健康，不执行外部模型调用 |
| `GET /api/tools` | 七项工具的名称和说明 |

未复制来源应用的独立 `/api/chat` 和可写 `/api/config` 路由，因为当前前端无需这些接口，也不应匿名允许更改密钥。它们的业务能力已接入当前导览端点，不是保留两套 HTTP API。

文本上下文保留最近至多 10 条合法 user/assistant 消息，每条至多 2000 字，城市默认深圳。页面上下文单独注入模型指令，不混入规则检索问题；不转发前端自报 system 消息、任意来源信息或游客 GPS。

语音保持浏览器 16kHz、16bit、单声道 PCM 输入和 24kHz PCM 输出。本服务直接建立带供应商密钥的 WebSocket 并写回工具结果，浏览器不接触密钥。固定文本讲解仍使用浏览器语音合成；没有独立 TTS API。

## 保留的限制

- 知识库是八个主题片段的本地关键词检索，不是向量检索；保留来源身份待复核、非实时及编辑建议标记。
- 天气工具是模拟，其他城市数据和门票预算是示例，不能当作实际运营信息。
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

真实供应商权限、音色和音频质量没有使用账号联调；前端采音改为 AudioWorklet、全双工语音和独立 TTS 都不在本轮改造范围。

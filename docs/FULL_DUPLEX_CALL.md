# 全双工通话

## 实现依据

- [阿里云 Qwen Audio Realtime 官方示例（MIT）](https://github.com/aliyun/alibabacloud-bailian-speech-demo/tree/master/samples/conversation/fun-audiochat-realtime)：常驻 WebSocket、`smart_turn_v2`、函数调用与流式播放。沿用现有服务端模型/音色配置。
- [LiveKit 话轮与打断](https://docs.livekit.io/agents/logic/turns/)：实时模型决定话轮，播放时持续上传麦克风，检测到用户发声立即停播，取消旧响应并修正会话历史。
- [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)：WebSocket 应用自行管理播放队列与实际播放位置；生成完成不等于播放完成。
- [Silero VAD](https://github.com/snakers4/silero-vad) 与 [vad-web](https://docs.vad.ricky0123.com/user-guide/api/)：本地神经网络语音检测、概率迟滞；使用 v5 的 512 样本帧、64 样本上下文与循环状态，针对通话使用较短确认时间。

本项目使用已配置的 Qwen Audio WebSocket 接口。没有引入需要额外部署的 LiveKit 服务，也没有把其他供应商的专有接口直接套到 Qwen 上。

## 链路与状态

浏览器 AudioWorklet 持续采集，按 20 ms 分包、有状态重采样为 16 kHz / 16-bit LE / mono PCM，经同源 `/api/voice/realtime` WebSocket、现有单端口 proxy 到 Fastify，再连接 Qwen。开启浏览器回声消除、降噪、自动增益。回答为 24 kHz PCM，按音频时钟无缝排队播放。工具、密钥与模型配置只在服务端。

电话独立于原来单句语音的录完再答模式。拨号只申请一次麦克风；接通后持续监听，包括模型思考、工具调用和播放期间。Qwen 使用 `server_vad`（阈值 0.5、300 ms 前置保留、450 ms 静音），替换原先的 `smart_turn_v2` / 800 ms。已对真实 `qwen-audio-3.1-realtime-flash` 发出配置请求，`session.updated` 回显支持这些参数；云端决定话轮和回答内容，本地负责及时停播。

同一份 16 kHz PCM 同时送到本地 Worker，使用 Silero v5 / ONNX Runtime Web WASM 单线程推理，不要求跨源隔离。连续 3 帧概率 ≥ 0.65（96 ms 的确认窗口）触发开口；连续 8 帧 < 0.35（256 ms）结束本地语音状态。复用现有麦克风，模型就绪并预热后才接通，推理不阻塞主线程。静音切换时重置推理状态，以 epoch 丢弃迟到的检测结果；挂断终止 Worker。队列超过 16 个 20 ms 输入包或检测失败会明确报错，避免静默退回高延迟体验。

打断时：
1. 本地确认开口，在同一回调立即停止正在播放和已排队的音源，无需等待云端事件或网络往返。云端先检测到时也能直接停播。
2. 浏览器发送按旧 `turn` 定向的 `barge_in`，服务端取消当前生成，同时阻止尚未拿到 response ID 的旧生成与工具续答。云端 `speech_started` 才推进话轮；已收到云端开口的同一次本地确认不会误取消该问题的答案。旧响应的后续音频、字幕和工具事件作废。
3. 浏览器按音频时钟减去设备输出延迟，回传各 item 实际听到的毫秒数。服务端发送 `conversation.item.truncate`，避免模型假定用户听完了后半句。
4. 播放回执和取消通知使用 response ID 定向，`barge_in` 使用话轮编号，迟到的旧消息不会取消下一条回答。页面历史中被打断的回答标明打断，不把提前生成的全文带入下次通话。

麦克风静音时禁用 track，并持续发送静音帧以结束半句话；恢复不重新授权。电话不因短暂切换标签就挂断；若浏览器实际暂停音频、设备掉线或输入超过 5 秒不再产帧，会明确显示断开。离开页面释放麦克风、音频上下文和两个 WebSocket。

连接/授权超时 30 秒，服务端初始化 25 秒；单轮回复上限 90 秒；单次通话上限 30 分钟。应用层心跳穿透 proxy，避免代理自动 pong 掩盖浏览器断线。慢连接有上行、下行和播放积压上限。错误需主动重拨，不偷偷重连或回退演示回答。

## 工具调用与语音边界

工具参数事件和 `tool_end` 只用于后端执行与前端地图更新，不经过浏览器 TTS。原先模型生成的 `response.audio.delta` 全部直接透传，而提示词强调必须调用工具，却没有明确要求调用期间静默；模型若把调用计划写入普通语音，就会被照常播放。另有“未得到结果只能说明尚未查询”的措辞，会鼓励模型先播报查询状态，现已移除这条歧义。

当前共享角色和原生语音提示均明确：工具只通过函数通道调用，调用前及执行期间保持安静，拿到结果后直接说游客关心的结论和必要限制，不念函数名、参数、JSON、内部推理或执行状态。该约束在通话页面上下文更新后也保留。后端在 `response.output_item.added` 的 `function_call` 或参数开始事件就标记内部响应，阻止它后续附带的字幕与音频下发，仍正常执行工具和地图事件；下一条正常回答继续即时流式播放，不等待整句生成。模型若在普通回答通道里先说调用说明、随后才发出工具事件，这层协议标记无法追溯撤回已播放的音频，须依靠输出指令约束；本次未在真实请求中复现用户听到的原句，不能把这类生成行为描述为绝对杜绝。

回归覆盖函数 item 先到、参数先到两种顺序；注入工具说明音频与字幕后，确认游客流中没有这些片段、工具仍执行、下一条回答在 `response.done` 前即可播放。真实 Qwen 的景点讲解、知识检索→路线规划、票价限制三类请求中，工具轮没有音频，最终语音均没有念调用过程。此次全量 352 项自动测试、check、build 通过。

## 采样音效与许可

本地 VAD 资源位于 `public/assets/call-vad/`：`silero_vad_v5.onnx`（约 2.3 MB）、ONNX Runtime 1.22.0 的 ESM 与 WASM（约 11.3 MB）。固定 npm 包版本并保留包锁、来源、逐文件 SHA-256 清单和许可；`npm run assets:call-vad` 可从已安装的精确版本重建。资源随正常 build 发布，无运行时外部 CDN。

点击通话按钮的拨号音、接通音、挂断音均采用 **Alexander Holm — Salamander Grand Piano v3** 的真实钢琴轻奏录音，许可为 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)（允许商用、修改和分发，须保留署名、许可及修改说明）。[原项目](https://archive.org/details/SalamanderGrandPianoV3)使用两支 AKG C414 录音，源采样为原生 **48 kHz / 24-bit 双声道无损 FLAC**；保留此分辨率及真实声道，不由 Ogg/MP3 升采样冒充高音质。

本项目使用 [sfzinstruments 无损镜像](https://github.com/sfzinstruments/SalamanderGrandPiano/tree/3382bf9496bba2486f5ab0de55a264d1dfc38404)的 `Samples/C4v3.flac`、`Samples/A4v3.flac`，裁剪并编排上行／下行双音；增加 18 ms 起音淡入、420 ms 尾音淡出、70 Hz 高通及 2.4 kHz 低通，削弱敲击高频，限制峰值，保存为 48 kHz / 24-bit 双声道 PCM WAV。署名、许可及修改说明同时写入 WAV 元数据与 `public/assets/audio/LICENSE.txt`。

点击按钮时播放的拨号音也已替换，不再使用旧的 Kenney 电子提示音。新拨号音为 C4 单音，35 ms 淡入、420 ms 淡出及 1.8 kHz 低通；相比接通双音，起音更缓、音量更轻。

| 文件 | 原始素材 | 用途 |
| --- | --- | --- |
| `public/assets/audio/call-dial.wav` | Salamander `C4v3.flac` | 用户点击开启，轻柔单音，0.72 秒 |
| `public/assets/audio/call-connected.wav` | Salamander `C4v3.flac` → `A4v3.flac` | 麦克风和模型配置都就绪，上行双音，1.05 秒 |
| `public/assets/audio/call-ended.wav` | Salamander `A4v3.flac` → `C4v3.flac` | 挂断或连接失败，下行双音，0.90 秒 |

使用 AudioBuffer 播放真实资源文件，不运行时合成提示音、不远程热链。拨号／接通／挂断音量分别为素材的 22%／32%／28%；新的状态音会停掉旧音，挂断后异步加载完成的接通音不会迟到播放。解锁发生在点击手势内。

重制命令：`node scripts/prepare-call-sounds.mjs`（需要 ffmpeg）。脚本锁定源版本并校验 SHA-256，源文件缓存在 `agent-tmp/call-sounds/`，更新拨号、接通、挂断三个文件。

## 验证

自动测试覆盖持续双向传输、打断丢弃迟到事件、按实际听到的音频截断、下一轮隔离、工具调用、多次拨挂、静音、权限迟到返回、故障与单端口 WebSocket 转发。浏览器验证使用隔离的本地协议夹具，验证真实 AudioWorklet / PCM 播放 / 素材解码 / 手机与桌面布局。夹具不进入生产路径。

2026-11-13：现有 `qwen-audio-3.1-realtime-flash` / `longanqian_v3.1` 配置已完成真实供应商双轮录音流验证：持续上传时收到音频，播放期注入第二条录音触发打断，发送实际播放位置截断后完成下一条语音回答；未收到错误或旧轮次音频。手机/桌面 Chromium 浏览器夹具通过，且未使用自动播放绕过参数。

同日针对用户实测的打断延迟重新验收，增加 `scripts/verify-call-latency.mjs`：将中文问题录音经真实 Web Audio MediaStream → AudioWorklet → Silero Worker 注入，分别记录开口到 `AudioBufferSource.stop()` 与说完到新音频排定播放时间：

- 延迟云端夹具：故意让云端开口事件晚到 1204 ms，本地 **120 ms** 停播，话尾到新播放 **504 ms**（夹具的 450 ms endpointing + 播放缓冲）。
- 真实 Qwen 两次运行：本地 **121 / 132 ms** 停播，云端开口事件 **198 / 213 ms**，话尾到新播放 **973 / 987 ms**。第二次等待新答案完整生成后才结束，转写切换到上海问题，真实回答说明未接入实时天气服务；未报告错误。
- 三种钢琴采样以原始音量注入麦克风均未误触发；静音时注入整段人声没有触发；恢复后可正常打断，迟到旧音频不恢复播放。

这是少量录音注入测量，不是设备声学延迟或网络 SLA。录音首尾按 10 ms 帧 RMS ≥ 0.01 定位，停止记录为浏览器停播调用时间，新播放记录为 AudioContext 排定时间；真实扬声器／蓝牙输出延迟另计。全量 350 项自动测试、check、build，以及手机／桌面通话浏览器回归均通过。

延迟验证需要 16 kHz / 单声道 / 16-bit LE PCM 的两条语音录音。默认读取 `agent-tmp/calls/question.pcm` 与 `followup.pcm`，或用 `CALL_QUESTION_PCM` / `CALL_FOLLOWUP_PCM` 指定。执行 `node scripts/verify-call-latency.mjs` 验证延迟云端夹具；执行 `node --env-file-if-exists=.env scripts/verify-call-latency.mjs --live` 连接真实配置，使用现有服务端私有凭据。Playwright / Chromium 路径变量同下。结果与截图写入 `agent-tmp/calls/latency-{fixture,live}.*`。

验证命令：`npm test`、`npm run check`、`npm run build`；`scripts/verify-calls.mjs` 可通过 `VIRTOUR_PLAYWRIGHT_PATH` 和 `CHROME_PATH` 指定本机 Playwright/Chromium 安装路径。

上线需让反向代理允许 `/api/voice/realtime` 的 WebSocket Upgrade，并使用 HTTPS。真实外放回声、耳机、弱网、手机后台限制需要设备实测；自动夹具不能代替这些声学验收。

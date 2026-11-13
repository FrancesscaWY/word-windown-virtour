# VirTour 项目指引

此项目为一个虚拟文旅系统，旨在帮助游客更好地进行游览，提供景区地图、景点资料、数字人伴游和文字／语音问答。

## 架构

当前项目结构如下：

```text
src/                         # 前端代码
  arrival/                   # 欢迎页、模式选择的导航与展示逻辑
  components/                # 地图、景点、数字角色、字幕等界面与交互
  guide/                     # 导游流程、意图识别、对话状态与语音轮次
  services/                  # 后端请求、音频采集播放与浏览器能力检测
  data/                      # 景点、设施、照片及角色配置数据
  vendor/                    # Three.js、Live2D 等第三方库
  main.js                    # 主应用入口
  welcome-page.js            # 欢迎页入口
  modes-page.js              # 模式选择页入口
  tour-entry.js              # 导览页入口
public/                      # HTML 页面、样式和静态资源
  design/                    # 原始设计图与参考素材
  assets/                    # 地图、数据清单及其他页面资源
    arrival/                 # 欢迎页与模式选择页素材
    photos/                  # 景点实拍照片
    reference-avatars/       # 原画角色分层图与动画图集
    avatars/                 # 3D、Live2D 角色模型与动作
server/                      # Fastify + TypeScript proxy 单端口入口与内部导览 API
  index.ts                   # dev/start 共用入口，统一启动和关闭 proxy 与 API
  proxy.ts                   # 页面资源入口及 /api 到本机回环后端的路由
  proxy-transport.ts         # 流式代理、Host 保留与断开取消
  ai/                        # 模型调用、Qwen 原生语音、工具与本地知识库
scripts/                     # 素材处理、地图生成、构建打包与浏览器验证脚本
tests/                       # 自动化测试
docs/                        # 设计、技术方案、素材来源、部署与验收文档
artifacts/                   # 验证截图、检查报告及测试音频
downloads/                   # 素材抓取结果与报告
package.json                 # 项目配置与开发、测试、构建命令
```

## 开发规则

1. 所有新增项目文档应写在 `docs/` 下。
2. 开发过程中临时产生的垃圾文件或者临时文件全部丢到 agent-tmp 下。
3. 用户要求将内容交到 git 时，简单快速提交，允许提交多余内容，不必完全拆分。提交到 git 时，message 应该遵守规范，使用中文。如果 push 时有冲突，先向用户确认要不要先 merge。

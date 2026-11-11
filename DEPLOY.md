# 切换系统、关机后仍能访问

当前 Demo 的地图、照片、示例全景、规则对话和浏览器语音功能均可运行在静态托管上，无需让本机 Node 服务持续开启。建议使用 Netlify Drop。

## 首次发布

1. 运行 `npm run deploy:package`。命令会构建最新版本，并在 `artifacts/` 输出一个 `virtour-site-…` 文件夹和同名 ZIP。
2. 打开 https://app.netlify.com/drop ，注册并登录自己的账号，以便保留、管理和更新网站。
3. 把命令输出的整个 `virtour-site-…` 文件夹拖入上传区。若使用 ZIP，请先解压，再上传里面含有 `index.html` 的文件夹。
4. 部署完成后打开平台提供的 HTTPS 网址。这个网址由托管平台提供，不再依赖本机 IP、热点或正在运行的操作系统。

部署包只含公开网页、浏览器模块、素材与来源说明；不含 `.env`、服务端、对话、测试或 Git 资料。请上传生成的站点文件夹。

## 修改后更新

重新运行 `npm run deploy:package`，然后进入已有站点的 **Deploys** 页面，将新的站点文件夹拖入上传区。更新已有站点会保留原网址；再次在 Drop 首页创建项目会得到另一个站点。

当前是手动发布：本地修改不会自动同步到线上。后续可以改成连接 Git 仓库自动部署。

## 能力范围

- 手机无需与电脑处于同一个网络；访问质量取决于当地网络与托管平台。
- HTTPS 满足麦克风安全连接条件，但语音识别仍依赖浏览器支持、网络与用户授权。
- 本地 Node 服务已接入导览后端；纯静态发布只保留本地规则，不提供 `/api/guide` 或 `/api/status`。需要在线问答时，请使用 Node.js 22+ 运行 `npm start` 或 `npm run preview`，并配置 `GUIDE_BACKEND_URL`（详见 README）。
- 网站由平台运行，账号配额、访问限制与保留政策以平台当时规定为准。

官方说明：https://docs.netlify.com/site-deploys/create-deploys/#drag-and-drop

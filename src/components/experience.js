import { pois } from '../data/pois.js';
import { escapeHTML as esc } from './html.js';
import { icon, landmark, avatar } from './icons.js';
import { mapMarkup } from './map.js';
import { externalAssets } from '../data/external-assets.js';

export function experienceMarkup() {
  return `
<main class="experience" aria-label="VirTour 景区导览">
  <header class="app-header">
    <div class="header-leading"><span class="wordmark" id="wordmark" aria-hidden="true">${icon('globe')}</span><button type="button" id="back-map" class="back-button" aria-label="返回地图" hidden>${icon('back')}<span>地图</span></button></div>
    <div class="header-place"><h1 id="place-title">世界之窗</h1><span id="place-subtitle">深圳</span></div>
    <div class="header-actions"><div class="mode-switch"><button type="button" id="mode-button" class="mode-trigger" aria-label="切换模式：地图对话" title="切换模式：地图对话" aria-expanded="false" aria-controls="mode-menu">${icon('mic')}<span class="mode-label">地图对话</span>${icon('down','mode-chevron')}</button><div id="mode-menu" class="mode-menu" role="group" aria-label="游览模式" hidden>${[['interactive','mic','地图对话'],['companion','pin','伴游模式']].map(([id,symbol,label]) => `<button type="button" data-tour-mode="${id}" aria-pressed="${id === 'interactive'}">${icon(symbol)}<span>${label}</span>${icon('check','mode-check')}</button>`).join('')}<button type="button" data-tour-mode="immersive" aria-pressed="false" hidden tabindex="-1">${icon('panorama')}<span>沉浸模式</span></button></div></div><button type="button" id="about-button" class="icon-button about-button" aria-label="关于这次漫游">${icon('info')}</button></div>
  </header>
  <section class="tour-workspace" aria-label="跟着好奇心探索">
    <div id="stage-shell" class="stage-shell">
      <div class="scene-canvas">
        <div class="scene-surface">
        <section id="map-scene" class="map-scene" aria-label="探索地图">${mapMarkup()}</section>
        <span id="trail-source" class="sr-only">模拟定位</span>
        <section id="panorama-scene" class="panorama-scene" aria-label="全景漫游" hidden>
          <canvas id="panorama-canvas" tabindex="0" aria-label="全景漫游，拖动或按方向键环顾，加减键缩放，Home键复位"></canvas>
          <span class="scene-disclaimer">360° 全景</span>
          <div id="panorama-hotspots" class="panorama-hotspots" aria-label="发现画面中的故事"></div>
          <div class="scene-controls" role="group" aria-label="全景控制"><button type="button" class="map-control" id="panorama-zoom-in" aria-label="拉近全景">+</button><button type="button" class="map-control" id="panorama-zoom-out" aria-label="拉远全景">−</button><button type="button" class="map-control" id="panorama-reset" aria-label="复位视角">${icon('compass')}</button></div>
          <div id="panorama-status" class="panorama-status" role="status"><span class="loading-orbit" aria-hidden="true"></span><p id="panorama-status-text">风景正在靠近…</p><button type="button" id="retry-panorama" class="secondary-button" hidden>再试一次</button></div>
        </section>
        <section id="photo-scene" class="photo-scene" aria-label="园区实拍" hidden tabindex="0">
          <img id="scene-photo" alt=""/><div id="photo-status" class="photo-status" role="status">风景正在靠近…</div>
          <div class="photo-caption"><span id="photo-label"></span><span id="photo-credit" class="photo-credit"></span><button type="button" id="photo-details" class="secondary-button">听听故事</button></div>
          <button type="button" id="retry-photo" class="secondary-button photo-retry" hidden>重新加载照片</button>
        </section>
        <div id="scene-cue" class="scene-cue" aria-hidden="true" hidden></div>
        </div>
        <section id="visit-card" class="context-card" aria-labelledby="visit-title" hidden><header><div><span class="eyebrow">游览参考</span><h2 id="visit-title"></h2></div><button type="button" id="close-visit" class="icon-button" aria-label="收起游览信息">${icon('close')}</button></header><dl id="visit-facts"></dl></section>
      </div>
    </div>
  </section>
  <div id="workspace-divider" class="workspace-divider" role="separator" tabindex="0" aria-label="调整画面与对话比例" aria-orientation="horizontal" aria-valuemin="25" aria-valuemax="65" aria-valuenow="40" aria-controls="stage-shell conversation-panel" hidden><span aria-hidden="true"></span></div>
  <footer class="voice-dock" aria-label="和数字导游说说话">
    <div class="guide-rail">
      <div id="guide-presence" class="guide-presence" data-state="idle">
        <button type="button" id="replay-guide" class="guide-portrait" aria-label="重听沐沐的话">${avatar()}<span id="guide-playback-icon" class="guide-playback-icon" aria-hidden="true" hidden>${icon('narrating')}</span></button>
        <div class="guide-copy">
          <div class="guide-name"><strong>沐沐</strong><span id="guide-state-label" class="sr-only">准备聆听</span></div>
          <div class="voice-message"><p id="voice-hint" class="voice-hint" role="status" aria-live="polite">准备麦克风 · 请允许权限</p><button type="button" id="microphone-help" class="microphone-help" aria-controls="microphone-sheet" aria-haspopup="dialog" hidden aria-label="查看麦克风权限帮助">${icon('info')}</button></div>
          <p id="conversation-hint" class="conversation-hint" hidden>打字和我聊聊</p>
          <p id="guide-caption" tabindex="0" aria-live="off">点一下地标，或说“带我看铁塔”。</p>
          <div id="guide-suggestions" class="guide-suggestions"></div>
          <span id="guide-announcement" class="sr-only" role="status"></span>
        </div>
      </div>
      <section id="conversation-panel" class="conversation-panel" aria-labelledby="conversation-mode-label" hidden>
        <span id="conversation-mode-label" class="sr-only">与数字导游的对话</span>
        <div id="conversation-log" class="conversation-log" role="log" aria-label="与数字导游的对话" aria-live="polite" aria-relevant="additions text" tabindex="0"></div>
        <div id="conversation-recommendation" class="conversation-prompt"><span id="conversation-prompt-label">需要我带你了解一下埃菲尔铁塔吗？</span><button type="button" id="conversation-prompt" class="recommendation-go" aria-label="前往埃菲尔铁塔并展开解说" title="前往景点并展开解说">${icon('arrow')}</button><button type="button" id="conversation-dismiss" class="recommendation-dismiss" aria-label="取消这条推荐" title="取消这条推荐">${icon('close')}</button></div>
      </section>
      <form id="voice-form" class="voice-form">
        <label class="sr-only" for="voice-input">想去哪里，问问沐沐</label>
        <input id="voice-input" type="text" placeholder="打字问我，或点话筒说一句" maxlength="2000" autocomplete="off" enterkeyhint="send"/>
        <button type="button" id="guide-voice-toggle" class="guide-voice-toggle" aria-label="关闭数字人声音" aria-pressed="true">${icon('speaker')}<span>有声</span></button>
        <button type="button" id="speech-button" class="mic-button" aria-label="说一句" aria-describedby="voice-hint" aria-pressed="false" aria-busy="false" data-voice-state="paused" data-listening="false">${icon('mic')}</button>
        <button type="submit" id="send-button" class="send-button" aria-label="发送" hidden>${icon('arrow')}</button>
      </form>
        <button type="button" id="live-call-button" class="live-call-button" aria-label="进入实时通话" aria-pressed="false">${icon('phone')}<span><strong>实时通话</strong><small>点一下进入通话</small></span></button>
    </div>
    <p id="voice-status" class="sr-only" role="status"></p>
  </footer>
</main>
<dialog id="microphone-sheet" class="sheet microphone-sheet" aria-labelledby="microphone-title" aria-describedby="microphone-explanation">
  <header><h2 id="microphone-title">开启语音交流</h2><button type="button" id="close-microphone" class="icon-button" aria-label="关闭麦克风帮助">${icon('close')}</button></header>
  <p id="microphone-explanation">允许麦克风后，就可以直接和数字导游说话。</p>
  <dl id="microphone-checks" class="microphone-checks"></dl>
  <ol id="microphone-steps" class="microphone-steps"></ol>
  <label for="microphone-address" class="microphone-address-label">当前页面地址</label>
  <input id="microphone-address" class="microphone-address" type="text" readonly aria-label="当前页面地址，可复制到 Chrome 或 Edge 打开"/>
  <div class="microphone-actions"><button type="button" id="enable-microphone" class="primary-button">开启麦克风并聆听</button><button type="button" id="microphone-use-text" class="secondary-button">先用文字交流</button></div>
</dialog>
<dialog id="catalog-sheet" class="sheet catalog-sheet" aria-labelledby="catalog-title"><header><h2 id="catalog-title">找一处风景</h2><button type="button" id="close-catalog" class="icon-button" aria-label="关闭景点目录">${icon('close')}</button></header><label class="sr-only" for="catalog-search">搜索景点</label><input type="search" id="catalog-search" placeholder="景点名字，或一个区域" autocomplete="off"/><label class="sr-only" for="catalog-region">区域</label><select id="catalog-region"><option value="">所有区域</option>${[...new Set(pois.map(p=>p.region))].map(region=>`<option>${region}</option>`).join('')}</select><p id="catalog-count" class="catalog-count" role="status"></p><div id="catalog-results" class="catalog-results"></div></dialog>
<dialog id="about-sheet" class="sheet" aria-labelledby="about-title"><header><h2 id="about-title">一张地图，一点好奇。</h2><button type="button" class="icon-button" id="close-about" aria-label="关闭">${icon('close')}</button></header><p>挑一个兴趣，让小旅陪你看。讲解时点小旅可以插话；说“安静”就停止主动服务。</p><div class="about-note"><p>已整理 ${pois.length} 条有来源的景点及体验记录，其中 ${pois.filter(p=>p.position).length} 处有 OSM 园内坐标，${pois.filter(p=>p.photo).length} 处配有园区实拍。名录包含待现场核对的历史条目，不是完整的官方在营名录。中国旅游集团介绍的规模为 130 多处景观。</p><p>铁塔入口展示原创 360° 示例插画；详情保留园区实拍。其他照片为普通园区实拍，尚未取得可接入的逐景点真实 360° 全景。未提供照片的条目展示资料，不代用海外照片。未接实时人流、排队或游客定位。</p><p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a>，地理数据已转为本地 SVG。照片作者和许可见各景点详情。</p><p>园界及设施来自 OSM，设施覆盖不全。园界门不等于已确认开放的出口。服务地点没有可靠坐标时，只展示说明。</p><p><a href="https://mp.weixin.qq.com/miniprogram/landing_page/YBJw_6MEoVO7ubwi5Pq3ntHU/en" target="_blank" rel="noopener noreferrer">官方智慧导览 · i深圳世界之窗</a>（微信小程序）。</p><p><a href="https://www.ctg.cn/article/95" target="_blank" rel="noopener noreferrer">中国旅游集团 · 世界之窗</a> · <a href="./assets/park-catalog.json" target="_blank" rel="noopener noreferrer">名录与来源</a></p><p><a href="${externalAssets.referenceMap?.file ?? '#'}" target="_blank" rel="noopener noreferrer">单轨路线参考图</a>（不作为全园地图）。${externalAssets.referenceMap?.attribution ?? ''} · <a href="${externalAssets.referenceMap?.licenseUrl ?? '#'}" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a></p><p id="guide-service-status">正在检查在线导游连接。</p><p>地图对话支持打字或语音交流，也可以关闭数字人声音。点击“实时通话”会进入只显示地图和数字人的通话画面，直到点击挂断。浏览器语音识别可能需要联网，手机麦克风需要安全连接。</p></div><button type="button" id="try-speaking" class="secondary-button">听听小旅的声音</button></dialog>`;
}

// Only reviewed, local content is interpolated; visitor input is rendered using textContent.
export function detailMarkup(poi, hotspot, sections, assetUrl) {
  const photo = poi.photo;
  const file = photo?.file ?? poi.panorama;
  const label = photo?.label ?? poi.panoramaLabel;
  const picture = file ? `<figure><img src="${esc(assetUrl(file))}" alt="${esc(poi.name)} · ${esc(label)}"/><figcaption>${esc(label)}</figcaption></figure>` : '';
  const content = hotspot ? `<section data-story-section="0"><h3>${esc(hotspot.title)}</h3><p>${esc(hotspot.body)}</p></section>` : sections.map((part,index) => `<section data-story-section="${index}"><h3>${esc(part.title)}</h3><p>${esc(part.text)}</p></section>`).join('');
  const note = poi.panoramaKind === 'illustration' ? '<p class="content-note">铁塔漫游采用原创 360° 示例插画，非世界之窗实拍；尚无可用的 360° 全景实拍。上方为园区历史实拍照片。</p>' : poi.panorama ? '' : '<p class="content-note">此景点尚无可用的 360° 全景。'+(photo ? '园区实拍摄于较早时间，不代表今天的运营状态。' : '园区实拍尚待补充。')+'</p>';
  const credit = photo ? `<p class="content-note"><a href="${esc(photo.source)}" target="_blank" rel="noopener noreferrer">${esc(photo.attribution)}</a> · <a href="${esc(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${esc(photo.license)}</a><br/>${esc(photo.changes)}<br/>拍摄记录：${esc(photo.capturedAt)}</p>` : '';
  return `${picture}${content}${note}${credit}<p class="content-note"><a href="${esc(poi.source)}" target="_blank" rel="noopener noreferrer">${esc(poi.sourceKind)}</a></p>`;
}

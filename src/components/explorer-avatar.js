import * as THREE from '../vendor/three.module.js';
import { closedSmilePose } from './avatar-expression.js';
import { sampleFrontalGait, sampleBipedGait, applyBipedGait } from './avatar-gait.js';

export const originalAvatarCapabilities = Object.freeze({
  actions: Object.freeze(['idle', 'walk', 'wave', 'point', 'turn']),
  expressions: Object.freeze(['neutral', 'happy', 'curious', 'concerned']),
  supportedActions: Object.freeze(['idle', 'walk', 'wave', 'point', 'turn']),
  supportedExpressions: Object.freeze(['neutral', 'happy', 'curious', 'concerned']),
  lipSync: 'playback-driven',
});

// Local, original artwork. Nested groups are the 2D joint hierarchy.
export function explorerRigMarkup() {
  return `<svg viewBox="0 0 180 240" aria-hidden="true" class="companion-rig explorer-rig">
    <defs>
      <linearGradient id="explorer-coat" x2=".7" y2="1"><stop stop-color="#9ddbc9"/><stop offset="1" stop-color="#51a892"/></linearGradient>
      <linearGradient id="explorer-hair" x2=".6" y2="1"><stop stop-color="#414b64"/><stop offset="1" stop-color="#202b43"/></linearGradient>
      <linearGradient id="explorer-hat" x2=".7" y2="1"><stop stop-color="#ffa998"/><stop offset="1" stop-color="#e97879"/></linearGradient>
      <linearGradient id="explorer-skin" x2=".15" y2="1"><stop stop-color="#ffe9d9"/><stop offset="1" stop-color="#ffd2be"/></linearGradient>
    </defs>
    <ellipse cx="90" cy="226" rx="34" ry="5" fill="#26495020"/>
    <g data-bone="root"><g transform="translate(90 139)">
      <g data-bone="tail"><rect x="-37" y="-13" width="73" height="51" rx="18" fill="#d6a36c"/><path d="M-23-10V32M23-10V32" stroke="#f6cf91" stroke-width="4"/></g>
      <g transform="translate(-14 41)"><g data-bone="legL"><path d="M-8-1H8L7 22H-6Z" fill="#ffdac6"/><g transform="translate(0 20)"><g data-bone="kneeL"><path d="M-6 0H7L6 17H-6Z" fill="#ffdac6"/><path d="M-7 12H7V24H-7Z" fill="#fcf8ef"/><path d="M-8 23Q-17 25-15 32H9V24Z" fill="#354865"/><path d="M-15 32H10" stroke="#f6e7cf" stroke-width="4" stroke-linecap="round"/></g></g></g></g>
      <g transform="translate(14 41)"><g data-bone="legR"><path d="M-8-1H8L6 22H-7Z" fill="#ffdac6"/><g transform="translate(0 20)"><g data-bone="kneeR"><path d="M-7 0H6V17H-6Z" fill="#ffdac6"/><path d="M-7 12H7V24H-7Z" fill="#fcf8ef"/><path d="M-8 24H8Q17 25 15 32H-9Z" fill="#354865"/><path d="M-10 32H15" stroke="#f6e7cf" stroke-width="4" stroke-linecap="round"/></g></g></g></g>
      <path d="M-23 25H23L28 47Q0 56-28 47Z" fill="#344761"/><path d="M-14 32-17 48M0 33V51M14 32 17 48" stroke="#536882" stroke-width="2"/>
      <path d="M-26-10Q0-20 26-10L31 29Q0 40-31 29Z" fill="url(#explorer-coat)"/>
      <path d="M-12-13 0-3 12-13 9 24H-9Z" fill="#fff9ec"/><path d="M-13-12-23-3-12 11 0-3M13-12 23-3 12 11 0-3" fill="#c4eadc"/>
      <path d="M-22 19H-12M12 19H23" stroke="#397e71" stroke-width="2" stroke-linecap="round"/>
      <g transform="translate(-28 -4)"><g data-bone="armL"><path d="M0-3Q-12-4-12 8L-10 23H4L7 8Z" fill="#75c1aa"/><g transform="translate(-3 21)"><g data-bone="elbowL"><path d="M-7-2H7V17Q0 24-7 17Z" fill="#9ddbc9"/><path d="M-7 12H7V19H-7Z" fill="#c4eadc"/><path d="M-5 19Q-11 24-5 29Q1 33 6 27L7 20Z" fill="#ffdac6"/><path d="M5 21Q12 17 11 24L7 28" fill="#ffdac6"/></g></g></g></g>
      <g transform="translate(28 -4)"><g data-bone="armR"><path d="M0-3Q12-4 12 8L10 23H-4L-7 8Z" fill="#75c1aa"/><g transform="translate(3 21)"><g data-bone="elbowR"><path d="M-7-2H7V17Q0 24-7 17Z" fill="#9ddbc9"/><path d="M-7 12H7V19H-7Z" fill="#c4eadc"/><path d="M-5 19Q-11 24-5 29Q1 33 6 27L7 20Z" fill="#ffdac6"/><path d="M-5 21Q-12 17-11 24L-7 28" fill="#ffdac6"/></g></g></g></g>
      <path d="M-22-9 24 33" stroke="#f3d49a" stroke-width="6"/>
      <rect x="7" y="18" width="28" height="24" rx="7" fill="#edbe78" stroke="#d6a36c" stroke-width="1.5"/><path d="M9 24Q22 32 33 24" fill="none" stroke="#fff0c9" stroke-width="2"/>
      <circle cx="21" cy="28" r="6" fill="#fff7df"/><path d="m21 23 2 5-2 5-2-5Z" fill="#3d8f81"/>
      <g transform="translate(0 -26)"><g data-bone="head">
        <path d="M-44-36Q-52-76 0-79Q51-76 45-36L49 10Q39 30 24 16H-26Q-45 30-49 10Z" fill="url(#explorer-hair)"/>
        <ellipse cx="-40" cy="-13" rx="9" ry="12" fill="#f7c5b2"/><ellipse cx="40" cy="-13" rx="9" ry="12" fill="#f7c5b2"/>
        <path d="M-41-37Q0-65 41-37L39-4Q35 24 0 28Q-35 24-39-4Z" fill="url(#explorer-skin)"/>
        <path d="M-42-34Q-39-63 0-63Q39-64 43-33L31-20 27-44Q10-28-8-35L-15-44Q-26-27-39-23Z" fill="url(#explorer-hair)"/>
        <path d="M-33-44Q-22-52-12-53M3-54Q20-57 31-47" fill="none" stroke="#66708b" stroke-width="2" stroke-linecap="round"/>
        <g data-bone="eyes"><ellipse cx="-19" cy="-18" rx="6.4" ry="8.3" fill="#fffaf3"/><ellipse cx="19" cy="-18" rx="6.4" ry="8.3" fill="#fffaf3"/><ellipse cx="-18" cy="-17" rx="4.6" ry="6.8" fill="#465273"/><ellipse cx="18" cy="-17" rx="4.6" ry="6.8" fill="#465273"/><ellipse cx="-18" cy="-16" rx="2.5" ry="4.6" fill="#202c43"/><ellipse cx="18" cy="-16" rx="2.5" ry="4.6" fill="#202c43"/><circle cx="-20" cy="-20" r="2" fill="white"/><circle cx="16" cy="-20" r="2" fill="white"/><path d="M-25-22Q-19-29-13-22M13-22Q19-29 25-22" fill="none" stroke="#27334a" stroke-width="2" stroke-linecap="round"/></g>
        <path data-bone="brows" d="M-25-33Q-19-36-13-33M13-33Q19-36 25-33" fill="none" stroke="#5b5261" stroke-width="2" stroke-linecap="round"/>
        <ellipse cx="-29" cy="0" rx="8" ry="4" fill="#ef9b9d" opacity=".55"/><ellipse cx="29" cy="0" rx="8" ry="4" fill="#ef9b9d" opacity=".55"/>
        <path d="M0-9-2-1 2 0" fill="none" stroke="#e9ac9d" stroke-width="1.6" stroke-linecap="round"/>
        <path data-bone="smile" d="M-8 10Q0 18 8 10" fill="none" stroke="#aa5b67" stroke-width="2.3" stroke-linecap="round"/>
        <ellipse data-bone="mouth" cy="13" rx="6" ry="5" fill="#9d4e60"/>
        <path d="M-43-55Q-58-73-28-85Q4-99 39-81Q59-70 43-53Q0-38-43-55Z" fill="url(#explorer-hat)"/>
        <path d="M-42-54Q0-40 42-54L39-47Q0-33-40-47Z" fill="#ce666d"/>
        <path d="M-32-72Q-10-86 17-81" fill="none" stroke="#ffc9b4" stroke-width="3" stroke-linecap="round"/>
        <path d="m28-66 2.5 6 6.5.5-5 4 1.5 6-5.5-3.5-5.5 3.5 1.5-6-5-4 6.5-.5Z" fill="#fff0ba"/>
        <circle cx="-39" cy="3" r="3" fill="#efbe75"/><circle cx="39" cy="3" r="3" fill="#efbe75"/>
      </g></g>
      <path d="M-12-11 0-4 12-11 7 1 0 4-7 1Z" fill="#ee8f83"/><path d="M3 3 13 14 15 1" fill="#dc7575"/>
    </g></g></svg>`;
}

let rigInstance = 0;

/** Shared driver for the original SVG joint rigs. The target is an HTML container. */
export function createSvgRig2D(host, { markup, id, name, eyeY = -21, mouthY = 13, waveAngle = 145 }) {
  if (!host?.append || host.tagName?.toLowerCase() === 'canvas') throw new TypeError('SVG avatars require an HTML container');
  const template = document.createElement('template');
  // Keep gradient ids separate when both a portrait and a full character exist.
  const prefix = `original-rig-${++rigInstance}-`;
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  for (const oldId of ids) markup = markup.replaceAll(`id="${oldId}"`, `id="${prefix}${oldId}"`).replaceAll(`url(#${oldId})`, `url(#${prefix}${oldId})`);
  template.innerHTML = markup.trim();
  const element = template.content.firstElementChild;
  host.append(element);
  element.style.width = '100%'; element.style.height = '100%'; element.style.display = 'block'; element.style.transformOrigin = '50% 50%';
  const bones = Object.fromEntries([...element.querySelectorAll('[data-bone]')].map(node => [node.dataset.bone, node]));
  const originalBrows = bones.brows?.getAttribute('d');
  const originalSmile = bones.smile?.getAttribute('d');
  let disposed = false;
  const set = (name, attr, value) => {
    const node = bones[name];
    if (node && node.getAttribute(attr) !== value) node.setAttribute(attr, value);
  };
  return {
    element,
    capabilities: originalAvatarCapabilities,
    metadata: { id, name, renderer: 'original-svg-joints', capabilities: originalAvatarCapabilities },
    draw({ time = 0, action = 'idle', walk = false, wave = false, point = false, turn = 0, emotion = 'neutral', talk = false, listen = false } = {}) {
      if (disposed) return;
      walk = walk || action === 'walk'; wave = wave || action === 'wave'; point = point || action === 'point';
      const gait = sampleFrontalGait(time, walk), stride = gait.swing * 24;
      set('root', 'transform', `translate(0 ${walk ? Math.abs(Math.sin(time * 8)) * -3 : Math.sin(time * 2)})`);
      set('legL', 'transform', `scale(1 ${gait.left.scaleY})`); set('legR', 'transform', `scale(1 ${gait.right.scaleY})`);
      set('armL', 'transform', `rotate(${wave ? waveAngle + Math.sin(time * 7) * 10 : -stride * .7})`);
      set('armR', 'transform', `rotate(${point ? -90 : stride * .7})`);
      set('elbowL', 'transform', `rotate(${wave ? 20 + Math.sin(time * 7) * 10 : -8})`);
      set('elbowR', 'transform', `rotate(${point ? -8 : 8})`);
      set('kneeL', 'transform', `scale(1 ${gait.left.footScaleY})`);
      set('kneeR', 'transform', `scale(1 ${gait.right.footScaleY})`);
      set('head', 'transform', `rotate(${listen ? -9 : emotion === 'curious' ? 9 : emotion === 'concerned' ? -4 : Math.sin(time) * 2})`);
      set('tail', 'transform', `rotate(${Math.sin(time * 2) * (emotion === 'happy' ? 8 : 4)})`);
      const blink = time % 4.8 < .13 ? .1 : emotion === 'happy' ? .65 : emotion === 'concerned' ? .94 : 1;
      set('eyes', 'transform', `translate(0 ${eyeY}) scale(1 ${blink}) translate(0 ${-eyeY})`);
      const mouth = talk ? .3 + Math.abs(Math.sin(time * 13)) : emotion === 'curious' ? .7 : 0;
      set('mouth', 'transform', `translate(0 ${mouthY}) scale(1 ${mouth}) translate(0 ${-mouthY})`);
      set('smile', 'opacity', talk || emotion === 'curious' ? '0' : '1');
      const smilePose = closedSmilePose(emotion, mouthY);
      // Preserve each animal's own muzzle/W-shaped mouth in every expression.
      set('smile', 'd', originalSmile);
      set('smile', 'transform', `translate(0 ${smilePose.offsetY}) scale(1 ${smilePose.scaleY})`);
      set('brows', 'd', emotion === 'curious' ? `M-27 ${eyeY - 15} Q-20 ${eyeY - 19} -13 ${eyeY - 15} M13 ${eyeY - 11} Q20 ${eyeY - 13} 27 ${eyeY - 11}` : originalBrows);
      set('brows', 'transform', emotion === 'concerned' ? 'translate(0 -1.4)' : 'translate(0 0)');
      const scale = action === 'turn' ? Math.cos(turn || time * .8) : 1;
      const transform = `scaleX(${Math.abs(scale) < .08 ? .08 * (scale < 0 ? -1 : 1) : scale})`;
      if (element.style.transform !== transform) element.style.transform = transform;
    },
    dispose() { if (disposed) return; disposed = true; element.remove(); },
  };
}

export function createExplorer2D(host) {
  return createSvgRig2D(host, { markup: explorerRigMarkup(), id: 'explorer-2d', name: '星遥', eyeY: -18, waveAngle: 115 });
}

/** Pure scene construction also makes knee/ankle trajectories testable in Node. */
export function buildExplorerRig() {
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff,0x879ca4,2.7));
  for(const [color,intensity,x,y,z] of [[0xffefd9,3,-3,5,5],[0xdcefff,2,3,3,-2]]) {
    const light=new THREE.DirectionalLight(color,intensity); light.position.set(x,y,z); scene.add(light);
  }
  const colors={skin:0xffd5be,hair:0x283650,hairLight:0x465674,coat:0x75c7af,cuff:0xc9e9d9,white:0xfff7e8,shoe:0x314462,hat:0xf29a90,hatDark:0xd9767e,gold:0xe8b76e,iris:0x4b6280,dark:0x1d2d48,blush:0xf0a1a1,mouth:0x9e5165};
  const mats=Object.fromEntries(Object.entries(colors).map(([k,color])=>[k,new THREE.MeshStandardMaterial({color,roughness:k==='iris'?.3:.76})]));
  const root=new THREE.Group(); scene.add(root);
  const sphere=new THREE.SphereGeometry(1,32,24);
  function ell(parent,mat,x,y,z,sx,sy,sz) { const m=new THREE.Mesh(sphere,mats[mat]);m.position.set(x,y,z);m.scale.set(sx,sy,sz);parent.add(m);return m; }
  function joint(parent,x,y,z) {const p=new THREE.Group();p.position.set(x,y,z);parent.add(p);return p;}
  function cylinder(parent,mat,top,bottom,height,x,y,z) {const m=new THREE.Mesh(new THREE.CylinderGeometry(top,bottom,height,32),mats[mat]);m.position.set(x,y,z);parent.add(m);return m;}
  const legL=joint(root,-.17,.77,0),legR=joint(root,.17,.77,0);
  const knees=[],ankles=[];
  for(const leg of [legL,legR]) {
    ell(leg,'skin',0,-.16,0,.105,.22,.12);
    const knee=joint(leg,0,-.31,0);knees.push(knee);
    ell(knee,'skin',0,-.12,0,.09,.19,.1);cylinder(knee,'white',.095,.105,.18,0,-.23,0);
    const ankle=joint(knee,0,-.35,0);ankles.push(ankle);
    ell(ankle,'shoe',0,0,.08,.14,.095,.22);ell(ankle,'white',0,-.05,.08,.145,.035,.225);
    ell(ankle,'gold',0,.04,.22,.06,.018,.012);
  }
  cylinder(root,'shoe',.29,.4,.26,0,.83,0);
  ell(root,'coat',0,1.15,0,.37,.42,.24);ell(root,'white',0,1.22,.225,.145,.27,.035);
  for(const s of [-1,1]) { const lapel=ell(root,'cuff',s*.15,1.35,.225,.09,.19,.04);lapel.rotation.z=s*-.35;ell(root,'coat',s*.22,1.06,.216,.09,.055,.025); }
  cylinder(root,'skin',.115,.12,.2,0,1.55,0);
  const armL=joint(root,-.35,1.4,0),armR=joint(root,.35,1.4,0),elbows=[];
  for(const arm of [armL,armR]) {
    ell(arm,'coat',0,-.15,0,.125,.22,.14);
    const elbow=joint(arm,0,-.29,0);elbows.push(elbow);
    ell(elbow,'coat',0,-.12,0,.105,.18,.12);cylinder(elbow,'cuff',.109,.109,.09,0,-.22,0);
    ell(elbow,'skin',0,-.31,.01,.105,.125,.075);ell(elbow,'skin',.085,-.285,.045,.05,.075,.045);
  }
  const bag=joint(root,0,1.2,-.25);
  ell(bag,'gold',0,-.04,-.06,.32,.34,.14);ell(bag,'white',0,.15,-.12,.25,.08,.07);
  for(const s of [-1,1]) ell(root,'gold',s*.26,1.26,.02,.035,.28,.25);
  const strap=ell(root,'gold',0,1.22,.26,.028,.4,.027);strap.rotation.z=.65;
  ell(root,'gold',.23,.92,.29,.19,.16,.07);ell(root,'white',.23,.96,.355,.07,.07,.015);
  const needle=new THREE.Mesh(new THREE.ConeGeometry(.025,.095,3),mats.coat);needle.position.set(.23,.96,.38);root.add(needle);
  ell(root,'hat',0,1.5,.07,.26,.075,.2);
  const scarf=ell(root,'hatDark',.12,1.37,.25,.065,.18,.025);scarf.rotation.z=.35;
  const head=joint(root,0,1.93,0);
  ell(head,'hair',0,.04,-.035,.57,.61,.43);
  ell(head,'skin',0,-.015,.17,.485,.48,.36);
  for(const s of [-1,1]) {
    ell(head,'skin',s*.475,-.02,.13,.09,.13,.075);ell(head,'gold',s*.48,-.13,.18,.035,.04,.035);
    const side=ell(head,'hair',s*.45,.035,.1,.13,.46,.24);side.rotation.z=s*.08;
    ell(head,'blush',s*.3,-.16,.455,.09,.038,.009);
  }
  // Layered fringe and specular eyes make facial cues readable at small sizes.
  for(const [x,y,z,sx,sy,rz] of [[-.3,.32,.4,.18,.28,-.45],[-.1,.38,.45,.2,.22,-.4],[.14,.39,.43,.21,.19,.15],[.34,.31,.37,.14,.24,.3]]) {
    const hair=ell(head,'hair',x,y,z,sx,sy,.09);hair.rotation.z=rz;
  }
  const eyes=[];
  for(const s of [-1,1]) {
    const eye=joint(head,s*.19,.035,.487);eyes.push(eye);
    ell(eye,'white',0,0,0,.087,.11,.028);ell(eye,'iris',0,-.005,.023,.061,.09,.018);ell(eye,'dark',0,-.005,.037,.035,.065,.009);
    ell(eye,'white',-.023,.036,.048,.021,.025,.009);ell(eye,'white',.023,-.032,.046,.009,.012,.008);
    const lash=ell(eye,'dark',0,.082,.014,.085,.015,.021);lash.rotation.z=s*-.12;
  }
  const brows=[-1,1].map(s=>ell(head,'hairLight',s*.19,.225,.47,.082,.017,.017));
  ell(head,'skin',0,-.1,.535,.04,.06,.045);
  const mouth=ell(head,'mouth',0,-.245,.485,.065,.025,.012);
  const smileCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.065,-.23,.49),new THREE.Vector3(0,-.255,.505),new THREE.Vector3(.065,-.23,.49)]);
  const smile=new THREE.Mesh(new THREE.TubeGeometry(smileCurve,16,.008,6,false),mats.mouth);head.add(smile);
  const beret=ell(head,'hat',-.04,.58,-.015,.6,.2,.45);beret.rotation.z=-.12;
  const rim=ell(head,'hatDark',0,.49,.005,.53,.045,.405);rim.rotation.z=-.08;
  ell(head,'hat',-.08,.76,-.03,.045,.065,.045);
  const starShape=new THREE.Shape();
  for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,r=i%2?.045:.1;const x=Math.cos(a)*r,y=Math.sin(a)*r;if(i===0) starShape.moveTo(x,y);else starShape.lineTo(x,y);}starShape.closePath();
  const star=new THREE.Mesh(new THREE.ExtrudeGeometry(starShape,{depth:.015,bevelEnabled:false}),mats.gold);star.position.set(.32,.56,.36);head.add(star);
  let disposed = false;
  return {root,scene,joints:{legL,legR,knees,ankles},capabilities: originalAvatarCapabilities, metadata: { id:'explorer-3d', name:'星遥', renderer:'original-three-joints' }, draw({time=0,action='idle',walk=false,wave=false,point=false,turn=0,emotion='neutral',talk=false,listen=false} = {}) {
    if (disposed) return;
    walk=walk||action==='walk';wave=wave||action==='wave';point=point||action==='point';
    if(action==='turn' && turn===0) turn=time*.8;
    root.rotation.y=turn;root.rotation.z=walk?Math.sin(time*8)*.025:0;
    root.position.y=walk?Math.abs(Math.sin(time*8))*.035:Math.sin(time*2)*.012;
    applyBipedGait(sampleBipedGait(time,{walking:walk,hipHalfWidth:.17,upperLength:.31,lowerLength:.35,stepLength:.045,stepHeight:.035}),[legL,legR],knees,ankles);
    armL.rotation.z=wave?-2.05+Math.sin(time*6)*.12:-.13;
    armL.rotation.x=walk?-Math.sin(time*8)*.4:0;
    armR.rotation.z=point?1.2:.13;armR.rotation.x=walk?Math.sin(time*8)*.4:0;
    elbows[0].rotation.z=wave?-.6+Math.sin(time*7)*.23:-.08;elbows[1].rotation.z=point?.3:.08;
    head.rotation.z=listen?.15:emotion==='curious'?-.12:emotion==='concerned'?-.06:Math.sin(time*.9)*.035;
    head.rotation.y=Math.sin(time*.7)*.06;
    const blink=time%5<.12?.08:emotion==='happy'?.72:emotion==='concerned'?.94:1;
    eyes.forEach(e=>e.scale.y=blink);
    brows.forEach((b,i)=>{b.rotation.z=emotion==='concerned'?(i?-.14:.14):emotion==='curious'?(i?-.2:.1):0;b.position.y=emotion==='curious'?.25:emotion==='concerned'?.235:.225;});
    mouth.scale.y=.025*(talk?.6+Math.abs(Math.sin(time*13))*1.8:emotion==='curious'?1.8:1);
    mouth.visible=talk||emotion==='curious';
    const smilePose=closedSmilePose(emotion,-.245);
    smile.visible=emotion!=='curious'&&!talk;smile.scale.y=smilePose.scaleY;smile.position.y=smilePose.offsetY;bag.rotation.z=Math.sin(time*(walk?8:2))*(walk?.05:.015);
  },dispose(){if(disposed)return;disposed=true;const geometries=new Set();scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);});geometries.forEach(g=>g.dispose());Object.values(mats).forEach(m=>m.dispose());}};
}

export function createExplorer3D(canvas) {
  const rig=buildExplorerRig();
  let renderer;
  try {
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1,1.5)); renderer.setSize(300,400,false);
    renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.25;
  } catch(error) {rig.dispose();renderer?.dispose();throw error;}
  const camera=new THREE.PerspectiveCamera(32,.75,.1,30); camera.position.set(0,1.65,5.9); camera.lookAt(0,1.4,0);
  let disposed=false;
  return {
    capabilities:rig.capabilities,metadata:rig.metadata,
    draw(params){if(disposed)return;rig.draw(params);renderer.render(rig.scene,camera);},
    dispose(){if(disposed)return;disposed=true;rig.dispose();renderer.dispose();},
  };
}

import * as THREE from '../vendor/three.module.js';
import { createSvgRig2D, originalAvatarCapabilities } from './explorer-avatar.js';
import { closedSmilePose } from './avatar-expression.js';
import { sampleBipedGait, applyBipedGait } from './avatar-gait.js';

// Restored from the original companion demo: the standing travel fox with its
// green hat, jacket and coral scarf. This is separate from the official glTF fox.
export function originalFoxRigMarkup() {
  return `<svg viewBox="0 0 180 240" aria-hidden="true" class="companion-rig original-fox-rig">
    <ellipse cx="90" cy="226" rx="42" ry="7" fill="#285d4920"/>
    <g data-bone="root"><g transform="translate(90 139)">
      <g data-bone="tail"><path d="M20 30Q88 38 62-29Q105 26 38 52Z" fill="#e9a46a"/><path d="M62-29Q81-8 79 6L66 2Z" fill="#fff3e4"/></g>
      <g transform="translate(-17 43)"><g data-bone="legL"><rect x="-9" y="-2" width="18" height="35" rx="8" fill="#3a695d"/><ellipse cy="34" rx="13" ry="7" fill="#374942"/></g></g>
      <g transform="translate(17 43)"><g data-bone="legR"><rect x="-9" y="-2" width="18" height="35" rx="8" fill="#3a695d"/><ellipse cy="34" rx="13" ry="7" fill="#374942"/></g></g>
      <rect x="-33" y="-8" width="66" height="60" rx="23" fill="#55a18c"/><path d="M-18 8H18V43H-18Z" fill="#d5ebe1"/><path d="M-10 18H10M-10 25H5" stroke="#548e7b" stroke-width="3"/>
      <g transform="translate(-32 3)"><g data-bone="armL"><rect x="-10" y="-3" width="17" height="38" rx="8" fill="#e9a46a"/><circle cx="-1" cy="36" r="10" fill="#fff1dd"/></g></g>
      <g transform="translate(32 3)"><g data-bone="armR"><rect x="-7" y="-3" width="17" height="38" rx="8" fill="#e9a46a"/><circle cx="1" cy="36" r="10" fill="#fff1dd"/></g></g>
      <g transform="translate(0 -26)"><g data-bone="head">
        <path d="M-45-23-51-76-16-48M16-48 51-76 45-23" fill="#e9a46a" stroke="#cb8958" stroke-width="2"/><path d="M-43-61-38-34-23-47M43-61 38-34 23-47" fill="#f4c4b2"/>
        <path d="M-51-29Q-49-68 0-59Q49-68 51-29L55-9 38 14Q0 35-38 14L-55-9Z" fill="#f0b37c"/>
        <path d="M-53-12Q-25-16 0 9Q25-16 53-12L38 14Q0 35-38 14Z" fill="#fff3e4"/>
        <g data-bone="eyes"><ellipse cx="-23" cy="-21" rx="4" ry="6" fill="#263e37"/><ellipse cx="23" cy="-21" rx="4" ry="6" fill="#263e37"/><circle cx="-22" cy="-23" r="1.4" fill="white"/><circle cx="24" cy="-23" r="1.4" fill="white"/></g>
        <path data-bone="brows" d="M-30-33-17-34M17-34 30-33" stroke="#725440" stroke-width="3" stroke-linecap="round" fill="none"/>
        <ellipse cx="-35" cy="-4" rx="8" ry="4" fill="#e9938a" opacity=".6"/><ellipse cx="35" cy="-4" rx="8" ry="4" fill="#e9938a" opacity=".6"/>
        <path d="M-7-3Q0-7 7-3L0 3Z" fill="#374942"/><path data-bone="smile" d="M-9 10Q0 20 9 10" fill="none" stroke="#805242" stroke-width="3" stroke-linecap="round"/>
        <ellipse data-bone="mouth" cy="13" rx="7" ry="6" fill="#744638"/>
        <path d="M-36-48Q-31-79 0-79Q31-79 36-48Z" fill="#397e6b"/><path d="M-44-46Q0-32 44-46" fill="none" stroke="#397e6b" stroke-width="9" stroke-linecap="round"/><path d="M-31-56Q0-47 31-56" fill="none" stroke="#cee0bd" stroke-width="6"/>
      </g></g><path d="M-26-9 0 4 26-9 18 6 0 13-20 5Z" fill="#ec7973"/>
    </g></g></svg>`;
}

export function createOriginalFox2D(host) {
  return createSvgRig2D(host, { markup: originalFoxRigMarkup(), id: 'original-fox-2d', name: '小旅', waveAngle: 145 });
}

/** The articulated model is independent of WebGL so its gait can be inspected. */
export function buildOriginalFoxRig() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x567f6d, 2.6));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-3, 5, 4); scene.add(light);
  const materials = Object.fromEntries(Object.entries({ fur: 0xe9a46a, cream: 0xfff1dd, green: 0x438e78, dark: 0x293f38, pink: 0xec7973 }).map(([key, color]) => [key, new THREE.MeshStandardMaterial({ color, roughness: .85 })]));
  const root = new THREE.Group(); scene.add(root);
  function ell(parent, mat, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), materials[mat]); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); return mesh;
  }
  function pivot(x, y, z) { const joint = new THREE.Group(); joint.position.set(x, y, z); root.add(joint); return joint; }
  const legL = pivot(-.23, .55, 0), legR = pivot(.23, .55, 0);
  const knees = [], ankles = [];
  for (const leg of [legL, legR]) {
    ell(leg, 'green', 0, -.08, 0, .13, .2, .15);
    const knee = new THREE.Group(); knee.position.y = -.22; leg.add(knee); knees.push(knee);
    ell(knee, 'green', 0, -.12, 0, .12, .14, .14);
    const ankle = new THREE.Group(); ankle.position.y = -.22; knee.add(ankle); ankles.push(ankle);
    ell(ankle, 'dark', 0, 0, .07, .18, .1, .24);
  }
  ell(root, 'green', 0, .96, 0, .46, .53, .29); ell(root, 'cream', 0, .99, .255, .25, .32, .06);
  const armL = pivot(-.44, 1.21, 0), armR = pivot(.44, 1.21, 0);
  for (const joint of [armL, armR]) { ell(joint, 'fur', 0, -.23, 0, .12, .29, .13); ell(joint, 'cream', 0, -.48, 0, .14, .14, .14); }
  const head = pivot(0, 1.68, 0);
  ell(head, 'fur', 0, .17, 0, .63, .53, .39);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(.21, .65, 3), materials.fur); ear.position.set(side * .44, .68, 0); ear.rotation.z = side * -.24; head.add(ear);
    ell(head, 'cream', side * .23, -.01, .31, .29, .23, .13);
  }
  const eyes = [-1, 1].map(side => ell(head, 'dark', side * .24, .25, .355, .047, .075, .035));
  ell(head, 'dark', 0, .045, .46, .08, .055, .05);
  const mouth = ell(head, 'dark', 0, -.105, .425, .085, .018, .025);
  const smileCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-.08, -.09, .435), new THREE.Vector3(0, -.13, .45), new THREE.Vector3(.08, -.09, .435)]);
  const smile = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 14, .009, 6, false), materials.dark); head.add(smile);
  const brows = [-1, 1].map(side => ell(head, 'dark', side * .24, .38, .33, .105, .022, .026));
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(.35, .46, .23, 24), materials.green); hat.position.set(0, .64, 0); head.add(hat);
  ell(head, 'green', 0, .54, .03, .61, .045, .43); ell(head, 'cream', 0, .6, .36, .34, .035, .025);
  ell(root, 'pink', 0, 1.42, .08, .4, .08, .28);
  const tail = pivot(0, .7, -.18); const tailBody = ell(tail, 'fur', .42, .1, -.25, .23, .49, .23); tailBody.rotation.z = -.75; ell(tail, 'cream', .64, .36, -.25, .17, .2, .18);
  let disposed = false;
  return {
    root, scene, joints: { legL, legR, knees, ankles },
    capabilities: originalAvatarCapabilities,
    metadata: { id: 'original-fox-3d', name: '小旅', renderer: 'original-three-joints' },
    draw({ time = 0, action = 'idle', walk = false, wave = false, point = false, turn = 0, emotion = 'neutral', talk = false, listen = false } = {}) {
      if (disposed) return;
      walk = walk || action === 'walk'; wave = wave || action === 'wave'; point = point || action === 'point';
      if (action === 'turn' && turn === 0) turn = time * .8;
      root.rotation.y = turn; root.position.y = walk ? Math.abs(Math.sin(time * 8)) * .045 : Math.sin(time * 2) * .015;
      applyBipedGait(sampleBipedGait(time, { walking: walk, hipHalfWidth: .23, upperLength: .22, lowerLength: .22, stepLength: .05, stepHeight: .026 }), [legL, legR], knees, ankles);
      armL.rotation.z = wave ? -2.4 + Math.sin(time * 7) * .25 : -.12;
      armR.rotation.z = point ? 1.45 : .12;
      armL.rotation.x = walk ? -Math.sin(time * 8) * .38 : 0;
      armR.rotation.x = walk ? Math.sin(time * 8) * .38 : 0;
      head.rotation.z = listen ? .18 : emotion === 'curious' ? -.14 : emotion === 'concerned' ? -.06 : Math.sin(time) * .035;
      const blink = time % 4.8 < .13 ? .1 : emotion === 'happy' ? .65 : emotion === 'concerned' ? .94 : 1;
      eyes.forEach(eye => { eye.scale.y = .075 * blink; });
      brows.forEach((brow, index) => { brow.rotation.z = emotion === 'concerned' ? (index ? -.14 : .14) : emotion === 'curious' ? (index ? -.15 : .15) : 0; brow.position.y = emotion === 'curious' ? .42 : emotion === 'concerned' ? .39 : .38; });
      mouth.scale.y = talk ? .045 + Math.abs(Math.sin(time * 13)) * .055 : emotion === 'curious' ? .05 : .018;
      mouth.visible = talk || emotion === 'curious' || emotion === 'neutral';
      smile.visible = !talk && ['happy', 'concerned'].includes(emotion);
      const smilePose = closedSmilePose(emotion, -.11);
      smile.scale.y = smilePose.scaleY; smile.position.y = smilePose.offsetY;
      tail.rotation.z = Math.sin(time * 2) * (emotion === 'happy' ? .18 : .1);
    },
    dispose() {
      if (disposed) return; disposed = true;
      const geometries = new Set(); scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
      geometries.forEach(geometry => geometry.dispose()); Object.values(materials).forEach(material => material.dispose());
    },
  };
}

export function createOriginalFox3D(canvas) {
  const rig = buildOriginalFoxRig();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5)); renderer.setSize(180, 240, false);
  } catch (error) { rig.dispose(); renderer?.dispose(); throw error; }
  const camera = new THREE.PerspectiveCamera(34, .75, .1, 30); camera.position.set(0, 1.7, 6.5); camera.lookAt(0, 1.35, 0);
  let disposed = false;
  return {
    capabilities: rig.capabilities, metadata: rig.metadata,
    draw(params) { if (disposed) return; rig.draw(params); renderer.render(rig.scene, camera); },
    dispose() { if (disposed) return; disposed = true; rig.dispose(); renderer.dispose(); },
  };
}

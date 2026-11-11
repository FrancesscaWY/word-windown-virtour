import * as THREE from '../vendor/three.module.js';
import { createSvgRig2D, originalAvatarCapabilities } from './explorer-avatar.js';
import { sampleBipedGait, applyBipedGait } from './avatar-gait.js';

/** A jointed, locally drawn interpretation of the otter explorer reference. */
export function otterRigMarkup() {
  // Static, seeded brush marks preserve the illustrated reference's soft fur
  // and woven clothes without loading a photograph or doing work each frame.
  let brushSeed = 3107;
  const random = () => ((brushSeed = (brushSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const brush = (count, width, height, color, opacity) => {
    const batches = ['', '', ''];
    for (let i = 0; i < count; i++) {
      const x = (random() - .5) * width, y = (random() - .5) * height;
      const length = .7 + random() * 2.2;
      const mark = `M${x.toFixed(2)} ${y.toFixed(2)}q${(-.7 + random() * 1.4).toFixed(2)} ${(-length * .5).toFixed(2)} ${(random() * 1.8 - .9).toFixed(2)} ${(-length).toFixed(2)}`;
      batches[Math.floor(random() * 3)] += mark;
    }
    return batches.map((marks, i) => `<path d="${marks}" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${.5 + i * .28}" stroke-linecap="round" fill="none"/>`).join('');
  };
  return `<svg viewBox="0 0 240 320" aria-hidden="true" class="companion-rig otter-rig">
    <defs>
      <radialGradient id="otter-fur" cx=".36" cy=".26" r=".87"><stop stop-color="#d3a778"/><stop offset=".48" stop-color="#bd8d5f"/><stop offset=".82" stop-color="#a6764e"/><stop offset="1" stop-color="#8e6345"/></radialGradient>
      <linearGradient id="otter-cream" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#fff4dc"/><stop offset=".6" stop-color="#f5e6c9"/><stop offset="1" stop-color="#e8d6b4"/></linearGradient>
      <linearGradient id="otter-jacket" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f9ecd0"/><stop offset=".65" stop-color="#eee0bf"/><stop offset="1" stop-color="#d2bd95"/></linearGradient>
      <linearGradient id="otter-hat" x1=".15" y1="0" x2=".8" y2="1"><stop stop-color="#f7e6bc"/><stop offset=".55" stop-color="#ebd4a4"/><stop offset="1" stop-color="#d7b880"/></linearGradient>
      <linearGradient id="otter-sage" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b5bc92"/><stop offset=".45" stop-color="#919f78"/><stop offset="1" stop-color="#6e7f5d"/></linearGradient>
      <linearGradient id="otter-leather" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#b5844f"/><stop offset=".55" stop-color="#996b40"/><stop offset="1" stop-color="#785032"/></linearGradient>
      <linearGradient id="otter-glass" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#b4c2b4"/><stop offset=".55" stop-color="#8eaaa0"/><stop offset="1" stop-color="#688780"/></linearGradient>
      <radialGradient id="otter-blush"><stop stop-color="#d7a17d" stop-opacity=".5"/><stop offset="1" stop-color="#d7a17d" stop-opacity="0"/></radialGradient>
      <radialGradient id="otter-eye" cx=".35" cy=".25" r=".8"><stop stop-color="#624331"/><stop offset=".45" stop-color="#38251c"/><stop offset="1" stop-color="#211710"/></radialGradient>
      <radialGradient id="otter-cheek" cx=".45" cy=".28" r=".75"><stop stop-color="#fff8e9"/><stop offset=".68" stop-color="#f3e3c8"/><stop offset="1" stop-color="#d9be99" stop-opacity=".2"/></radialGradient>
      <clipPath id="otter-fur-clip"><path d="M-51-33C-54-68-27-76 0-74C31-76 53-61 53-33L54-14 58-8 53-2 55 5 48 8C41 27 18 34 0 34C-22 34-44 24-49 9L-55 5-53-2-57-7-52-14Z"/></clipPath>
      <clipPath id="otter-coat-clip"><path d="M-29-18Q-40 1-38 43L-35 57Q-23 63-11 58L-12 4H12L11 58Q25 63 37 55L39 42Q38 2 28-18Z"/></clipPath>
      <filter id="otter-paper" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency=".65" numOctaves="2" seed="8" result="grain"/><feColorMatrix in="grain" type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope=".3" intercept=".65"/><feFuncG type="linear" slope=".3" intercept=".65"/><feFuncB type="linear" slope=".3" intercept=".65"/><feFuncA type="linear" slope=".22"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in" result="paper"/><feBlend in="SourceGraphic" in2="paper" mode="multiply"/></filter>
    </defs>
    <ellipse cx="121" cy="295" rx="46" ry="6" fill="#57482f" opacity=".12"/>
    <g data-bone="root"><g transform="translate(120 190)" filter="url(#otter-paper)">
      <g transform="translate(-6 46)"><g data-bone="tail"><path d="M10-8C-17-8-28 18-57 18C-70 19-77 14-82 19C-84 34-63 39-41 33C-19 28 3 22 16 9Z" fill="url(#otter-fur)"/><path d="M-78 22C-58 36-27 19-9 17" fill="none" stroke="#d7b087" stroke-width="3" stroke-linecap="round" opacity=".6"/><path d="M-62 29C-53 29-44 26-38 24" fill="none" stroke="#8d6546" stroke-width="1.2" opacity=".45"/></g></g>
      <path d="M-26 25Q-42 59-26 76Q-3 89 25 76Q43 54 27 24Z" fill="url(#otter-fur)"/><ellipse cy="49" rx="24" ry="31" fill="url(#otter-cream)"/>
      <g transform="translate(-19 65)"><g data-bone="legL"><path d="M-10-7Q-17 7-11 17H11Q16 3 10-7Z" fill="url(#otter-fur)"/><g transform="translate(0 12)"><g data-bone="kneeL"><path d="M-11-3Q-17 8-18 13Q-14 20 1 18L12 15Q14 7 8 1Z" fill="#9d704c"/><path d="M-12 11-11 16M-5 12-4 17M2 12 3 17" stroke="#74523c" stroke-width="1.1" stroke-linecap="round"/></g></g></g></g>
      <g transform="translate(19 65)"><g data-bone="legR"><path d="M-10-7Q-16 3-11 17H11Q17 7 10-7Z" fill="url(#otter-fur)"/><g transform="translate(0 12)"><g data-bone="kneeR"><path d="M-8 1Q-14 7-12 15L-1 18Q14 20 18 13Q17 8 11-3Z" fill="#9d704c"/><path d="M12 11 11 16M5 12 4 17M-2 12-3 17" stroke="#74523c" stroke-width="1.1" stroke-linecap="round"/></g></g></g></g>
      <path d="M-29-18Q-40 1-38 43L-35 57Q-23 63-11 58L-12 4H12L11 58Q25 63 37 55L39 42Q38 2 28-18Z" fill="url(#otter-jacket)" stroke="#cdb993" stroke-width="1"/>
      <g clip-path="url(#otter-coat-clip)"><g transform="translate(0 20)">${brush(145, 83, 88, '#bd9f77', '.22')}${brush(100, 83, 88, '#fff9e8', '.65')}</g><path d="M-31-5Q-39 22-32 48M31-4Q37 21 32 48" fill="none" stroke="#fff7df" stroke-width="3" opacity=".6"/></g>
      <path d="M-10-12Q0-18 11-12L14 46Q0 57-14 46Z" fill="url(#otter-cream)"/>
      <path d="M-25-17-12-22-5-7-14 10-24-1-19-6ZM25-17 12-22 5-7 14 10 24-1 19-6Z" fill="#fff3d8" stroke="#d6c39f" stroke-width=".9" stroke-linejoin="round"/>
      <path d="M-29 27-16 28-16 42Q-24 47-31 41Z" fill="#ead9b5" stroke="#cdb88e" stroke-width="1"/><path d="M-31 26-15 28" stroke="#fcf0d2" stroke-width="3" stroke-linecap="round"/>
      <path d="M-29 27-27 13-17 15-18 29" fill="#e7ead9" stroke="#a5ad8c" stroke-width=".8"/><path d="M-25 18-21 19M-25 22-22 23" stroke="#9cae8e" stroke-width="1"/>
      <path d="M26 10 29 43" stroke="#ccb58d" stroke-width="1" stroke-dasharray="2.2 2"/><g fill="#cfa668" stroke="#b18c55" stroke-width=".7"><circle cx="22" cy="15" r="2.5"/><circle cx="24" cy="31" r="2.5"/><circle cx="25" cy="47" r="2.5"/></g>
      <g transform="translate(-35 -8)"><g data-bone="armL"><path d="M-1-5Q-13-5-15 9L-12 26 7 26 10 9Q9-3-1-5Z" fill="url(#otter-jacket)" stroke="#cbb68f" stroke-width=".8"/><g transform="translate(-3 21)"><g data-bone="elbowL"><path d="M-10-4H9L10 18Q1 25-11 18Z" fill="url(#otter-jacket)"/><path d="M-12 14Q-1 18 11 14L10 22Q-1 25-12 20Z" fill="#fff2d3" stroke="#d3bd94" stroke-width=".8"/><path d="M-8 22Q-15 30-9 36Q-2 42 7 34L8 24Z" fill="url(#otter-fur)"/><path d="M6 25Q15 19 14 27L8 33" fill="#ac7c54"/><path d="M-8 31-6 35M-2 32-1 36M4 31 4 34" fill="none" stroke="#805c40" stroke-width="1.2" stroke-linecap="round"/></g></g></g></g>
      <g transform="translate(35 -8)"><g data-bone="armR"><path d="M1-5Q13-5 15 9L12 26H-7L-10 9Q-9-3 1-5Z" fill="url(#otter-jacket)" stroke="#cbb68f" stroke-width=".8"/><g transform="translate(3 21)"><g data-bone="elbowR"><path d="M-9-4H10L11 18Q-1 25-10 18Z" fill="url(#otter-jacket)"/><path d="M-11 14Q1 18 12 14V20Q1 25-10 22Z" fill="#fff2d3" stroke="#d3bd94" stroke-width=".8"/><path d="M-8 24-7 34Q2 42 9 36Q15 30 8 22Z" fill="url(#otter-fur)"/><path d="M-6 25Q-15 19-14 27L-8 33" fill="#ac7c54"/><path d="M8 31 6 35M2 32 1 36M-4 31-4 34" fill="none" stroke="#805c40" stroke-width="1.2" stroke-linecap="round"/></g></g></g></g>
      <path d="M27-17-34 52" stroke="#704b30" stroke-width="9" stroke-linecap="round"/><path d="M27-18-34 51" stroke="#ad7a49" stroke-width="6" stroke-linecap="round"/><path d="M26-18-34 51" stroke="#d2a56c" stroke-width=".8" stroke-dasharray="2 2"/>
      <g transform="translate(-35 47) rotate(9)"><rect x="-20" y="-7" width="43" height="37" rx="7" fill="#765034"/><rect x="-19" y="-9" width="39" height="34" rx="6" fill="url(#otter-leather)"/><path d="M-18-8H19L19 2Q2 14-18 3Z" fill="#b88752" stroke="#d3a96d" stroke-width="1.4"/><path d="M-15-4H16M-14 21H16" stroke="#d2a56e" stroke-width=".8" stroke-dasharray="2 2" fill="none"/><path d="M-3 4V17" stroke="#805632" stroke-width="5"/><rect x="-7" y="6" width="10" height="9" rx="1.8" fill="none" stroke="#e3bd76" stroke-width="2.3"/><path d="M-2 9V13" stroke="#ebc684" stroke-width="1.3"/><rect x="19" y="4" width="7" height="19" rx="2" fill="#9c6b3d"/><path d="M20 7H25" stroke="#d0a16a" stroke-width="1"/></g>
      <g transform="translate(0 -64)"><g data-bone="head">
        <g fill="url(#otter-fur)"><circle cx="-48" cy="-35" r="12"/><circle cx="48" cy="-35" r="12"/></g><g fill="#79553d"><ellipse cx="-48" cy="-35" rx="7" ry="8"/><ellipse cx="48" cy="-35" rx="7" ry="8"/></g><path d="M-51-33C-54-68-27-76 0-74C31-76 53-61 53-33L54-14 58-8 53-2 55 5 48 8C41 27 18 34 0 34C-22 34-44 24-49 9L-55 5-53-2-57-7-52-14Z" fill="url(#otter-fur)"/>
        <g clip-path="url(#otter-fur-clip)"><g transform="translate(0 -23)">${brush(260, 113, 110, '#edc69a', '.55')}${brush(180, 113, 110, '#8f6343', '.21')}</g></g>
        <path d="M-49-6C-43-20-21-13 0-5C20-13 44-20 50-6C57 12 34 33 0 33C-30 33-55 15-49-6Z" fill="url(#otter-cream)"/>
        <ellipse cx="-24" cy="8" rx="26" ry="19" fill="url(#otter-cheek)"/><ellipse cx="24" cy="8" rx="26" ry="19" fill="url(#otter-cheek)"/>
        <g fill="none" stroke="#f9edda" stroke-width="1.1" stroke-linecap="round" opacity=".8"><path d="M-46-8-51-5M-45-3-52 0M-43 2-50 5M-42 8-48 12M-37 17-42 21M-28 24-32 28M46-8 51-5M45-3 52 0M43 2 50 5M42 8 48 12M37 17 42 21M28 24 32 28"/></g>
        <path d="M-48-10-46-3-50 0M49-10 46-3 50 0M-29 25-25 27M25 27 29 25" fill="none" stroke="#ead5b3" stroke-width="1.1" stroke-linecap="round"/>
        <ellipse cx="-33" cy="4" rx="13" ry="8" fill="url(#otter-blush)"/><ellipse cx="33" cy="4" rx="13" ry="8" fill="url(#otter-blush)"/>
        <g data-bone="eyes"><ellipse cx="-23" cy="-21" rx="6" ry="7.2" fill="url(#otter-eye)"/><ellipse cx="23" cy="-21" rx="6" ry="7.2" fill="url(#otter-eye)"/><ellipse cx="-24.8" cy="-23.8" rx="1.8" ry="2" fill="#fff7e9"/><ellipse cx="21.2" cy="-23.8" rx="1.8" ry="2" fill="#fff7e9"/><circle cx="-20.5" cy="-18.2" r=".9" fill="#bc9571"/><circle cx="25.5" cy="-18.2" r=".9" fill="#bc9571"/></g>
        <path data-bone="brows" d="M-28-34Q-22-37-16-34M16-34Q22-37 28-34" fill="none" stroke="#8c6244" stroke-width="2.1" stroke-linecap="round"/>
        <path d="M-8-7Q0-12 8-7L5-1 0 2-5-1Z" fill="#4c3326"/><ellipse cx="-2" cy="-7" rx="2.5" ry="1" fill="#8d6950"/><path d="M0 1V7" stroke="#75513a" stroke-width="1.6" stroke-linecap="round"/>
        <path data-bone="smile" d="M-9 9Q-5 15 0 10Q5 15 9 9" fill="none" stroke="#75513a" stroke-width="1.7" stroke-linecap="round"/><ellipse data-bone="mouth" cy="13" rx="6.5" ry="5.5" fill="#784d39" transform="translate(0 13) scale(1 0) translate(0 -13)"/>
        <g fill="none" stroke="#936d4e" stroke-width="1.05" stroke-linecap="round" opacity=".75"><path d="M-28 1Q-46-4-65 0M-29 7Q-48 5-67 10M-28 12Q-47 14-60 22M28 1Q46-4 65 0M29 7Q48 5 67 10M28 12Q47 14 60 22"/></g>
        <g transform="rotate(-7 0 -65)">
          <path d="M-49-59Q-51-99-13-106Q31-114 48-79L49-60Z" fill="url(#otter-hat)" stroke="#d3b684" stroke-width="1.1"/><path d="M-43-77Q-24-98 2-99M11-100Q27-97 35-86" fill="none" stroke="#fff0ce" stroke-width="2.2" stroke-linecap="round"/><path d="M-5-104Q-16-90-13-73M20-104Q31-91 33-73" fill="none" stroke="#cfb184" stroke-width=".8" stroke-dasharray="1.4 2"/><path d="M-40-78Q-27-88-16-91M23-92 33-82" stroke="#d4b88c" stroke-width="1.7" stroke-linecap="round" fill="none" opacity=".4"/>
          <path d="M-49-68Q-2-78 49-64L50-56Q-4-66-49-59Z" fill="#9f774d"/><path d="M-48-66Q0-75 48-62" fill="none" stroke="#bc976a" stroke-width="1"/>
          <path d="M-49-65C-65-62-78-52-75-43C-70-31-43-32-17-38C12-44 39-48 67-43C82-41 83-47 73-55C55-73-15-80-49-65Z" fill="url(#otter-hat)" stroke="#d8bc8b" stroke-width="1.3"/>
          <path d="M-73-43Q-52-35-18-43Q27-56 71-46" fill="none" stroke="#f9e7be" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M-35-89 35-86" stroke="#85613f" stroke-width="6" stroke-linecap="round"/>
          <g transform="rotate(-7 -20 -90)"><rect x="-36" y="-102" width="29" height="24" rx="10" fill="#876442"/><rect x="-35" y="-104" width="29" height="24" rx="10" fill="#d7b278" stroke="#edcf95" stroke-width="1.5"/><rect x="-31" y="-100" width="21" height="16" rx="6.5" fill="url(#otter-glass)"/><path d="M-28-89-18-98M-23-86-13-95" stroke="#d7e4d6" stroke-width="2" opacity=".65" stroke-linecap="round"/></g>
          <g transform="rotate(8 22 -91)"><rect x="7" y="-103" width="29" height="24" rx="10" fill="#876442"/><rect x="6" y="-105" width="29" height="24" rx="10" fill="#d7b278" stroke="#edcf95" stroke-width="1.5"/><rect x="10" y="-101" width="21" height="16" rx="6.5" fill="url(#otter-glass)"/><path d="M13-90 23-99M18-87 28-96" stroke="#d7e4d6" stroke-width="2" opacity=".65" stroke-linecap="round"/></g>
          <path d="M-7-92Q0-97 7-93" fill="none" stroke="#b9915f" stroke-width="4"/><circle cx="-42" cy="-80" r="2" fill="#d9b273"/><circle cx="42" cy="-77" r="2" fill="#d9b273"/>
        </g>
      </g></g>
      <g transform="translate(0 -26)">
        <path d="M-27-5Q-34 0-44 13L-67 25-62 38-34 24Q-19 17-12 5Z" fill="url(#otter-sage)"/><path d="M-58 26-53 35M-51 22-46 31" stroke="#c0c6a0" stroke-width="1.2"/><path d="M-63 35-68 41M-59 37-63 43M-55 35-58 41" stroke="#8e9b73" stroke-width="2" stroke-linecap="round"/>
        <path d="M-32-7Q-25-15-15-7Q3 2 27-13L33-3Q36 9 18 15Q-8 21-31 8Z" fill="url(#otter-sage)" stroke="#7e8c67" stroke-width="1"/>
        <path d="M-28 0Q-7 13 24-1" fill="none" stroke="#bdc49c" stroke-width="3" stroke-linecap="round"/><path d="M13 10 23 6 21 32 12 38 10 30Z" fill="#87966d"/><path d="M13 29 20 28M13 33 19 32" stroke="#b2bc91" stroke-width="1.2"/><path d="M13 36 12 41M17 34 17 40M21 32 22 37" stroke="#7c8c62" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M-28-3Q-7 8 24-6M-26 5Q-7 15 22 3M-43 20-55 28M-37 16-49 24M-31 13-43 21" fill="none" stroke="#d0d2ac" stroke-width=".75" stroke-dasharray="1.3 1.5" opacity=".7"/>
      </g>
      <path d="M-32 1-34 19M32 2 35 22M-32 52-23 54M29 54 33 52" stroke="#fff4d9" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".7"/>
    </g></g>
  </svg>`;
}

export function createOtter2D(host) {
  return createSvgRig2D(host, { markup: otterRigMarkup(), id: 'otter-2d', name: '沐沐', eyeY: -21, mouthY: 13, waveAngle: 145 });
}

/** Pure scene construction also supports geometry checks without a GPU or DOM. */
export function buildOtterRig() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x7e8c78, 2.35));
  for (const [color, intensity, x, y, z] of [[0xffe6c6, 3.1, -3, 5, 5], [0xddebe4, 1.25, 4, 3, 3], [0xffecd1, 2.5, 2, 4, -3]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, y, z); scene.add(light);
  }

  // A tiny deterministic fabric grain is generated in memory, never downloaded.
  const grainBytes = new Uint8Array(64 * 64 * 4);
  let seed = 87213;
  for (let i = 0; i < grainBytes.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = 228 + (seed >>> 27); grainBytes[i] = grainBytes[i + 1] = grainBytes[i + 2] = Math.min(255, value); grainBytes[i + 3] = 255;
  }
  const grain = new THREE.DataTexture(grainBytes, 64, 64, THREE.RGBAFormat);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(3, 3);
  grain.magFilter = grain.minFilter = THREE.LinearFilter; grain.needsUpdate = true;
  const colors = { fur: 0xbe9168, furDark: 0x956b4a, ear: 0x755039, cream: 0xf7e9cf, jacket: 0xf0dfba, seam: 0xd0b88c, hat: 0xe8cfa0, hatLight: 0xf5e2b9, sage: 0x919e76, sageLight: 0xb9c29a, sageDark: 0x72845e, leather: 0xa57445, leatherDark: 0x755035, leatherLight: 0xc49a64, gold: 0xd3ab65, dark: 0x302018, nose: 0x4d3328, pink: 0xcf9b82, tongue: 0xdfa08a, glass: 0x8fa79a, white: 0xfffbec };
  const mats = Object.fromEntries(Object.entries(colors).map(([key, color]) => [key, new THREE.MeshStandardMaterial({ color, roughness: ['glass', 'dark', 'nose'].includes(key) ? .23 : key === 'gold' ? .42 : .87, metalness: key === 'gold' ? .28 : 0 })]));
  for (const key of ['fur', 'furDark', 'cream', 'jacket', 'hat', 'hatLight', 'sage', 'sageLight', 'sageDark']) { mats[key].bumpMap = grain; mats[key].bumpScale = ['fur', 'furDark', 'cream'].includes(key) ? .007 : .004; mats[key].roughnessMap = grain; }
  mats.furTufts = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
  // A second tiny texture adds broad dye variation and a woven cross-grain.
  // It is shared by clothes and generated only while constructing the rig.
  const fabricBytes = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const dye = Math.sin(x * .13 + Math.sin(y * .17)) * 3 + Math.cos(y * .16 + x * .05) * 3;
    const weave = (x % 3 === 0 ? -5 : 0) + (y % 3 === 0 ? -3 : 0);
    const value = Math.max(218, Math.min(255, 246 + dye + weave + (seed >>> 29)));
    const i = (y * 128 + x) * 4; fabricBytes[i] = fabricBytes[i + 1] = fabricBytes[i + 2] = value; fabricBytes[i + 3] = 255;
  }
  const fabric = new THREE.DataTexture(fabricBytes, 128, 128, THREE.RGBAFormat);
  fabric.wrapS = fabric.wrapT = THREE.RepeatWrapping; fabric.repeat.set(2, 2); fabric.colorSpace = THREE.SRGBColorSpace;
  fabric.magFilter = fabric.minFilter = THREE.LinearFilter; fabric.needsUpdate = true;
  for (const key of ['jacket', 'hat', 'hatLight', 'sage', 'sageLight', 'sageDark']) mats[key].map = fabric;
  mats.white.roughness = .25;
  const geometries = new Set();
  const geometry = item => { geometries.add(item); return item; };
  const sphere = geometry(new THREE.SphereGeometry(1, 28, 20));
  const detailSphere = geometry(new THREE.SphereGeometry(1, 16, 12));
  const root = new THREE.Group(); root.position.y = 1.25; scene.add(root);
  const joint = (parent, x, y, z) => { const item = new THREE.Group(); item.position.set(x, y, z); parent.add(item); return item; };
  const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => { const item = new THREE.Mesh(geo, typeof mat === 'string' ? mats[mat] : mat); item.position.set(x, y, z); parent.add(item); return item; };
  const ell = (parent, mat, x, y, z, sx, sy, sz, fine = false) => { const item = mesh(parent, fine ? detailSphere : sphere, mat, x, y, z); item.scale.set(sx, sy, sz); return item; };
  const tube = (parent, mat, points, radius = .008, segments = 16) => mesh(parent, geometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))), segments, radius, 5, false)), mat);
  const lathe = (parent, mat, points, x = 0, y = 0, z = 0, start = 0, length = Math.PI * 2) => mesh(parent, geometry(new THREE.LatheGeometry(points.map(point => new THREE.Vector2(...point)), 40, start, length)), mat, x, y, z);
  const shapeMesh = (parent, mat, points, depth, bevel, x, y, z) => {
    const shape = new THREE.Shape(); points.forEach(([px, py], i) => i ? shape.lineTo(px, py) : shape.moveTo(px, py)); shape.closePath();
    return mesh(parent, geometry(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, steps: 1, curveSegments: 12 })), mat, x, y, z);
  };
  const furTufts = (parent, center, radius, count, length, color, accept = () => true) => {
    const positions = [], normals = [], shades = [];
    const baseColor = new THREE.Color(color), vertexColor = new THREE.Color();
    const normal = new THREE.Vector3(), base = new THREE.Vector3(), tip = new THREE.Vector3(), side = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), sideways = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < count; i++) {
      const y = 1 - 2 * (i + .5) / count, radial = Math.sqrt(1 - y * y), angle = i * 2.399963229728653;
      const x = Math.cos(angle) * radial, z = Math.sin(angle) * radial;
      if (!accept(x, y, z)) continue;
      normal.set(x / radius[0], y / radius[1], z / radius[2]).normalize();
      base.set(center[0] + x * radius[0], center[1] + y * radius[1], center[2] + z * radius[2]).addScaledVector(normal, -.001);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const strandLength = length * (.6 + (seed >>> 25) / 127 * .8);
      tip.copy(base).addScaledVector(normal, strandLength).addScaledVector(up, -strandLength * .25);
      side.crossVectors(normal, Math.abs(normal.y) > .95 ? sideways : up).normalize().multiplyScalar(strandLength * .15);
      vertexColor.copy(baseColor).multiplyScalar(.91 + (seed >>> 27) / 31 * .18);
      for (let ribbon = 0; ribbon < 2; ribbon++) {
        if (ribbon) side.crossVectors(normal, side).normalize().multiplyScalar(strandLength * .13);
        for (const point of [base.clone().add(side), base.clone().sub(side), tip]) {
          positions.push(point.x, point.y, point.z); normals.push(normal.x, normal.y, normal.z); shades.push(vertexColor.r, vertexColor.g, vertexColor.b);
        }
      }
    }
    const tufts = geometry(new THREE.BufferGeometry());
    tufts.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    tufts.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    tufts.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
    return mesh(parent, tufts, 'furTufts');
  };

  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x584b37, transparent: true, opacity: .12, depthWrite: false });
  const shadow = mesh(scene, geometry(new THREE.CircleGeometry(1, 48)), shadowMaterial, 0, .08, 0); shadow.rotation.x = -Math.PI / 2; shadow.scale.set(.52, .31, 1);
  const body = lathe(root, 'fur', [[0, -.73], [.21, -.73], [.34, -.65], [.415, -.47], [.43, -.27], [.39, .02], [.30, .27], [.15, .35], [0, .35]]); body.scale.z = .77;
  ell(root, 'cream', 0, -.28, .282, .286, .435, .075);
  const coat = lathe(root, 'jacket', [[.19, .35], [.30, .30], [.36, .18], [.425, -.07], [.448, -.30], [.427, -.49], [.38, -.52]].reverse(), 0, 0, 0, .38, Math.PI * 2 - .76); coat.scale.z = .79;
  // A narrow return edge gives the open garment visible thickness from the side.
  for (const s of [-1, 1]) {
    tube(root, 'seam', [[s * .073, .345, .15], [s * .123, .22, .27], [s * .155, -.07, .315], [s * .165, -.31, .328], [s * .145, -.51, .30]], .012, 22);
    const collar = shapeMesh(root, 'cream', [[s * .08, .31], [s * .25, .27], [s * .31, .13], [s * .215, .08], [s * .145, -.035], [s * .08, .16]], .035, .014, 0, 0, .278);
    collar.rotation.y = s * .12;
    tube(root, 'cream', [[s * .19, -.495, .292], [s * .29, -.50, .245], [s * .36, -.48, .195]], .011);
  }
  for (const y of [.08, -.13, -.34]) { ell(root, 'gold', .212, y, .319, .027, .027, .012, true); ell(root, 'seam', .212, y, .332, .006, .01, .003, true); }
  const pocket = shapeMesh(root, 'jacket', [[-.34, -.11], [-.19, -.12], [-.19, -.29], [-.26, -.33], [-.34, -.29]], .018, .011, 0, 0, .268);
  pocket.rotation.y = -.16;
  tube(root, 'seam', [[-.341, -.12, .292], [-.27, -.13, .303], [-.19, -.13, .305]], .009);
  const map = shapeMesh(root, 'sageLight', [[-.325, -.12], [-.315, .035], [-.205, .014], [-.21, -.13]], .006, .003, 0, 0, .273);
  map.rotation.y = -.13;
  tube(root, 'sageDark', [[-.305, .005, .285], [-.28, -.04, .294], [-.24, -.025, .3], [-.22, -.08, .3]], .004);

  const legs = [], knees = [], ankles = [];
  for (const s of [-1, 1]) {
    const leg = joint(root, s * .235, -.53, .015); legs.push(leg);
    ell(leg, 'fur', 0, -.115, 0, .14, .21, .135);
    const knee = joint(leg, 0, -.18, 0); knees.push(knee);
    const ankle = joint(knee, 0, -.18, 0); ankles.push(ankle);
    ell(ankle, 'furDark', 0, 0, .085, .155, .105, .235);
    for (const x of [-.065, 0, .065]) tube(ankle, 'ear', [[x, .024, .271], [x, 0, .289], [x + .004, -.025, .274]], .004, 8);
  }
  const armL = joint(root, -.375, .21, .02), armR = joint(root, .375, .21, .02), elbows = [];
  const cuffGeometry = geometry(new THREE.TorusGeometry(.112, .024, 8, 24));
  for (const [index, arm] of [armL, armR].entries()) {
    const s = index ? 1 : -1;
    ell(arm, 'jacket', 0, -.13, 0, .145, .23, .15);
    const elbow = joint(arm, 0, -.265, .015); elbows.push(elbow);
    ell(elbow, 'jacket', 0, -.085, 0, .122, .155, .125);
    const cuff = mesh(elbow, cuffGeometry, 'cream', 0, -.182, 0); cuff.rotation.x = Math.PI / 2;
    for (const x of [-.07, 0, .07]) tube(elbow, 'seam', [[x, -.205, .09], [x + s * .012, -.183, .123], [x - s * .008, -.162, .101]], .005, 8);
    ell(elbow, 'fur', 0, -.287, .005, .115, .14, .084);
    ell(elbow, 'fur', -s * .098, -.258, .035, .055, .078, .055, true);
    for (const x of [-.047, 0, .047]) tube(elbow, 'furDark', [[x, -.326, .075], [x, -.355, .069]], .004, 6);
    tube(arm, 'seam', [[s * .1, -.03, .095], [s * .125, -.14, .08]], .005, 8);
  }

  // A flattened tapered tail remains a volume when the character turns around.
  const tail = joint(root, 0, -.43, -.15);
  const tailCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -.1), new THREE.Vector3(-.19, -.19, -.33), new THREE.Vector3(-.50, -.36, -.50), new THREE.Vector3(-.83, -.34, -.53), new THREE.Vector3(-.94, -.30, -.49)]);
  const tailPositions = [], tailIndices = [];
  const tailRings = 30, tailSides = 12;
  for (let ring = 0; ring <= tailRings; ring++) {
    const u = ring / tailRings, center = tailCurve.getPointAt(u), tangent = tailCurve.getTangentAt(u);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const tip = Math.pow(Math.sin(Math.PI * (.1 + u * .9)), .65);
    const width = (.19 - u * .07) * tip, thickness = (.09 - u * .045) * tip;
    for (let side = 0; side <= tailSides; side++) {
      const angle = side / tailSides * Math.PI * 2;
      tailPositions.push(center.x + normal.x * Math.cos(angle) * width, center.y + Math.sin(angle) * thickness, center.z + normal.z * Math.cos(angle) * width);
      if (ring < tailRings && side < tailSides) { const a = ring * (tailSides + 1) + side, b = a + tailSides + 1; tailIndices.push(a, b, a + 1, b, b + 1, a + 1); }
    }
  }
  const tailGeo = geometry(new THREE.BufferGeometry()); tailGeo.setAttribute('position', new THREE.Float32BufferAttribute(tailPositions, 3)); tailGeo.setIndex(tailIndices); tailGeo.computeVertexNormals(); mesh(tail, tailGeo, 'fur');
  tube(tail, 'furDark', [[-.22, -.105, -.30], [-.50, -.28, -.50], [-.78, -.287, -.52]], .004, 20);

  // The scarf is a folded collar and two beveled cloth shapes, rather than rings.
  const scarfCollar = lathe(root, 'sage', [[.22, .295], [.32, .30], [.37, .37], [.345, .445], [.25, .48], [.22, .45], [.22, .295]], 0, 0, .015); scarfCollar.scale.z = .78; scarfCollar.rotation.z = -.07;
  tube(root, 'sageLight', [[-.28, .365, .18], [-.12, .325, .30], [.08, .34, .31], [.29, .4, .19]], .019, 22);
  const scarfTail = joint(root, -.24, .335, .02);
  const scarfEnd = shapeMesh(scarfTail, 'sage', [[0, .04], [-.15, -.04], [-.37, -.15], [-.49, -.12], [-.52, -.25], [-.39, -.29], [-.16, -.17], [.04, -.07]], .035, .017, 0, 0, 0);
  scarfEnd.rotation.y = -.2;
  for (let i = 0; i < 4; i++) tube(scarfTail, 'sageDark', [[-.49 + i * .025, -.205 - i * .017, .015], [-.54 + i * .025, -.25 - i * .017, .015]], .007, 6);
  shapeMesh(root, 'sageDark', [[.16, .35], [.285, .36], [.245, .05], [.16, .015], [.135, .07]], .018, .012, 0, 0, .28);
  for (let i = 0; i < 3; i++) tube(root, 'sageLight', [[.16 + i * .032, .035, .304], [.155 + i * .034, -.015, .303]], .005, 6);

  // The satchel has an extruded silhouette, a raised flap, stitching and a buckle.
  tube(root, 'leatherDark', [[.285, .26, .22], [.12, .035, .365], [-.10, -.22, .39], [-.34, -.49, .29]], .035, 24);
  tube(root, 'leatherLight', [[.285, .26, .242], [.12, .035, .392], [-.10, -.22, .416], [-.34, -.49, .315]], .009, 24);
  tube(root, 'leather', [[.28, .28, .13], [.25, .12, -.29], [-.02, -.18, -.36], [-.32, -.48, -.16]], .03, 24);
  const bag = joint(root, -.365, -.36, .305); bag.rotation.z = -.08; bag.rotation.y = -.13;
  shapeMesh(bag, 'leather', [[-.22, .15], [.21, .15], [.225, -.17], [.17, -.215], [-.17, -.215], [-.225, -.16]], .11, .035, 0, 0, 0);
  shapeMesh(bag, 'leatherLight', [[-.225, .16], [.215, .16], [.22, .015], [.08, -.045], [-.09, -.05], [-.225, .01]], .02, .017, 0, 0, .14);
  tube(bag, 'gold', [[-.205, .015, .178], [-.08, -.032, .182], [.075, -.026, .182], [.20, .02, .178]], .006, 20);
  shapeMesh(bag, 'leatherDark', [[-.035, .025], [.035, .025], [.035, -.16], [-.035, -.16]], .008, .004, 0, 0, .169);
  const buckleShape = new THREE.Shape(); buckleShape.moveTo(-.044, -.047); buckleShape.lineTo(.044, -.047); buckleShape.lineTo(.044, .047); buckleShape.lineTo(-.044, .047); buckleShape.closePath();
  const buckleHole = new THREE.Path(); buckleHole.moveTo(-.025, -.028); buckleHole.lineTo(-.025, .028); buckleHole.lineTo(.025, .028); buckleHole.lineTo(.025, -.028); buckleHole.closePath(); buckleShape.holes.push(buckleHole);
  mesh(bag, geometry(new THREE.ExtrudeGeometry(buckleShape, { depth: .008, bevelEnabled: true, bevelSize: .005, bevelThickness: .005, bevelSegments: 2 })), 'gold', 0, -.07, .187);
  tube(bag, 'gold', [[0, -.055, .205], [0, -.09, .205]], .005, 6);
  for (let i = 0; i < 7; i++) {
    tube(bag, 'leatherLight', [[-.177 + i * .052, -.186, .144], [-.153 + i * .052, -.186, .144]], .003, 4);
    tube(bag, 'leatherLight', [[-.176 + i * .052, .126, .179], [-.152 + i * .052, .126, .179]], .003, 4);
  }

  const head = joint(root, 0, .83, .025);
  const headGeometry = geometry(new THREE.SphereGeometry(1, 40, 28));
  const vertices = headGeometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i), taper = y < -.3 ? 1 + (y + .3) * .19 : 1;
    vertices.setXYZ(i, vertices.getX(i) * .65 * taper, y * .56, vertices.getZ(i) * .465);
  }
  headGeometry.computeVertexNormals(); mesh(head, headGeometry, 'fur');
  furTufts(head, [0, 0, 0], [.648, .558, .465], 1050, .021, colors.fur, (x, y, z) => y < .84 && !(z > .38 && y < -.06));
  for (const s of [-1, 1]) {
    ell(head, 'fur', s * .575, .26, -.005, .13, .145, .105);
    ell(head, 'ear', s * .594, .268, .081, .076, .089, .027);
    ell(head, 'furDark', s * .625, .32, .07, .028, .043, .023, true);
    furTufts(head, [s * .575, .26, -.005], [.13, .145, .105], 95, .012, colors.fur, (x, y, z) => z < .4);
  }
  // One curved cream surface hugs the lower face, so there is no muzzle seam.
  const faceOutline = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -.055, 0), new THREE.Vector3(.19, -.035, 0), new THREE.Vector3(.39, -.045, 0), new THREE.Vector3(.54, -.16, 0), new THREE.Vector3(.51, -.30, 0), new THREE.Vector3(.32, -.455, 0), new THREE.Vector3(0, -.50, 0), new THREE.Vector3(-.32, -.455, 0), new THREE.Vector3(-.51, -.30, 0), new THREE.Vector3(-.54, -.16, 0), new THREE.Vector3(-.39, -.045, 0), new THREE.Vector3(-.19, -.035, 0),
  ], true, 'catmullrom', .35);
  const facePositions = [], faceIndices = [], faceRings = 12, faceSides = 64;
  for (let ring = 0; ring <= faceRings; ring++) {
    const t = ring / faceRings;
    for (let side = 0; side <= faceSides; side++) {
      const boundary = faceOutline.getPoint(side / faceSides);
      const x = boundary.x * t, y = -.245 + (boundary.y + .245) * t;
      const z = .465 * Math.sqrt(Math.max(.02, 1 - x * x / (.65 * .65) - y * y / (.56 * .56))) + .014;
      facePositions.push(x, y, z);
      if (ring < faceRings && side < faceSides) { const a = ring * (faceSides + 1) + side, b = a + faceSides + 1; faceIndices.push(a, a + 1, b, b, a + 1, b + 1); }
    }
  }
  const faceGeometry = geometry(new THREE.BufferGeometry()); faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(facePositions, 3)); faceGeometry.setIndex(faceIndices); faceGeometry.computeVertexNormals(); mesh(head, faceGeometry, 'cream');
  // Small overlapping cheek volumes soften the formerly flat painted muzzle.
  for (const s of [-1, 1]) {
    ell(head, 'cream', s * .235, -.205, .353, .249, .163, .112, true);
    furTufts(head, [s * .235, -.205, .353], [.249, .163, .112], 155, .014, colors.cream, (x, y, z) => z > -.1 && y < .65);
  }
  const eyes = [], brows = [];
  for (const s of [-1, 1]) {
    const eye = joint(head, s * .245, .045, .433); eyes.push(eye);
    ell(eye, 'dark', 0, 0, 0, .064, .078, .039, true);
    ell(eye, 'white', -.018, .028, .034, .018, .022, .008, true);
    ell(eye, 'leatherLight', .02, -.026, .027, .006, .008, .004, true);
    const brow = joint(head, s * .244, .197, .411); brows.push(brow);
    tube(brow, 'furDark', [[-.058, 0, -.008], [0, .015, .006], [.058, .002, -.006]], .01, 12);
    const blush = ell(head, 'pink', s * .375, -.195, .438, .07, .022, .004, true); blush.rotation.y = s * .4;
    for (const [dy, endY] of [[-.13, -.115], [-.185, -.21], [-.24, -.315]]) tube(head, 'furDark', [[s * .32, dy, .474], [s * .51, dy + .008, .365], [s * .73, endY, .325]], .0045, 14);
  }
  const nose = shapeMesh(head, 'nose', [[-.075, .022], [-.035, .045], [.035, .045], [.075, .022], [.041, -.021], [0, -.04], [-.041, -.021]], .025, .012, 0, -.095, .467);
  ell(nose, 'leatherLight', -.022, .025, .039, .022, .006, .003, true);
  tube(head, 'nose', [[0, -.13, .489], [0, -.183, .472]], .008, 8);
  const smile = joint(head, 0, -.225, .45);
  tube(smile, 'nose', [[-.102, .025, -.008], [-.053, -.019, .008], [0, .006, .014], [.053, -.019, .008], [.102, .025, -.008]], .008, 24);
  const attentiveMouth = joint(head, 0, -.225, .45);
  tube(attentiveMouth, 'nose', [[-.095, .009, -.006], [-.047, -.003, .012], [0, -.007, .017], [.047, -.003, .012], [.095, .009, -.006]], .007, 22);
  attentiveMouth.visible = false;
  const mouth = joint(head, 0, -.235, .451);
  ell(mouth, 'nose', 0, 0, 0, .072, .06, .018, true);
  ell(mouth, 'tongue', 0, -.028, .015, .042, .022, .007, true);

  const hat = joint(head, 0, 0, -.015); hat.rotation.z = -.08;
  const crown = lathe(hat, 'hat', [[0, .84], [.19, .835], [.36, .79], [.48, .70], [.535, .57], [.55, .46], [.52, .44]].reverse()); crown.scale.z = .82;
  const hatBand = lathe(hat, 'leather', [[.55, .485], [.557, .515], [.548, .558]], 0, 0, 0); hatBand.scale.z = .82;
  const brim = lathe(hat, 'hatLight', [[.515, .46], [.61, .445], [.73, .412], [.79, .397], [.80, .37], [.78, .358], [.7, .375], [.59, .413], [.515, .43]].reverse()); brim.scale.z = .76;
  const hatEdge = lathe(hat, 'hat', [[.783, .365], [.801, .375], [.798, .391]], 0, 0, 0); hatEdge.scale.z = .76;
  tube(hat, 'seam', [[0, .84, 0], [0, .806, .19], [0, .71, .325], [0, .57, .425]], .006, 20);
  for (const s of [-1, 1]) tube(hat, 'hatLight', [[s * .23, .805, .11], [s * .33, .73, .23], [s * .39, .61, .29]], .007, 18);
  for (const s of [-1, 1]) {
    ell(hat, 'gold', s * .49, .57, .2, .022, .022, .012, true);
    const goggles = joint(hat, s * .205, .661, .387); goggles.rotation.z = s * -.12; goggles.rotation.y = s * .13;
    const goggleRim = geometry(new THREE.TorusGeometry(.116, .023, 8, 28)); const rim = mesh(goggles, goggleRim, 'gold'); rim.scale.y = .82;
    ell(goggles, 'leatherDark', 0, 0, -.018, .135, .112, .035);
    ell(goggles, 'glass', 0, 0, .006, .103, .083, .025);
    tube(goggles, 'sageLight', [[-.065, -.02, .025], [-.015, .045, .035], [.01, .06, .03]], .009, 8);
    tube(goggles, 'white', [[.022, -.04, .031], [.06, .008, .03]], .005, 8);
  }
  tube(hat, 'leatherDark', [[-.31, .66, .365], [-.49, .635, .245], [-.55, .61, .03], [-.42, .605, -.28], [0, .61, -.455], [.42, .605, -.28], [.55, .61, .03], [.49, .635, .245], [.31, .66, .365]], .025, 40);
  tube(hat, 'gold', [[-.085, .666, .403], [0, .686, .421], [.085, .666, .403]], .015, 12);

  let disposed = false;
  return {
    root, scene, joints: { head, armL, armR, elbowL: elbows[0], elbowR: elbows[1], legL: legs[0], legR: legs[1], kneeL: knees[0], kneeR: knees[1], ankleL: ankles[0], ankleR: ankles[1], tail, scarfTail, bag, eyes, brows, mouth, smile },
    capabilities: originalAvatarCapabilities,
    metadata: { id: 'otter-3d', name: '沐沐', renderer: 'original-three-joints', reference: 'design/digit-hum-1.jpg', capabilities: originalAvatarCapabilities },
    draw({ time = 0, action = 'idle', walk = false, wave = false, point = false, turn = 0, emotion = 'neutral', talk = false, listen = false } = {}) {
      if (disposed) return;
      walk = walk || action === 'walk'; wave = wave || action === 'wave'; point = point || action === 'point';
      if (action === 'turn' && turn === 0) turn = time * .8;
      const stride = Math.sin(time * 8), bounce = walk ? Math.abs(stride) * .034 : Math.sin(time * 2) * .012;
      root.rotation.y = turn; root.rotation.z = walk ? stride * .025 : 0; root.position.y = 1.25 + bounce;
      applyBipedGait(sampleBipedGait(time, { walking: walk, hipHalfWidth: .235, upperLength: .18, lowerLength: .18, stepLength: .045, stepHeight: .022 }), legs, knees, ankles);
      armL.rotation.z = wave ? -2.24 + Math.sin(time * 6) * .12 : -.16;
      armL.rotation.x = wave ? -.12 : walk ? -stride * .35 : .03;
      armR.rotation.z = point ? 1.32 : .16; armR.rotation.x = point ? -.15 : walk ? stride * .35 : .03;
      elbows[0].rotation.z = wave ? -.40 + Math.sin(time * 7) * .24 : -.10; elbows[1].rotation.z = point ? .13 : .10;
      head.rotation.z = listen ? .135 : emotion === 'curious' ? -.12 : emotion === 'concerned' ? -.055 : Math.sin(time * .9) * .025;
      head.rotation.y = listen ? -.035 : Math.sin(time * .65) * .045;
      const blink = time % 4.8 < .12 ? .08 : emotion === 'happy' ? .72 : emotion === 'concerned' ? .86 : 1;
      eyes.forEach(eye => { eye.scale.y = blink; });
      brows.forEach((brow, i) => { brow.rotation.z = emotion === 'concerned' ? (i ? -.14 : .14) : emotion === 'curious' ? (i ? -.16 : .12) : 0; brow.position.y = emotion === 'concerned' ? .205 : emotion === 'curious' ? (i ? .21 : .245) : .197; });
      mouth.visible = Boolean(talk || emotion === 'curious'); mouth.scale.y = talk ? .5 + Math.abs(Math.sin(time * 13)) * .8 : .85;
      smile.visible = !mouth.visible && emotion !== 'concerned'; smile.scale.y = emotion === 'happy' ? 1.3 : 1;
      attentiveMouth.visible = !mouth.visible && emotion === 'concerned';
      tail.rotation.y = Math.sin(time * (walk ? 7 : 2)) * (emotion === 'happy' ? .18 : walk ? .12 : .055);
      tail.rotation.z = walk ? stride * .04 : 0; scarfTail.rotation.z = Math.sin(time * (walk ? 7 : 2)) * (walk ? .08 : .022);
      bag.rotation.z = -.08 + Math.sin(time * (walk ? 8 : 2)) * (walk ? .04 : .012);
      shadow.scale.x = .52 - bounce * .8; shadowMaterial.opacity = .12 - bounce * .4;
    },
    dispose() {
      if (disposed) return; disposed = true;
      geometries.forEach(item => item.dispose()); Object.values(mats).forEach(item => item.dispose());
      shadowMaterial.dispose(); grain.dispose(); fabric.dispose();
    },
  };
}

/** Real articulated geometry, rendered locally with a bounded pixel density. */
export function createOtter3D(canvas) {
  const rig = buildOtterRig();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5)); renderer.setSize(300, 400, false);
    renderer.setClearColor(0x000000, 0); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12; renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (error) { rig.dispose(); renderer?.dispose(); throw error; }
  const camera = new THREE.OrthographicCamera(-1.38, 1.38, 1.84, -1.84, .1, 20);
  camera.position.set(0, 1.58, 7); camera.lookAt(0, 1.52, 0);
  let disposed = false;
  return {
    capabilities: rig.capabilities, metadata: rig.metadata,
    draw(parameters = {}) { if (disposed) return; rig.draw(parameters); renderer.render(rig.scene, camera); },
    dispose() { if (disposed) return; disposed = true; rig.dispose(); renderer.dispose(); },
  };
}

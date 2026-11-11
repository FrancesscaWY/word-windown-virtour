import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { createSvgRig2D, originalAvatarCapabilities } from './explorer-avatar.js';
import { sampleBipedGait, applyBipedGait } from './avatar-gait.js';

// Original, local artwork inspired by the supplied felt dandelion traveller.
// Both renderers use real articulated parts. Neither loads an image or a model.
function randomSequence(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

function svgFibres(cx, cy, rx, ry, count, seed, color = '#fffaf0', opacity = .7) {
  const random = randomSequence(seed), paths = ['', '', ''];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
    const x = cx + Math.cos(angle) * rx * radius, y = cy + Math.sin(angle) * ry * radius;
    // Short overlapping, irregular curls read as needle felt rather than a
    // smooth cloud. All fibres are fixed artwork, so expressions never shimmer.
    const width = 1.2 + random() * 2.1, height = 1.4 + random() * 3.4;
    const tilt = (random() - .5) * 1.66, shade = random();
    const position = (u, v) => `${(x + Math.cos(tilt) * u * width - Math.sin(tilt) * v * height).toFixed(2)} ${(y + Math.sin(tilt) * u * width + Math.cos(tilt) * v * height).toFixed(2)}`;
    paths[shade < .17 ? 1 : shade > .72 ? 2 : 0] += `M${position(0, 0)}C${position(-1, -1)} ${position(1, -1.25)} ${position(.8, -.2)}C${position(.6, .85)} ${position(-.7, .7)} ${position(.2, .8)}C${position(1.1, .9)} ${position(1.6, .6)} ${position(1.2, 1.4)}`;
  }
  // Batch the curly linework into three paths instead of hundreds of SVG DOM
  // nodes. More visible wool detail does not add per-frame joint work.
  return `<g fill="none" stroke="${color}" stroke-width=".38" stroke-linecap="round" opacity="${opacity}"><path d="${paths[0]}"/><path d="${paths[1]}" stroke="#d8bc90" opacity=".42"/><path d="${paths[2]}" stroke="#fffef8"/></g>`;
}

function svgFluffHalo() {
  const random = randomSequence(2731);
  const puffs = Array.from({ length: 37 }, (_, i) => {
    const angle = i / 37 * Math.PI * 2;
    const radius = 43 + random() * 3, x = Math.cos(angle) * radius, y = -8 + Math.sin(angle) * radius * .94;
    const rx = 9 + random() * 5, ry = 10 + random() * 6;
    return `<g><ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" transform="rotate(${(angle * 180 / Math.PI).toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})" fill="url(#dandelion-fluff)" opacity=".96"/>${svgFibres(x, y, rx * 1.08, ry * 1.07, 30, i * 73 + 51, i % 3 ? '#fffdf7' : '#efdcba', .68)}</g>`;
  }).join('');
  const seeds = [-3, 18, 38, 60, 83, 108, 130, 153, 175, 197, 217, 236, 253, 274, 297, 321, 340].map((degrees, i) => {
    const a = degrees / 180 * Math.PI, from = 37 + random() * 3, end = 57 + random() * 13;
    const x1 = Math.cos(a) * from, y1 = -8 + Math.sin(a) * from;
    const x2 = Math.cos(a) * end, y2 = -8 + Math.sin(a) * end * .89;
    const tip = i % 4 ? 3.5 + random() * .7 : 4.3;
    return `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)}Q${((x1 + x2) * .5 + 1.2).toFixed(2)} ${((y1 + y2) * .5).toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="#c58a2d" stroke-width=".95"/><path d="M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="#ffe7a5" stroke-width=".3"/><circle cx="${x2.toFixed(2)}" cy="${y2.toFixed(2)}" r="${tip.toFixed(2)}" fill="url(#${i % 4 ? 'dandelion-fluff' : 'dandelion-gold'})"/>${svgFibres(x2, y2, tip, tip, 10, 741 + i, i % 4 ? '#fffdf5' : '#ffe095', .62)}`;
  }).join('');
  // The long loose edge fibres break up the scalloped circle without filters.
  const wisps = Array.from({ length: 100 }, (_, i) => {
    const a = i / 100 * Math.PI * 2, r = 53 + random() * 4;
    const x = Math.cos(a) * r, y = -8 + Math.sin(a) * r * .94;
    const dx = Math.cos(a) * (2 + random() * 3), dy = Math.sin(a) * (2 + random() * 3);
    return `<path d="M${x.toFixed(2)} ${y.toFixed(2)}q${(dx - dy * .6).toFixed(2)} ${(dy + dx * .6).toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)}t${(-dx * .35).toFixed(2)} ${(-dy * .35).toFixed(2)}"/>`;
  }).join('');
  return `<ellipse cy="-8" rx="51" ry="49" fill="url(#dandelion-fluff)"/>${puffs}<g>${seeds}</g>${svgFibres(0, -8, 53, 51, 310, 642, '#fffdf6', .7)}<g fill="none" stroke="#fff7e8" stroke-width=".36" stroke-linecap="round" opacity=".8">${wisps}</g>`;
}

function svgLandmarks() {
  const arches = (x, y, count, w, h) => Array.from({ length: count }, (_, i) => `<path d="M${x + i * w} ${y}v-${h - 3}q${w * .32} -5 ${w * .64} 0v${h - 3}" fill="#aa732c" stroke="#ffe2a2" stroke-width="1.3"/>`).join('');
  return `<g stroke-linejoin="round" stroke-linecap="round">
    <g transform="translate(-34 -57) rotate(-15)"><path d="M-20-17Q0-24 20-17V12Q0 20-20 12Z" fill="url(#dandelion-stone)" stroke="#d8a04f" stroke-width="1"/><path d="M-21-17Q0-27 21-17M-22-7Q0-15 22-7M-21 3Q0-5 21 3M-20 13Q0 6 20 13" fill="none" stroke="#ffe0a1" stroke-width="3.1"/>${arches(-16, -8, 5, 7, 7)}${arches(-17, 4, 5, 7.3, 8)}<path d="M-15-20-14-23M-8-22-7-25M0-23V-26M8-22 9-25M16-20 17-23" stroke="#f5c774" stroke-width="2.5"/></g>
    <g transform="translate(-10 -66)"><path d="M-17 0 0-31 20 0Z" fill="#edb63d" stroke="#fff0b8" stroke-width="1"/><path d="M0-31 5 0H20Z" fill="#d69926"/><path d="M-12-8H14M-8-16H9M-4-24H5M-3-16-6-8-7 0M5-16 8-8 10 0M0-25-1-17" fill="none" stroke="#f9d36c" stroke-width="1.2"/></g>
    <g transform="translate(-17 -60)"><path d="M-16 7V-4" stroke="#a57a37" stroke-width="3"/><circle cx="-16" cy="-6" r="8" fill="#899454"/><circle cx="-21" cy="-1" r="6" fill="#9da268"/><circle cx="-11" cy="-2" r="6" fill="#7f8e4e"/><path d="m-20-7 2 5m3-7 2 4" stroke="#b5ba7b" stroke-width="1"/></g>
    <g transform="translate(10 -53) scale(.64)"><path d="M-20 5-6-43-3-81H3L6-43 20 5 11 5 3-22H-3L-11 5Z" fill="url(#dandelion-gold)" stroke="#d8952c" stroke-width="1.3"/><path d="M-11 5Q0-18 11 5" fill="#fff3d9" stroke="#e7a53a" stroke-width="2"/><path d="M-15-9H15M-9-30H9M-5-54H5M-4-69H4" stroke="#ffd27a" stroke-width="4"/><path d="m-12-9 17-21M12-9-5-30M-6-34 11-16M6-34-11-16M-4-40 8 10M4-40-8 10M-3-54 6 24M3-54-6 24" fill="none" stroke="#f5bf5a" stroke-width="1.2"/><path d="M0-82V-88" stroke="#e9a43a" stroke-width="2.7"/><ellipse cy="-75" rx="5" ry="2.1" fill="#ffce70"/></g>
    <g transform="translate(29 -65) rotate(-7)"><path d="M-6 10V-23H6V10Z" fill="#fff1cc" stroke="#e3bd78" stroke-width=".7"/><path d="M-7-23Q-8-33 0-34Q8-33 7-23Z" fill="url(#dandelion-fluff)"/><path d="M-7-22H7M-6-14H6M-6-5H6" stroke="#e6c88d" stroke-width="1.7"/><path d="M-2-17V-20Q0-22 2-20V-17M-2-8V-11Q0-13 2-11V-8M-2 1V-2Q0-4 2-2V1" fill="#dca943"/></g>
    <g transform="translate(43 -56) rotate(11)"><path d="M-13 12-9-16H8L13 12Z" fill="#f1cf90" stroke="#d0a260" stroke-width="1"/><path d="m-12-16 12-12 12 12Z" fill="#d9b06b"/><path d="M-3 11V2q4-6 7 0v9" fill="#9b7642"/><path d="M-10-7H9M-11 1H11" stroke="#fae1b2" stroke-width="1.2"/><g transform="translate(0 -19) rotate(-21)"><path d="M-2-2-7-23Q-6-27-1-25L3-6ZM2-2 23-7Q27-6 25-1L6 3ZM2 2 7 23Q6 27 1 25L-3 6ZM-2 2-23 7Q-27 6-25 1L-6-3Z" fill="#d96543" stroke="#b94c32" stroke-width=".8"/><path d="M-3-7-4-20M7-3 20-4M3 7 4 20M-7 3-20 4" stroke="#ef966a" stroke-width="1.5"/><path d="m-3-9 4-2m-5-4 4-2m9 13 2 4m4-5 2 4M3 9l-4 2m5 4-4 2m-9-13-2-4m-4 5-2-4" fill="none" stroke="#efa27a" stroke-width=".65"/><circle r="3.3" fill="#edc16e"/><circle r="1.3" fill="#fff0b9"/></g></g>
    <g transform="translate(54 -41)"><path d="M0 3V-8" stroke="#9b7b43" stroke-width="2.5"/><circle cy="-11" r="8" fill="#939c60"/><circle cx="-5" cy="-7" r="6" fill="#a5ac75"/><circle cx="5" cy="-6" r="6" fill="#818f50"/><path d="m-3-13 2 5m4-2 1 4" stroke="#bac28b" stroke-width="1"/></g>
  </g>`;
}

export function dandelionRigMarkup() {
  return `<svg viewBox="0 0 180 240" aria-hidden="true" class="companion-rig dandelion-rig">
    <defs>
      <radialGradient id="dandelion-fluff" cx=".35" cy=".25" r=".8"><stop stop-color="#fffdf5"/><stop offset=".6" stop-color="#fff4de"/><stop offset="1" stop-color="#e8cfab"/></radialGradient>
      <radialGradient id="dandelion-face" cx=".3" cy=".24" r=".85"><stop stop-color="#fffae9"/><stop offset=".64" stop-color="#fff0cf"/><stop offset="1" stop-color="#e9c98f"/></radialGradient>
      <linearGradient id="dandelion-gold" x2=".65" y2="1"><stop stop-color="#ffd96c"/><stop offset=".48" stop-color="#f7bd36"/><stop offset="1" stop-color="#d69620"/></linearGradient>
      <linearGradient id="dandelion-stone" x2=".8" y2="1"><stop stop-color="#ffe0a2"/><stop offset="1" stop-color="#d99b45"/></linearGradient>
      <linearGradient id="dandelion-bag" x2=".6" y2="1"><stop stop-color="#c88a38"/><stop offset="1" stop-color="#985a24"/></linearGradient>
      <radialGradient id="dandelion-blush"><stop stop-color="#ed9c62" stop-opacity=".78"/><stop offset="1" stop-color="#f8bb83" stop-opacity="0"/></radialGradient>
      <radialGradient id="dandelion-eye" cx=".34" cy=".25"><stop stop-color="#79512a"/><stop offset=".5" stop-color="#4a301d"/><stop offset="1" stop-color="#261f19"/></radialGradient>
      <pattern id="dandelion-knit" width="5" height="5" patternUnits="userSpaceOnUse"><path d="m.5.5 2 2 2-2M.5 3l2 2 2-2" fill="none" stroke="#c88a21" stroke-width="1.1" opacity=".3"/><path d="m.4 0 2 2.4L4.4 0M.4 2.5l2 2.4 2-2.4" fill="none" stroke="#ffe699" stroke-width=".65" opacity=".8"/></pattern>
    </defs>
    <ellipse cx="91" cy="229" rx="30" ry="4.2" fill="#92794c" opacity=".13"/>
    <g data-bone="root"><g transform="translate(90 157)">
      <g transform="translate(-12 49)"><g data-bone="legL"><ellipse cy="8" rx="7.7" ry="14" fill="url(#dandelion-gold)"/><g transform="translate(0 13)"><g data-bone="kneeL"><ellipse cx="-1" cy="5" rx="8" ry="9" fill="url(#dandelion-gold)"/>${svgFibres(0, 4, 7, 7, 28, 111, '#ffe7a5', .75)}</g></g></g></g>
      <g transform="translate(12 49)"><g data-bone="legR"><ellipse cy="8" rx="7.7" ry="14" fill="url(#dandelion-gold)"/><g transform="translate(0 13)"><g data-bone="kneeR"><ellipse cx="1" cy="5" rx="8" ry="9" fill="url(#dandelion-gold)"/>${svgFibres(0, 4, 7, 7, 28, 152, '#ffe7a5', .75)}</g></g></g></g>
      <ellipse cy="28" rx="32" ry="35" fill="url(#dandelion-fluff)"/><ellipse cx="-19" cy="27" rx="15" ry="26" fill="url(#dandelion-fluff)"/><ellipse cx="17" cy="26" rx="17" ry="28" fill="url(#dandelion-fluff)"/>${svgFibres(0, 27, 33, 35, 340, 392)}
      <g transform="translate(-4 -4)"><g data-bone="tail"><path d="M0 0Q-23 24-68 16L-66 32Q-29 43 5 13Z" fill="url(#dandelion-gold)" stroke="#db9e23" stroke-width=".7"/><path d="M0 0Q-23 24-68 16L-66 32Q-29 43 5 13Z" fill="url(#dandelion-knit)"/><path d="M-65 19-73 18M-65 23-74 23M-65 27-73 29M-64 31-71 35" stroke="#e8ad2c" stroke-width="2.5" stroke-linecap="round"/><path d="M1 6Q-21 37-57 39L-52 50Q-16 48 12 15Z" fill="url(#dandelion-gold)"/><path d="M1 6Q-21 37-57 39L-52 50Q-16 48 12 15Z" fill="url(#dandelion-knit)"/><path d="m-55 41-5 5m7-2-5 6m8-3-4 6m8-4-3 5" stroke="#e4a025" stroke-width="2.5" stroke-linecap="round"/></g></g>
      <path d="M25-4-26 43" stroke="#996329" stroke-width="5.4" stroke-linecap="round"/><path d="M25-4-26 43" stroke="#d8a75e" stroke-width="1.3" stroke-dasharray="1.2 2.2"/>
      <g transform="translate(-24 35) rotate(9)"><rect x="-13" y="-12" width="26" height="28" rx="5" fill="url(#dandelion-bag)" stroke="#9c622b" stroke-width="1"/><path d="M-11-5Q0 1 11-5V7Q0 12-11 7Z" fill="#c18a45"/><rect x="-10.5" y="-9.5" width="21" height="23" rx="3" fill="none" stroke="#e4ba76" stroke-width=".65" stroke-dasharray="1.3 1.3"/><circle cy="2" r="7.4" fill="none" stroke="#ffe3a0" stroke-width="1.35"/><ellipse cy="2" rx="3.5" ry="7.4" fill="none" stroke="#ffe3a0" stroke-width="1"/><path d="M-7.2 0H7.2M-6.4 5H6.4" stroke="#ffe3a0" stroke-width="1"/><circle cx="10" cy="-8" r="1.7" fill="#f7ce76"/></g>
      <g transform="translate(0 -42)"><g data-bone="head">
        ${svgLandmarks()}${svgFluffHalo()}
        <ellipse cy="-7" rx="34" ry="32" fill="url(#dandelion-face)" stroke="#e9c78f" stroke-width=".45"/>${svgFibres(0, -8, 33, 31, 380, 980, '#fffaf0', .62)}
        <ellipse cx="-25" cy="5" rx="13" ry="10" fill="url(#dandelion-blush)"/><ellipse cx="25" cy="5" rx="13" ry="10" fill="url(#dandelion-blush)"/>
        <g data-bone="eyes"><ellipse cx="-18" cy="-13" rx="3.55" ry="4.15" fill="url(#dandelion-eye)"/><ellipse cx="18" cy="-13" rx="3.55" ry="4.15" fill="url(#dandelion-eye)"/><circle cx="-19.1" cy="-14.5" r="1.1" fill="#fffdf2"/><circle cx="16.9" cy="-14.5" r="1.1" fill="#fffdf2"/><circle cx="-16.8" cy="-11.6" r=".45" fill="#b58d59"/><circle cx="19.2" cy="-11.6" r=".45" fill="#b58d59"/></g>
        <path data-bone="brows" d="M-23-25Q-18-27-13-25M13-25Q18-27 23-25" fill="none" stroke="#ba915e" opacity=".7" stroke-width="1.25" stroke-linecap="round"/>
        <path data-bone="smile" d="M-6 9Q0 18 6 9" fill="none" stroke="#c27837" stroke-width="2" stroke-linecap="round"/>
        <ellipse data-bone="mouth" cy="13" rx="4.8" ry="5" fill="#9e613a" transform="translate(0 13) scale(1 0) translate(0 -13)"/>
      </g></g>
      <path d="M-25-9Q-13-17 15-13Q30-11 26-3Q9 9-23 1Z" fill="url(#dandelion-gold)" stroke="#dfa329" stroke-width=".7"/><path d="M-25-9Q-13-17 15-13Q30-11 26-3Q9 9-23 1Z" fill="url(#dandelion-knit)"/><path d="M-22-2Q0-9 23-6" fill="none" stroke="#ffe28a" stroke-width="2.4" opacity=".8"/>
      <g transform="translate(6 14)"><path d="M-16-11-10-14H-2L2-10" fill="#ede1c4" stroke="#b9aa8b" stroke-width=".7"/><rect x="-20" y="-9" width="40" height="24" rx="3.8" fill="#f2e7cd" stroke="#b7a284" stroke-width=".9"/><path d="M-19-2H19V12Q0 17-19 12Z" fill="#b27d43"/><path d="M-18-1H18M-18 12H18" stroke="#f6ebce" stroke-width="1.5"/><rect x="-15" y="-6" width="6" height="3" rx="1" fill="#e9dfca" stroke="#9e9277" stroke-width=".6"/><rect x="10" y="-6" width="5" height="3" rx=".8" fill="#86745b"/><ellipse cx="-12" cy="-10" rx="3" ry="1.2" fill="#c0af8d"/><ellipse cx="14" cy="-10" rx="3" ry="1.2" fill="#c0af8d"/><circle cy="4" r="11" fill="#e2d4b7" stroke="#98856b" stroke-width=".8"/><circle cy="4" r="8.4" fill="#5d4a30"/><circle cy="4" r="5.8" fill="#322f24"/><circle cy="4" r="3.6" fill="#4e513f"/><ellipse cx="-2" cy="1.7" rx="2.1" ry="1.5" fill="#eee9cb" opacity=".7"/><path d="M3 7a4 4 0 0 1-4 1" fill="none" stroke="#9b9a79" stroke-width="1"/></g>
      <g transform="translate(-28 1)"><g data-bone="armL"><ellipse cx="-1" cy="8" rx="9" ry="14" fill="url(#dandelion-fluff)"/><g transform="translate(-1 14)"><g data-bone="elbowL"><ellipse cx="3" cy="1" rx="11" ry="12" fill="url(#dandelion-fluff)"/>${svgFibres(2, 0, 10, 11, 32, 467)}</g></g></g></g>
      <g transform="translate(29 0)"><g data-bone="armR"><ellipse cx="1" cy="7" rx="8.8" ry="13" fill="url(#dandelion-fluff)"/><g transform="translate(1 13)"><g data-bone="elbowR"><ellipse cx="-2" cy="0" rx="10.5" ry="11.5" fill="url(#dandelion-fluff)"/>${svgFibres(-2, 0, 10, 11, 32, 492)}</g></g></g></g>
    </g></g>
  </svg>`;
}

export function createDandelion2D(host) {
  return createSvgRig2D(host, {
    markup: dandelionRigMarkup(), id: 'dandelion-2d', name: '绒绒',
    eyeY: -13, mouthY: 13, waveAngle: 145,
  });
}

function makeFibreTexture({ gold = false } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = gold ? '#f5be3f' : '#fff8e9'; context.fillRect(0, 0, 256, 256);
  const random = randomSequence(gold ? 775 : 919);
  context.lineCap = 'round';
  if (gold) {
    // Paired interlocking yarn loops retain an actual knitted structure on the
    // scarf, instead of sharing the randomly tangled wool of the head/body.
    for (let row = -1; row < 17; row++) for (let col = -1; col < 17; col++) {
      const x = col * 16 + (row % 2) * 1.4, y = row * 16;
      for (const [color, width, offset] of [['#c88a21', 4.4, 1.5], ['#ffe18b', 2.8, 0]]) {
        context.strokeStyle = color; context.lineWidth = width; context.globalAlpha = .7;
        context.beginPath(); context.moveTo(x - 5, y - 7 + offset);
        context.bezierCurveTo(x - 7, y - 1, x - 1, y + 2, x, y + 7 + offset);
        context.bezierCurveTo(x + 1, y + 2, x + 7, y - 1, x + 5, y - 7 + offset); context.stroke();
      }
    }
  }
  context.lineWidth = gold ? .45 : .65;
  for (let i = 0; i < (gold ? 380 : 1850); i++) {
    const x = random() * 256, y = random() * 256, size = .65 + random() * .8;
    context.strokeStyle = i % 4 ? (gold ? '#ffebae' : '#fffef9') : (gold ? '#dca12e' : '#d4ba91');
    context.globalAlpha = i % 4 ? .67 : .25;
    context.beginPath(); context.moveTo(x, y);
    context.bezierCurveTo(x - 3 * size, y - 5 * size, x + 5 * size, y - 5 * size, x + 3 * size, y + size);
    context.bezierCurveTo(x, y + 5 * size, x - 4 * size, y + size, x - size, y - 2 * size); context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function roundedBoxGeometry(width, height, depth, radius = .04) {
  const x = -width / 2, y = -height / 2, shape = new THREE.Shape();
  shape.moveTo(x + radius, y); shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius); shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height); shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius); shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(.01, depth - radius * .5), bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: radius * .25, bevelThickness: radius * .25, curveSegments: 5 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

export function buildDandelionRig() {
  const scene = new THREE.Scene();
  // Geometry can also be inspected under Node without a DOM or a WebGL device.
  const woolTexture = typeof document === 'undefined' ? null : makeFibreTexture();
  const knitTexture = typeof document === 'undefined' ? null : makeFibreTexture({ gold: true });
  const textures = new Set([woolTexture, knitTexture].filter(Boolean));
  const materials = {
    wool: new THREE.MeshStandardMaterial({ color: 0xfff7e9, map: woolTexture, bumpMap: woolTexture, bumpScale: .013, roughness: .98 }),
    face: new THREE.MeshStandardMaterial({ color: 0xfff1d2, map: woolTexture, bumpMap: woolTexture, bumpScale: .011, roughness: .98 }),
    feltGold: new THREE.MeshStandardMaterial({ color: 0xe9b650, map: woolTexture, bumpMap: woolTexture, bumpScale: .014, roughness: .98 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xf5bd38, map: knitTexture, bumpMap: knitTexture, bumpScale: .01, roughness: .9 }),
    goldLight: new THREE.MeshStandardMaterial({ color: 0xffd778, roughness: .85 }),
    goldDark: new THREE.MeshStandardMaterial({ color: 0xc78c25, roughness: .95 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xeabe76, roughness: .93 }),
    stoneLight: new THREE.MeshStandardMaterial({ color: 0xffdda0, roughness: .93 }),
    recess: new THREE.MeshStandardMaterial({ color: 0xa67d43, roughness: .96 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd96848, roughness: .85 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x929b5b, roughness: .94 }),
    leafLight: new THREE.MeshStandardMaterial({ color: 0xb0b47a, roughness: .96 }),
    leather: new THREE.MeshStandardMaterial({ color: 0xb6803b, roughness: .92 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x9e682c, roughness: .9 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xe3d7ba, roughness: .46, metalness: .2 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x35291b, roughness: .17, metalness: .03 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x394336, roughness: .17, metalness: .15 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xfffdf0 }),
    blush: new THREE.MeshStandardMaterial({ color: 0xefab7b, roughness: 1, transparent: true, opacity: .48, depthWrite: false }),
    mouth: new THREE.MeshStandardMaterial({ color: 0xa5683b, roughness: .85 }),
    fibre: new THREE.LineBasicMaterial({ color: 0xfffbef, transparent: true, opacity: .64, depthWrite: false }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x92774d, transparent: true, opacity: .13, depthWrite: false }),
  };
  const geometries = new Set();
  const geometry = value => { geometries.add(value); return value; };
  const sphere = geometry(new THREE.SphereGeometry(1, 16, 10));
  const faceSphere = geometry(new THREE.SphereGeometry(1, 24, 18));
  const root = new THREE.Group(); scene.add(root);
  const group = (parent, x = 0, y = 0, z = 0) => { const object = new THREE.Group(); object.position.set(x, y, z); parent.add(object); return object; };
  const mesh = (parent, material, shape, x = 0, y = 0, z = 0) => {
    const object = new THREE.Mesh(shape, materials[material]); object.position.set(x, y, z); parent.add(object); return object;
  };
  const ell = (parent, material, x, y, z, sx, sy, sz) => { const object = mesh(parent, material, material === 'face' && sx > .3 ? faceSphere : sphere, x, y, z); object.scale.set(sx, sy, sz); return object; };
  const tube = (parent, material, points, radius = .012, segments = 14) => mesh(parent, material, geometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point))), segments, radius, 5, false)));
  const rod = (parent, material, start, end, radius = .012, radialSegments = 7) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), delta = b.clone().sub(a);
    const object = mesh(parent, material, geometry(new THREE.CylinderGeometry(radius, radius, delta.length(), radialSegments)), ...a.clone().add(b).multiplyScalar(.5).toArray());
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return object;
  };
  const torus = (parent, material, x, y, z, radius, thickness, arc = Math.PI * 2) => mesh(parent, material, geometry(new THREE.TorusGeometry(radius, thickness, 7, 32, arc)), x, y, z);
  const box = (parent, material, x, y, z, w, h, d, r) => mesh(parent, material, geometry(roundedBoxGeometry(w, h, d, r)), x, y, z);

  // Merge all static surfaces by material in each articulated part. The many
  // small felt tufts and miniature landmark pieces become a few GPU draws.
  function compileStatic(parent) {
    parent.updateMatrixWorld(true);
    const inverse = parent.matrixWorld.clone().invert(), buckets = new Map(), originals = [];
    parent.traverse(object => {
      if (!object.isMesh || object.isInstancedMesh) return;
      const shape = object.geometry.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      const list = buckets.get(object.material) || []; list.push(shape); buckets.set(object.material, list); originals.push(object);
    });
    for (const object of originals) object.removeFromParent();
    for (const [material, shapes] of buckets) {
      const flattened = shapes.map(shape => shape.index ? shape.toNonIndexed() : shape);
      const combined = mergeGeometries(flattened, false);
      if (combined) { geometries.add(combined); parent.add(new THREE.Mesh(combined, material)); }
      shapes.forEach(shape => shape.dispose());
      flattened.forEach((shape, i) => { if (shape !== shapes[i]) shape.dispose(); });
    }
  }

  function fibres(parent, centres, seed, countPerCentre = 17) {
    const random = randomSequence(seed), positions = [];
    for (const [cx, cy, cz, rx, ry, rz] of centres) {
      for (let n = 0; n < countPerCentre; n++) {
        const longitude = random() * Math.PI * 2, latitude = Math.acos(2 * random() - 1);
        const x = cx + rx * Math.sin(latitude) * Math.cos(longitude);
        const y = cy + ry * Math.cos(latitude), z = cz + rz * Math.sin(latitude) * Math.sin(longitude);
        const radius = .012 + random() * .02, phase = random() * Math.PI * 2;
        const normal = new THREE.Vector3((x - cx) / (rx * rx), (y - cy) / (ry * ry), (z - cz) / (rz * rz)).normalize();
        const tangent = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
        const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
        let previous = null;
        for (let i = 0; i <= 7; i++) {
          const angle = phase + i / 7 * Math.PI * 1.7;
          const u = Math.cos(angle) * radius, v = Math.sin(angle) * radius * .7, lift = (.3 + Math.sin(angle * .6) * .2) * radius;
          const point = [x + tangent.x * u + bitangent.x * v + normal.x * lift, y + tangent.y * u + bitangent.y * v + normal.y * lift, z + tangent.z * u + bitangent.z * v + normal.z * lift];
          if (previous) positions.push(...previous, ...point); previous = point;
        }
      }
    }
    const shape = geometry(new THREE.BufferGeometry()); shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(shape, materials.fibre); parent.add(lines); return lines;
  }

  const body = group(root);
  ell(body, 'wool', 0, .78, 0, .43, .56, .31);
  const random = randomSequence(827);
  const bodyTufts = [];
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, x = Math.cos(a) * .33, y = .78 + Math.sin(a) * .43;
    const sx = .12 + random() * .045, sy = .15 + random() * .045;
    ell(body, 'wool', x, y, .04 + random() * .08, sx, sy, .2);
    bodyTufts.push([x, y, .06, sx * 1.03, sy * 1.03, .205]);
  }
  fibres(body, bodyTufts, 147, 15); compileStatic(body);
  const legL = group(root, -.16, .31, .02), legR = group(root, .16, .31, .02), knees = [], ankles = [];
  for (const leg of [legL, legR]) {
    const upper = group(leg); ell(upper, 'feltGold', 0, -.065, 0, .098, .17, .12); compileStatic(upper);
    const knee = group(leg, 0, -.13, 0); knees.push(knee);
    const foot = group(knee, 0, -.055, 0); ankles.push(foot); ell(foot, 'feltGold', 0, 0, .035, .105, .12, .15);
    fibres(foot, [[0, 0, .035, .107, .122, .15]], 491, 35); compileStatic(foot);
  }

  const head = group(root, 0, 2.03, 0);
  const crown = group(head);
  ell(crown, 'wool', 0, -.01, -.065, .7, .68, .27);
  const haloTufts = [];
  for (let i = 0; i < 35; i++) {
    const a = i / 35 * Math.PI * 2;
    const x = Math.cos(a) * (.59 + random() * .04), y = -.01 + Math.sin(a) * (.58 + random() * .025);
    const sx = .155 + random() * .065, sy = .17 + random() * .06, z = -.02 + random() * .045;
    const puff = ell(crown, 'wool', x, y, z, sx, sy, .19); puff.rotation.z = a;
    haloTufts.push([x, y, z, sx * 1.08, sy * 1.08, .21]);
  }
  // A second inner tier removes any regular, gear-like outline.
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2 + .15;
    ell(crown, 'wool', Math.cos(a) * .49, Math.sin(a) * .48, .11, .16, .17, .15);
  }
  fibres(crown, haloTufts, 851, 56);
  fibres(crown, [[0, 0, .13, .59, .59, .12]], 291, 260);
  for (let i = 0; i < 15; i++) {
    const a = .1 + i / 15 * Math.PI * 2, reach = .83 + random() * .095;
    const start = [Math.cos(a) * .49, Math.sin(a) * .49, .13];
    const end = [Math.cos(a) * reach, Math.sin(a) * reach * .94, .15];
    rod(crown, 'goldDark', start, end, .0075, 6);
    ell(crown, i % 4 ? 'wool' : 'gold', ...end, .045 + (i % 4 ? 0 : .009), .05, .045);
  }
  ell(crown, 'face', 0, -.045, .17, .48, .445, .315);
  fibres(crown, [[0, -.045, .17, .48, .445, .318]], 571, 370);

  // Paris: four actual tapered lattice legs, floor bands, arch and antenna.
  const tower = group(crown, .12, .61, -.1);
  const levels = [[0, .22], [.27, .135], [.5, .065], [.88, .027]];
  for (const side of [-1, 1]) for (const depth of [-1, 1]) {
    for (let i = 0; i < levels.length - 1; i++) {
      const [ya, ra] = levels[i], [yb, rb] = levels[i + 1];
      rod(tower, 'gold', [side * ra, ya, depth * ra * .55], [side * rb, yb, depth * rb * .55], .021, 7);
    }
  }
  for (const [y, width] of [[.23, .32], [.48, .18], [.75, .095]]) {
    box(tower, 'goldLight', 0, y, 0, width + .07, .045, width * .63, .016);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const [y1, r1] = levels[i], [y2, r2] = levels[i + 1];
    rod(tower, 'goldLight', [-r1, y1 + .04, side * r1 * .55], [r2, y2 - .03, side * r2 * .55], .008, 5);
    rod(tower, 'goldLight', [r1, y1 + .04, side * r1 * .55], [-r2, y2 - .03, side * r2 * .55], .008, 5);
  }
  tube(tower, 'goldLight', [[-.145, .015, .14], [-.105, .16, .1], [0, .205, .085], [.105, .16, .1], [.145, .015, .14]], .024, 14);
  rod(tower, 'gold', [0, .85, 0], [0, 1.04, 0], .014, 7);
  ell(tower, 'goldLight', 0, .86, 0, .05, .032, .044);

  // Rome: curved amphitheatre with two storeys of recessed arched openings.
  const colosseum = group(crown, -.47, .66, -.09); colosseum.rotation.set(0, -.2, .19);
  mesh(colosseum, 'recess', geometry(new THREE.CylinderGeometry(.235, .24, .31, 40)), 0, .14, 0);
  for (const y of [0, .16, .325]) {
    const band = torus(colosseum, 'stoneLight', 0, y, 0, .245, .025); band.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, x = Math.sin(a) * .247, z = Math.cos(a) * .247;
    rod(colosseum, 'stone', [x, .025, z], [x, .31, z], .019, 6);
    for (const y of [.07, .23]) {
      const archPoints = [];
      for (let k = 0; k <= 6; k++) {
        const t = Math.PI - k / 6 * Math.PI, offset = Math.cos(t) * .038;
        archPoints.push([x + Math.cos(a) * offset, y + Math.sin(t) * .055, z - Math.sin(a) * offset]);
      }
      tube(colosseum, 'stoneLight', archPoints, .011, 8);
    }
    box(colosseum, 'stoneLight', x, .35, z, .042, .04, .035, .009);
  }
  const pyramid = group(crown, -.18, .89, -.14);
  const pyramidBody = mesh(pyramid, 'gold', geometry(new THREE.ConeGeometry(.25, .38, 4)), 0, .11, 0); pyramidBody.rotation.y = Math.PI / 4;
  for (let i = 1; i <= 3; i++) {
    const y = -.08 + i * .085, r = .185 * (1 - i / 4);
    const ring = mesh(pyramid, 'goldLight', geometry(new THREE.TorusGeometry(r * 1.27, .006, 4, 4)), 0, y, 0); ring.rotation.x = Math.PI / 2; ring.rotation.z = Math.PI / 4;
  }

  // A small cream bell tower nestles between Paris and the windmill, as in the
  // reference crown. This is actual back/side geometry, not a front-only decal.
  const bellTower = group(crown, .35, .74, -.2); bellTower.rotation.z = -.1;
  mesh(bellTower, 'wool', geometry(new THREE.CylinderGeometry(.069, .085, .42, 12)), 0, .2, 0);
  ell(bellTower, 'wool', 0, .435, 0, .1, .09, .1);
  for (const y of [0, .14, .28, .405]) {
    mesh(bellTower, 'stoneLight', geometry(new THREE.CylinderGeometry(.086, .089, .022, 12)), 0, y, 0);
  }
  const windowShape = geometry(new THREE.BoxGeometry(.022, .044, .009));
  for (const y of [.075, .215, .345]) for (const angle of [-.65, 0, .65]) {
    const window = mesh(bellTower, 'goldDark', windowShape, Math.sin(angle) * .078, y, Math.cos(angle) * .077);
    window.rotation.y = angle;
  }

  const windmill = group(crown, .58, .64, -.065); windmill.rotation.z = -.12;
  mesh(windmill, 'stone', geometry(new THREE.CylinderGeometry(.08, .14, .36, 16)), 0, .18, 0);
  mesh(windmill, 'goldDark', geometry(new THREE.ConeGeometry(.17, .15, 5)), 0, .425, 0);
  const door = box(windmill, 'recess', 0, .1, .128, .052, .12, .015, .022);
  door.rotation.x = -.08;
  const blades = group(windmill, 0, .35, .145); blades.rotation.z = .25;
  for (let i = 0; i < 4; i++) {
    const blade = group(blades); blade.rotation.z = i * Math.PI / 2;
    box(blade, 'red', 0, .125, 0, .065, .225, .035, .025);
    rod(blade, 'stoneLight', [0, .035, .025], [0, .21, .025], .005, 5);
  }
  ell(blades, 'goldLight', 0, 0, .02, .046, .046, .035);
  for (const [x, y, z, scale] of [[-.72, .55, -.06, .8], [.74, .48, -.065, .75], [-.27, .68, -.08, .75]]) {
    const tree = group(crown, x, y, z); tree.scale.setScalar(scale);
    rod(tree, 'strap', [0, -.08, 0], [0, .18, 0], .025, 6);
    ell(tree, 'leaf', 0, .19, 0, .13, .15, .12); ell(tree, 'leafLight', -.08, .13, .02, .095, .1, .09); ell(tree, 'leaf', .07, .11, .03, .1, .11, .09);
  }
  compileStatic(crown);

  // The small glossy eyes, eyelids, eyebrows and mouth stay independent.
  const eyes = [], brows = [];
  for (const side of [-1, 1]) {
    const eye = group(head, side * .19, .015, .454); eyes.push(eye);
    ell(eye, 'eye', 0, 0, 0, .039, .047, .027);
    ell(eye, 'glint', -.009, .016, .022, .011, .012, .006);
    const brow = ell(head, 'strap', side * .19, .158, .436, .055, .009, .01); brows.push(brow);
    ell(head, 'blush', side * .313, -.15, .403, .092, .056, .018);
  }
  const mouth = ell(head, 'mouth', 0, -.165, .479, .054, .008, .018);
  const smile = tube(head, 'mouth', [[-.071, -.125, .477], [-.047, -.163, .49], [0, -.177, .495], [.047, -.163, .49], [.071, -.125, .477]], .012, 16);

  const collar = group(root, 0, 1.49, .035);
  for (const [y, radius, z] of [[0, .31, 0], [-.07, .305, .025]]) {
    const coil = torus(collar, 'gold', 0, y, z, radius, .085); coil.rotation.x = Math.PI / 2; coil.rotation.z = -.1;
  }
  tube(collar, 'goldLight', [[-.28, -.055, .16], [-.15, -.035, .29], [.05, -.015, .32], [.27, .015, .17]], .025, 20);
  compileStatic(collar);

  const scarfTail = group(root, -.16, 1.47, .12);
  for (const [dy, length, width] of [[0, .74, .16], [-.11, .62, .16]]) {
    const outline = new THREE.Shape();
    outline.moveTo(.05, .02 + dy); outline.bezierCurveTo(-.2, -.2 + dy, -.43, -.32 + dy, -length, -.26 + dy);
    outline.lineTo(-length + .025, -.26 - width + dy); outline.bezierCurveTo(-.42, -.49 + dy, -.09, -.28 + dy, .1, -.06 + dy); outline.closePath();
    const shape = geometry(new THREE.ExtrudeGeometry(outline, { depth: .035, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .012, bevelThickness: .012, curveSegments: 14 }));
    mesh(scarfTail, 'gold', shape);
    for (let i = 0; i < 6; i++) {
      const y = -.275 - width * i / 6 + dy;
      tube(scarfTail, 'gold', [[-length + .012, y, .018], [-length - .045, y - .012, .027], [-length - .08, y - .025, .01]], .009, 6);
    }
  }
  compileStatic(scarfTail);

  const accessories = group(root);
  tube(accessories, 'strap', [[.3, 1.39, .15], [.12, 1.16, .34], [-.13, .91, .39], [-.33, .64, .34]], .026, 22);
  tube(accessories, 'goldLight', [[.315, 1.38, .16], [.135, 1.16, .35], [-.115, .91, .4], [-.315, .64, .35]], .0045, 22);
  const bag = group(accessories, -.32, .64, .325); bag.rotation.z = -.12;
  box(bag, 'leather', 0, 0, 0, .3, .34, .13, .04);
  box(bag, 'strap', 0, .075, .074, .27, .13, .025, .03);
  tube(bag, 'goldLight', [[-.12, -.12, .08], [-.12, .12, .08], [.12, .12, .08], [.12, -.12, .08], [-.12, -.12, .08]], .005, 18);
  torus(bag, 'goldLight', 0, -.002, .105, .091, .009);
  const longitude = torus(bag, 'goldLight', 0, -.002, .108, .089, .006); longitude.scale.x = .43;
  for (const y of [-.033, .031]) rod(bag, 'goldLight', [-.082, y, .108], [.082, y, .108], .005, 6);
  ell(bag, 'goldLight', .12, .145, .03, .024, .024, .016);

  const photoCamera = group(accessories, .05, 1.16, .38);
  box(photoCamera, 'silver', 0, 0, 0, .43, .25, .16, .025);
  box(photoCamera, 'leather', 0, -.025, .083, .405, .13, .015, .008);
  box(photoCamera, 'silver', -.08, .145, -.015, .12, .04, .095, .008);
  ell(photoCamera, 'silver', .145, .145, -.02, .035, .015, .028);
  box(photoCamera, 'eye', .14, .072, .09, .055, .028, .015, .007);
  box(photoCamera, 'goldLight', -.14, .073, .09, .065, .022, .015, .006);
  const lensBarrel = mesh(photoCamera, 'silver', geometry(new THREE.CylinderGeometry(.108, .108, .09, 32)), 0, -.005, .13); lensBarrel.rotation.x = Math.PI / 2;
  const lensBody = mesh(photoCamera, 'eye', geometry(new THREE.CylinderGeometry(.087, .09, .02, 32)), 0, -.005, .185); lensBody.rotation.x = Math.PI / 2;
  ell(photoCamera, 'lens', 0, -.005, .204, .063, .063, .015);
  torus(photoCamera, 'silver', 0, -.005, .208, .073, .005);
  ell(photoCamera, 'glint', -.023, .022, .218, .017, .012, .004);
  // The knurled focus ring and twin top dials remain legible when the character
  // is enlarged, without adding image dependencies or a high-resolution mesh.
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    rod(photoCamera, 'silver', [Math.cos(a) * .099, -.005 + Math.sin(a) * .099, .151], [Math.cos(a) * .099, -.005 + Math.sin(a) * .099, .177], .003, 4);
  }
  compileStatic(accessories);

  const armL = group(root, -.36, 1.25, .03), armR = group(root, .36, 1.25, .03), elbows = [];
  for (const [i, arm] of [armL, armR].entries()) {
    const upper = group(arm); ell(upper, 'wool', 0, -.12, .04, .12, .19, .13); compileStatic(upper);
    const elbow = group(arm, 0, -.18, .04); elbows.push(elbow);
    const mitten = group(elbow); ell(mitten, 'wool', i ? -.015 : .015, -.04, .13, .145, .15, .135);
    fibres(mitten, [[0, -.04, .13, .15, .15, .14]], 737 + i, 55); compileStatic(mitten);
  }
  const shadow = mesh(scene, 'shadow', geometry(new THREE.CircleGeometry(.61, 48)), 0, .018, 0); shadow.rotation.x = -Math.PI / 2; shadow.scale.y = .64;
  let disposed = false;
  return {
    root, scene, head, body, materials, geometries, textures,
    joints: { head, legL, legR, knees, ankles, armL, armR, elbows, scarfTail, eyes, brows, mouth, smile },
    capabilities: originalAvatarCapabilities,
    metadata: { id: 'dandelion-3d', name: '绒绒', renderer: 'original-three-felt-joints', capabilities: originalAvatarCapabilities },
    draw({ time = 0, action = 'idle', walk = false, wave = false, point = false, turn = 0, emotion = 'neutral', talk = false, listen = false } = {}) {
      if (disposed) return;
      walk ||= action === 'walk'; wave ||= action === 'wave'; point ||= action === 'point';
      if (action === 'turn' && !turn) turn = time * .8;
      root.rotation.y = turn; root.position.y = walk ? Math.abs(Math.sin(time * 8)) * .045 : Math.sin(time * 2) * .012;
      const stride = walk ? Math.sin(time * 8) : 0;
      root.rotation.z = stride * .018;
      applyBipedGait(sampleBipedGait(time, { walking: walk, hipHalfWidth: .16, upperLength: .13, lowerLength: .055, stepLength: .025, stepHeight: .012 }), [legL, legR], knees, ankles);
      armL.rotation.z = wave ? -2.3 + Math.sin(time * 7) * .22 : -.12;
      armR.rotation.z = point ? 1.47 : .12;
      armL.rotation.x = wave ? -.18 : -.1 - stride * .34; armR.rotation.x = point ? -.15 : -.1 + stride * .34;
      elbows[0].rotation.x = wave ? -.28 : -.3; elbows[1].rotation.x = point ? -.08 : -.3;
      head.rotation.z = listen ? .105 : emotion === 'curious' ? -.105 : emotion === 'concerned' ? .035 : Math.sin(time * 1.3) * .018;
      const blink = time % 5.2 < .12 ? .1 : emotion === 'happy' ? .65 : emotion === 'concerned' ? .94 : 1;
      eyes.forEach(eye => { eye.scale.y = blink; });
      brows.forEach((brow, i) => {
        brow.rotation.z = emotion === 'concerned' ? (i ? -.15 : .15) : emotion === 'curious' ? (i ? -.06 : .13) : 0;
        brow.position.y = emotion === 'concerned' ? .165 : emotion === 'curious' && !i ? .19 : .158;
      });
      mouth.visible = talk || emotion === 'curious';
      mouth.scale.y = talk ? .023 + Math.abs(Math.sin(time * 13)) * .048 : .038;
      smile.visible = !mouth.visible;
      // Concern means attentive reassurance: a softly raised inner brow and an
      // almost level mouth. Never flip the smile into a sad, downturned pout.
      smile.scale.y = emotion === 'concerned' ? .18 : emotion === 'happy' ? 1.15 : 1;
      smile.position.y = emotion === 'concerned' ? -.123 : 0;
      scarfTail.rotation.z = Math.sin(time * 2.2) * (walk ? .09 : .035);
      scarfTail.rotation.y = Math.sin(time * 1.8) * .08;
    },
    dispose() {
      if (disposed) return; disposed = true;
      scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
      geometries.forEach(shape => shape.dispose()); textures.forEach(texture => texture.dispose());
      Object.values(materials).forEach(material => material.dispose());
    },
  };
}

export function createDandelion3D(canvas) {
  const rig = buildDandelionRig(), { scene } = rig;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75)); renderer.setSize(300, 400, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  } catch (error) { rig.dispose(); renderer?.dispose(); throw error; }
  const camera = new THREE.OrthographicCamera(-1.4625, 1.4625, 1.95, -1.95, .1, 30);
  camera.position.set(.28, 2.11, 8); camera.lookAt(0, 1.84, 0);
  scene.add(new THREE.HemisphereLight(0xfffcf2, 0xb6a78d, 2.5));
  for (const [color, intensity, x, y, z] of [[0xffefd4, 3.1, -3, 6, 5], [0xffffff, 1.5, 4, 3, -3]]) {
    const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, y, z); scene.add(light);
  }
  let disposed = false;
  return {
    capabilities: rig.capabilities, metadata: rig.metadata,
    draw(parameters) { if (disposed) return; rig.draw(parameters); renderer.render(scene, camera); },
    dispose() { if (disposed) return; disposed = true; rig.dispose(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}

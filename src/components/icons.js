const paths = {
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/>',
  pause: '<path d="M9 5v14M15 5v14" stroke-width="3"/>',
  muted: '<path d="M4 9h4l5-4v14l-5-4H4Zm13 0 5 6m0-6-5 6"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v4m-4 0h8"/>',
  'mic-muted': '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.8-1M5 11a7 7 0 0 0 11.9 5M19 11a7 7 0 0 1-.5 2.6M12 19v3M8 22h8M3 3l18 18"/>',
  listening: '<path class="listening-bar" d="M4 10v4"/><path class="listening-bar" d="M8 7v10"/><path class="listening-bar" d="M12 4v16"/><path class="listening-bar" d="M16 7v10"/><path class="listening-bar" d="M20 10v4"/>',
  narrating: '<path d="M7 3h10a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-6l-5 4v-4a3 3 0 0 1-3-3V7a4 4 0 0 1 4-4Z"/><path class="narration-bar" d="M8 9v3"/><path class="narration-bar" d="M12 7v7"/><path class="narration-bar" d="M16 8v5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  panorama: '<path d="M3 6c6-3 12-3 18 0v12c-6-3-12-3-18 0Z"/><path d="m4 15 5-5 5 4 3-3 4 4"/><circle cx="15" cy="7" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
};

export function icon(name, className = '') {
  return `<svg class="icon ${name === 'listening' ? 'listening-icon ' : ''}${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
}

export function landmark(id, className = '') {
  const shapes = {
    eiffel: '<path d="M43 6h10l3 31 9 32 14 28H60L48 77 36 97H17l14-28 9-32Z" fill="#b68c60"/><path d="m45 13 6 1 2 24H42Zm-7 32h20l5 17H33Zm-7 25h34l6 13-23-13-23 13Z" fill="#e7ca9a"/><path d="M28 65h40M36 39h24M19 92h58M45 7V0" stroke="#6c624f" stroke-width="3"/><path d="m41 45 14 15m0-15L40 60M32 73l28 18m3-18L36 91" stroke="#7a6e57" stroke-width="2"/>',
    arc: '<path d="M17 26h62v67H58V58c0-13-20-13-20 0v35H17Z" fill="#c3a485"/><path d="M13 17h70v13H13Zm4 17h62v8H17Z" fill="#ead5b9"/><path d="M23 46h9v38h-9m41-38h9v38h-9" fill="#d9bda0"/><path d="M17 17V9h62v8" fill="#c3a485"/>',
    liberty: '<path d="M30 88h39v10H24V88h8l5-45h22l6 45Z" fill="#93b7a5"/><path d="m38 46-17-25 7-4 19 23m5 3 17 10-4 15-11-4" fill="#76a18f"/><path d="m20 20-3-12h13l-3 12" fill="#b59a65"/><path d="M19 8q-2-9 6-8l4 8" fill="#eab65e"/><circle cx="48" cy="29" r="10" fill="#a4c9b5"/><path d="m36 23-5-7 10 4 2-12 6 11 8-9-2 13 11-3-8 9" fill="#76a18f"/><path d="m42 50-4 33m12-33 3 33" stroke="#c6ddc8" stroke-width="3"/>',
    sydney: '<path d="M9 79h79v11H9Z" fill="#c8ac88"/><path d="M13 77 17 43q31 6 34 34Z" fill="#f3edd9" stroke="#c6cdb9" stroke-width="2"/><path d="M32 77 45 19q26 20 22 58Z" fill="#fff9e7" stroke="#c6cdb9" stroke-width="2"/><path d="M57 77q9-30 30-37L80 77Z" fill="#e2e8d7"/><path d="M4 94q12-7 24 0t24 0 24 0 16 0" fill="none" stroke="#91bbc3" stroke-width="4"/>',
    niagara: '<path d="M13 35q30-24 70 0v54H13Z" fill="#adc5a1"/><path d="M25 36q25-15 45 0v50H25Z" fill="#8cbec8"/><path d="M31 39v39m13-44v49m14-47v42m9-37v33" stroke="#e8f5ec" stroke-width="5" stroke-linecap="round"/><ellipse cx="48" cy="85" rx="38" ry="11" fill="#b7d9da"/><path d="M20 87h13m13 3h18" stroke="#f1f7e8" stroke-width="3" stroke-linecap="round"/>',
    colosseum: '<path d="M10 41q38-20 76 0v44q-38 17-76 0Z" fill="#c9a582"/><ellipse cx="48" cy="40" rx="38" ry="13" fill="#ebd5b3"/><ellipse cx="48" cy="39" rx="26" ry="6" fill="#ab8d76"/><path d="M17 58v8m15-10v13m16-11v13m16-15v13m15-16v13M17 77v7m15-7v11m16-10v12m16-13v11m15-14v10" stroke="#846f5d" stroke-width="6" stroke-linecap="round"/><path d="M10 70q38 16 76 0" fill="none" stroke="#ead1b1" stroke-width="3"/>',
    taj: '<path d="M22 58h52v34H22Z" fill="#eee4d1"/><path d="M28 54q-5-13 20-34 25 21 20 34Z" fill="#f8f2df" stroke="#c8c8af" stroke-width="2"/><path d="M48 20V10M21 57h54" stroke="#b9a77e" stroke-width="3"/><path d="M38 92V76q10-18 20 0v16" fill="#b8c6bb"/><path d="M9 91V45h8v46m62 0V45h8v46" fill="#e8dcc3" stroke="#c2bca4" stroke-width="2"/><path d="m8 44 5-11 5 11m60 0 5-11 5 11" fill="#c9b88e"/>',
    pisa: '<g transform="rotate(10 48 88)"><path d="M28 27h40v65H28Z" fill="#eadac1"/><ellipse cx="48" cy="27" rx="20" ry="7" fill="#f5ead5"/><path d="M27 39h42M27 53h42M27 67h42M27 81h42" stroke="#b7aa95" stroke-width="3"/><path d="M36 30v58m12-58v58m12-58v58" stroke="#bba78d" stroke-width="3"/><path d="M36 20v-8h24v8" fill="#d7c6ac"/></g>',
    fuji: '<path d="m7 89 41-67 41 67Z" fill="#91b2b1"/><path d="m48 22-17 28 10-4 8 7 8-9 8 6Z" fill="#f8f5e8"/><ellipse cx="48" cy="91" rx="44" ry="5" fill="#abc3a0"/>',
    himeji: '<path d="M23 86h52v10H23Zm7-25h40v25H30Zm6-22h28v23H36Zm8-15h13v16H44Z" fill="#f0ead8"/><path d="m18 62 30-14 30 14ZM27 40l22-13 21 13ZM35 25l15-14 16 14Z" fill="#789da0"/><path d="M44 73h11v13M41 49h6m7 0h6" stroke="#9ba99c" stroke-width="4"/>',
    cologne: '<path d="M19 87V41h16v46m27 0V41h16v46M33 60l15-19 15 19v27H33Z" fill="#c7b7a0"/><path d="m18 40 9-31 9 31m25 0 9-31 9 31" fill="#879a9b"/><path d="M42 87V73q6-13 12 0v14" fill="#7e9690"/><circle cx="48" cy="60" r="5" fill="#98b5b6"/>',
    'tower-bridge': '<path d="M6 73h84v9H6Zm13-38h15v53H19Zm43 0h15v53H62Z" fill="#cdbb9b"/><path d="m16 35 10-20 12 20m21 0 10-20 12 20" fill="#8ca7b0"/><path d="M32 52h32M4 70q12 0 20-17m48 0q8 17 20 17" fill="none" stroke="#7ea6b8" stroke-width="5"/>',
    pyramid: '<path d="M48 17 94 88H3Z" fill="#d5ad65"/><path d="M48 17 62 88H3Z" fill="#f0d99c"/><path d="M14 72h45M24 55h32M35 39h18M8 82h53" stroke="#c8ac70" stroke-width="2"/>',
  };
  return `<svg class="landmark ${className}" viewBox="0 0 96 104" aria-hidden="true">${shapes[id] ?? '<circle cx="48" cy="49" r="29" fill="#c4dbe0"/><ellipse cx="48" cy="49" rx="13" ry="29" fill="none" stroke="#7da5b0" stroke-width="3"/><path d="M19 49h58M24 33h48M24 65h48" stroke="#7da5b0" stroke-width="3"/><path d="M27 85h42" stroke="#c4d2c3" stroke-width="4" stroke-linecap="round"/>' }</svg>`;
}

/** Original vector travel companion; facial states are driven by actual guide events. */
export function avatar() {
  return `<svg class="travel-buddy" viewBox="0 0 100 112" aria-hidden="true">
    <defs><linearGradient id="buddy-fur" x2=".8" y2="1"><stop stop-color="#ffc782"/><stop offset="1" stop-color="#e89352"/></linearGradient><linearGradient id="buddy-hat" x2=".8" y2="1"><stop stop-color="#8bbdb3"/><stop offset="1" stop-color="#548f86"/></linearGradient></defs>
    <ellipse cx="50" cy="105" rx="28" ry="4" fill="#c5d4ca" opacity=".6"/>
    <g class="buddy-body">
      <path d="M72 90c15-2 20-13 13-25 17 7 16 32-6 36Z" fill="#e6a366"/><path d="M85 65c8 3 12 9 12 16l-10 2c2-6 1-12-2-18Z" fill="#fff3de"/>
      <rect x="21" y="72" width="59" height="28" rx="11" fill="#607f76"/>
      <path d="M32 75q17-10 35 0l5 25H27Z" fill="#fcddb3"/><path d="M32 99v5m33-5v5" stroke="#896044" stroke-width="9" stroke-linecap="round"/>
      <path d="m31 82-9 13m46-15 10 10" stroke="#eaaa6e" stroke-width="10" stroke-linecap="round"/>
      <path d="m40 84 13-4 14 6-2 18-13-5-14 3Z" fill="#fff9e9" stroke="#d2c5a8" stroke-width="1.5"/><path d="m52 82 1 16m-10-6 5-3 10 5 5-4" fill="none" stroke="#8fb8a0" stroke-width="2" stroke-linecap="round"/>
      <g class="buddy-head">
        <path d="m26 45-8-30q16 0 25 18m14 0q11-16 26-16l-9 31" fill="#df985d" stroke="#cb8351" stroke-width="1.4"/>
        <path d="m25 34-3-13 14 12m29 0 13-10-4 14" fill="#f7d4b4"/>
        <path d="M19 46c0-25 62-26 62 0l4 13-9 16q-26 16-52 0L15 59Z" fill="url(#buddy-fur)"/>
        <path d="M18 54q16-5 31 11 18-16 34-11l-7 21q-26 16-52 0Z" fill="#fff4de"/>
        <ellipse cx="27" cy="62" rx="6" ry="3.5" fill="#edab8c" opacity=".7"/><ellipse cx="73" cy="62" rx="6" ry="3.5" fill="#edab8c" opacity=".7"/>
        <g class="buddy-eyes"><ellipse cx="35" cy="53" rx="3.3" ry="4.4" fill="#51483f"/><ellipse cx="65" cy="53" rx="3.3" ry="4.4" fill="#51483f"/><circle cx="36" cy="51.5" r="1" fill="white"/><circle cx="66" cy="51.5" r="1" fill="white"/></g>
        <path d="M45 63q5-3 10 0l-5 4Z" fill="#654d40"/>
        <path class="buddy-smile" d="M44 71q6 7 12 0" fill="none" stroke="#7b5241" stroke-width="2.2" stroke-linecap="round"/>
        <ellipse class="buddy-mouth" cx="50" cy="73" rx="5" ry="4" fill="#835344"/><ellipse class="buddy-tongue" cx="50" cy="75" rx="3" ry="1.5" fill="#efb0a4"/>
        <path d="M28 28q3-16 23-16t21 16l6 9q-27 11-55 0Z" fill="url(#buddy-hat)"/>
        <path d="M29 29q23 6 42 0" fill="none" stroke="#e7ead4" stroke-width="5"/>
        <path d="M18 37q30 10 63-1" fill="none" stroke="#63968a" stroke-width="6" stroke-linecap="round"/>
        <circle cx="65" cy="24" r="5" fill="#f6dda4"/><path d="m65 20 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="#6b9383"/>
      </g>
      <path d="m31 79 19 7 18-7-2 9-14 2-16-4Z" fill="#df785a"/><path d="m51 88 7 10 4-9Z" fill="#c7654f"/>
    </g>
    <g class="buddy-listen" fill="none" stroke="#6eaaa0" stroke-width="2.3" stroke-linecap="round"><path d="M88 33q7 5 0 10M92 28q12 10 0 20"/></g>
    <g class="buddy-thought" fill="#91b6ac"><circle cx="82" cy="17" r="2"/><circle cx="88" cy="11" r="2.6"/><circle cx="95" cy="6" r="3"/></g>
  </svg>`;
}

export function facilityIcon(kind) {
  const shapes = {
    toilets:'<circle cx="7" cy="4" r="2"/><circle cx="17" cy="4" r="2"/><path d="M5 9h4v6H8v6H6v-6H5Zm10 0h4l2 8h-3v4h-2v-4h-3Z"/>',
    gate:'<path d="M4 4h10v17H4Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 12h11m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    service:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="7" r="1.3"/><path d="M12 11v6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    food:'<path d="M5 3v7m4-7v7M3 7h8M7 10v11M18 3c-4 4-4 9 0 9v9m0-18v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    parking:'<path d="M7 21V3h6a5 5 0 0 1 0 10H7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    transit:'<rect x="5" y="3" width="14" height="15" rx="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 11h14m-11 8-2 2m10-2 2 2" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',
  };
  return `<svg class="facility-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${shapes[kind] ?? shapes.service}</svg>`;
}

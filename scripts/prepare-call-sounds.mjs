import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Real, softly struck piano recordings; no oscillator or lossy source conversion.
// Alexander Holm, Salamander Grand Piano v3, CC BY 3.0. See docs/FULL_DUPLEX_CALL.md.
const revision = '3382bf9496bba2486f5ab0de55a264d1dfc38404';
const root = fileURLToPath(new URL('../', import.meta.url));
const cache = `${root}agent-tmp/call-sounds`;
await mkdir(cache, { recursive: true });
for (const [note, hash] of [
  ['C4', 'c3cb4ce2d16885ab6dfd8250e0d447b56d51a187546f96e2ee2f95a4c93669fb'],
  ['A4', '9529b14e963a73a320d1a1f47915649e99d42832ca1d9d592624d9fb625b7544'],
]) {
  const name = `${note}v3.flac`;
  let bytes = await readFile(`${cache}/${name}`).catch(() => null);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== hash) {
    const response = await fetch(`https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/${revision}/Samples/${name}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`${name}: checksum mismatch`);
    await writeFile(`${cache}/${name}`, bytes);
  }
}

for (const [name, first, second, duration, delay] of [
  ['dial', 'C4', null, 0.72, 0],
  ['connected', 'C4', 'A4', 1.05, 180],
  ['ended', 'A4', 'C4', 0.9, 160],
]) {
  // Preserve the recorded stereo image and native 48 kHz / 24-bit resolution.
  // Gentle attacks and a long release avoid clicks; tame upper hammer harmonics.
  const phrase = (input, length) => `[${input}:a]atrim=duration=${length},asetpts=PTS-STARTPTS,highpass=f=70,lowpass=f=${name === 'dial' ? 1800 : 2400}:p=2,afade=t=in:d=${name === 'dial' ? 0.035 : 0.018},afade=t=out:st=${length - 0.42}:d=0.42`;
  const output = `${root}public/assets/audio/call-${name}.wav`;
  const filter = second
    ? `${phrase(0, duration)}[first];${phrase(1, duration - delay / 1000)},adelay=${delay}:all=1[second];[first][second]amix=inputs=2:normalize=0,volume=2,alimiter=limit=0.7:level=0[out]`
    : `${phrase(0, duration)},volume=1.6,alimiter=limit=0.7:level=0[out]`;
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1',
    '-threads', '1', '-i', `${cache}/${first}v3.flac`, ...(second ? ['-threads', '1', '-i', `${cache}/${second}v3.flac`] : []),
    '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-ac', '2',
    '-c:a', 'pcm_s24le', '-map_metadata', '-1',
    '-metadata', 'artist=Alexander Holm',
    '-metadata', `title=VirTour call ${name} — Salamander Grand Piano v3 adaptation`,
    '-metadata', 'copyright=CC BY 3.0 https://creativecommons.org/licenses/by/3.0/',
    '-metadata', `comment=Soft C4/A4 piano recordings; trimmed, filtered, faded and sequenced. Source: https://github.com/sfzinstruments/SalamanderGrandPiano/tree/${revision}`,
    output], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${name}`);
  console.log(`${name}: sha256 ${createHash('sha256').update(await readFile(output)).digest('hex')}`);
}

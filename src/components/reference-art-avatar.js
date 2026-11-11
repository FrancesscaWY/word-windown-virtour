import { referenceAvatarData } from '../data/reference-avatar-data.js';
import {
  referenceAvatarCapabilities,
  sampleReferencePose,
  sampleReferenceFrame,
  selectReferenceFace,
} from './reference-avatar-motion.js';

// Literal local paths are intentionally retained for the offline-page embedder.
const OTTER_LAYERS_URL = './assets/reference-avatars/otter-layers.png';
const OTTER_FACE_URL = './assets/reference-avatars/otter-face.png';
const DANDELION_SPRITES_URL = './assets/reference-avatars/dandelion-sprites.png';
const DANDELION_FACE_URL = './assets/reference-avatars/dandelion-face.png';
const VIEW_WIDTH = 300, VIEW_HEIGHT = 400;

function releaseImage(image) {
  image.onload = null;
  image.onerror = null;
  image.removeAttribute?.('src');
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (typeof globalThis.Image !== 'function') {
      reject(new Error('The reference artwork player needs a browser image decoder'));
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      image.onload = null; image.onerror = null;
      if (!image.naturalWidth || !image.naturalHeight) {
        releaseImage(image); reject(new Error('Reference artwork image is empty')); return;
      }
      resolve(image);
    };
    image.onerror = () => { releaseImage(image); reject(new Error('Unable to load local reference artwork')); };
    try { image.src = url; }
    catch (error) { releaseImage(image); reject(error); }
  });
}

async function loadImages(urls) {
  const results = await Promise.allSettled(urls.map(loadImage));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    for (const result of results) if (result.status === 'fulfilled') releaseImage(result.value);
    throw failure.reason;
  }
  return results.map(result => result.value);
}

function fitArt(width, height, viewWidth = VIEW_WIDTH, viewHeight = VIEW_HEIGHT) {
  const scale = Math.min(viewWidth / width, viewHeight / height);
  return { scale, offsetX: (viewWidth - width * scale) / 2, offsetY: (viewHeight - height * scale) / 2 };
}

function withFit(context, fit, draw) {
  context.save();
  context.translate(fit.offsetX ?? 0, fit.offsetY ?? 0);
  context.scale(fit.scale, fit.scale);
  try { draw(); }
  finally { context.restore(); }
}

function withBone(context, pivot, pose, rootY, draw) {
  context.save();
  context.translate(0, rootY ?? 0);
  if (pivot) {
    context.translate(pivot[0], pivot[1]);
    context.rotate(pose?.rotation ?? 0);
    context.scale(pose?.scaleX ?? 1, pose?.scaleY ?? 1);
    context.translate(-pivot[0], -pivot[1]);
  }
  try { draw(); }
  finally { context.restore(); }
}

function withArtworkLean(context, parameters, draw) {
  // Move the complete silhouette, including the face overlay, as one piece.
  // Tilting only the baked head would expose unpainted neck/scarf pixels.
  const rotation = parameters.listen ? -.018 : parameters.emotion === 'curious' ? .009 : parameters.emotion === 'concerned' ? -.006 : 0;
  withBone(context, [VIEW_WIDTH * .5, VIEW_HEIGHT * .89], { rotation }, 0, draw);
}

function paintPatch(context, image, patch, rect) {
  if (!patch || !rect) return;
  const destination = patch.rect ?? rect;
  context.drawImage(image, patch.x, patch.y, patch.width, patch.height,
    destination[0], destination[1], destination[2], destination[3]);
}

function paintFace(context, image, face, pose, time, parameters) {
  if (!face) return;
  const selected = selectReferenceFace(face, time, parameters);
  withBone(context, face.pivot, pose.head, pose.rootY, () => {
    // Neutral shows the untouched reference mouth. Covering it on every frame
    // needlessly replaces the original texture with a rectangular patch.
    if (selected.name !== 'neutral') paintPatch(context, image, selected.patch, face.mouth?.rect);
    for (const eye of face.eyes ?? []) {
      const patch = selected.blink ? eye.patch : parameters.emotion === 'happy' ? eye.happyPatch : null;
      paintPatch(context, image, patch, eye.rect);
    }
  });
}

/** The layered image keeps the supplied watercolour pixels, rather than tracing them. */
export function paintWatercolorOtter(context, images, data, parameters = {}) {
  const time = parameters.time ?? 0;
  const pose = sampleReferencePose(time, parameters, data.height);
  const layers = new Map(data.layers.map(layer => [layer.name, layer]));
  withArtworkLean(context, parameters, () => withFit(context, fitArt(data.width, data.height), () => {
    for (const name of data.order ?? data.layers.map(layer => layer.name)) {
      const layer = layers.get(name);
      if (!layer) continue;
      withBone(context, layer.pivot, pose[name], pose.rootY, () => {
        context.drawImage(images.art, layer.atlasX, layer.atlasY, layer.width, layer.height,
          layer.x, layer.y, layer.width, layer.height);
      });
      if (name === 'head') paintFace(context, images.face, data.face, pose, time, parameters);
    }
  }));
  return pose;
}

/** Frames are locally baked from the supplied felt artwork; this is a 2D atlas. */
export function paintFeltDandelion(context, images, data, parameters = {}) {
  const time = parameters.time ?? 0;
  const selected = sampleReferenceFrame(data, time, parameters);
  const { frame } = selected;
  withArtworkLean(context, parameters, () => withFit(context, fitArt(data.frameWidth, data.frameHeight), () => {
    context.drawImage(images.art, frame.x, frame.y, data.frameWidth, data.frameHeight,
      0, 0, data.frameWidth, data.frameHeight);
    // Face patches use original source coordinates and the exact baked head
    // transform, so the camera and other details never swim under the overlay.
    withFit(context, data.fit ?? fitArt(data.width, data.height, data.frameWidth, data.frameHeight), () => {
      paintFace(context, images.face, data.face, frame.pose ?? sampleReferencePose(0, {}, data.height), time, parameters);
    });
  }));
  return selected;
}

async function createArtworkPlayer(canvas, { id, name, data, artUrl, faceUrl, renderer, paint }) {
  if (!canvas?.getContext) throw new TypeError('Reference artwork avatars require a canvas');
  if (!data || !(data.width > 0) || !(data.height > 0)) throw new TypeError('Reference artwork dimensions are missing');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const [art, face] = await loadImages([artUrl, faceUrl]);
  const images = { art, face };
  const pixelRatio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), 1.5);
  canvas.width = Math.round(VIEW_WIDTH * pixelRatio);
  canvas.height = Math.round(VIEW_HEIGHT * pixelRatio);
  let disposed = false;
  const model = {
    capabilities: referenceAvatarCapabilities,
    metadata: {
      id, name, renderer, dimensionality: '2d',
      reference: id === 'otter-watercolor' ? 'design/digit-hum-1.jpg' : 'design/digit-hum-2.png',
      artwork: 'reference-image-pixels',
      lipSync: 'playback-driven-mouth-patches',
      capabilities: referenceAvatarCapabilities,
    },
    draw(parameters = {}) {
      if (disposed) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      paint(context, images, data, parameters);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      releaseImage(art); releaseImage(face);
      // Release the backing pixels; a newly selected instance can size it again.
      canvas.width = 1; canvas.height = 1;
    },
  };
  try { model.draw(); } catch (error) { model.dispose(); throw error; }
  return model;
}

export function createWatercolorOtter(canvas) {
  return createArtworkPlayer(canvas, {
    id: 'otter-watercolor', name: '沐沐', data: referenceAvatarData.otter,
    artUrl: OTTER_LAYERS_URL, faceUrl: OTTER_FACE_URL,
    renderer: 'reference-canvas-2d-layer-rig', paint: paintWatercolorOtter,
  });
}

export function createFeltDandelion(canvas) {
  return createArtworkPlayer(canvas, {
    id: 'dandelion-felt', name: '绒绒', data: referenceAvatarData.dandelion,
    artUrl: DANDELION_SPRITES_URL, faceUrl: DANDELION_FACE_URL,
    renderer: 'reference-prerendered-2d-atlas', paint: paintFeltDandelion,
  });
}

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from '../src/vendor/three.module.js';

const escapeXML = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = value => Number(value.toFixed(2));
const REVIEW_NOTE = '离线几何投影预览，非 WebGL 实测。按真实网格与矩阵投影，使用简化方向光和三角面平均深度排序；不还原 PBR、纹理、阴影或相交透明面的精确遮挡。';

/** CPU-only triangle review. The supplied camera should contain the full rig. */
export function renderProjectedRig(root, camera, { width = 480, height = 600, title = '数字角色几何审查' } = {}) {
  root.updateWorldMatrix(true, true);
  camera.updateProjectionMatrix(); camera.updateWorldMatrix(true, false);
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const light = new THREE.Vector3(-.6, 1, 1).normalize();
  const towardCamera = camera.getWorldDirection(new THREE.Vector3()).negate();
  const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
  const instanceMatrix = new THREE.Matrix4(); const matrix = new THREE.Matrix4();
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const projected = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const normal = new THREE.Vector3(); const edge = new THREE.Vector3(); const center = new THREE.Vector3();
  const base = new THREE.Color(); const instanceColor = new THREE.Color(); const shaded = new THREE.Color();
  const faces = [];
  const stats = { meshes: 0, instances: 0, triangles: 0, drawn: 0, culled: 0, depthClipped: 0, texturedMeshes: 0, projectedBounds: null };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;

  root.traverseVisible(object => {
    if (!object.isMesh || !object.layers.test(camera.layers)) return;
    const geometry = object.geometry; const positions = geometry?.getAttribute('position');
    if (!positions) return;
    stats.meshes++;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some(material => material?.map)) stats.texturedMeshes++;
    const count = geometry.index?.count ?? positions.count;
    const drawStart = Math.max(0, geometry.drawRange.start);
    const drawEnd = Math.min(count, drawStart + geometry.drawRange.count);
    const groups = Array.isArray(object.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (let instance = 0; instance < (object.isInstancedMesh ? object.count : 1); instance++) {
      stats.instances++;
      matrix.copy(object.matrixWorld); instanceColor.set(0xffffff);
      if (object.isInstancedMesh) {
        object.getMatrixAt(instance, instanceMatrix); matrix.multiply(instanceMatrix);
        if (object.instanceColor) object.getColorAt(instance, instanceColor);
      }
      const handedness = matrix.determinant() < 0 ? -1 : 1;
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0];
        if (!material || !material.visible || material.opacity <= 0) continue;
        base.copy(material.color ?? new THREE.Color(0xb0b0b0)).multiply(instanceColor);
        const end = Math.min(drawEnd, group.start + group.count);
        for (let offset = Math.max(drawStart, group.start); offset + 2 < end; offset += 3) {
          stats.triangles++;
          for (let corner = 0; corner < 3; corner++) {
            const index = geometry.index ? geometry.index.getX(offset + corner) : offset + corner;
            object.getVertexPosition(index, vertices[corner]); vertices[corner].applyMatrix4(matrix);
          }
          normal.subVectors(vertices[1], vertices[0]).cross(edge.subVectors(vertices[2], vertices[0]));
          if (normal.lengthSq() < 1e-16) { stats.culled++; continue; }
          normal.normalize().multiplyScalar(handedness);
          center.copy(vertices[0]).add(vertices[1]).add(vertices[2]).multiplyScalar(1 / 3);
          const front = normal.dot(camera.isPerspectiveCamera ? edge.subVectors(cameraPosition, center) : towardCamera) > 0;
          if ((material.side === THREE.FrontSide && !front) || (material.side === THREE.BackSide && front)) { stats.culled++; continue; }
          if (!front) normal.negate();
          for (let corner = 0; corner < 3; corner++) projected[corner].copy(vertices[corner]).applyMatrix4(viewProjection);
          // Auto-framed review cameras avoid crossings. Explicit cameras report
          // omitted near/far crossings instead of drawing misleading polygons.
          if (projected.some(vertex => !Number.isFinite(vertex.x + vertex.y + vertex.z) || vertex.z < -1 || vertex.z > 1)) { stats.depthClipped++; continue; }
          const points = projected.map(vertex => [(vertex.x + 1) * width / 2, (1 - vertex.y) * height / 2]);
          for (const [x, y] of points) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
          shaded.copy(base).multiplyScalar(material.isMeshBasicMaterial ? 1 : .6 + .4 * Math.max(0, normal.dot(light)));
          if (material.emissive) shaded.add(material.emissive.clone().multiplyScalar(material.emissiveIntensity ?? 1));
          const fill = `#${shaded.getHexString(THREE.SRGBColorSpace)}`;
          faces.push({ depth: projected.reduce((sum, vertex) => sum + vertex.z, 0) / 3, path: `<path d="M${points.map(([x, y]) => `${number(x)},${number(y)}`).join('L')}Z" fill="${fill}"${material.opacity < 1 ? ` fill-opacity="${number(material.opacity)}"` : ''}/>` });
        }
      }
    }
  });
  stats.drawn = faces.length;
  if (faces.length) stats.projectedBounds = { left: number(left), top: number(top), right: number(right), bottom: number(bottom), inside: left >= 0 && top >= 0 && right <= width && bottom <= height };
  faces.sort((a, b) => b.depth - a.depth);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 42}" viewBox="0 0 ${width} ${height + 42}"><title>${escapeXML(title)}</title><desc>${escapeXML(REVIEW_NOTE)} ${escapeXML(JSON.stringify(stats))}</desc><defs><clipPath id="review-frame"><rect width="${width}" height="${height}"/></clipPath></defs><rect width="100%" height="100%" fill="#f5f7f2"/><g clip-path="url(#review-frame)">${faces.map(face => face.path).join('')}</g><text x="16" y="${height + 16}" fill="#45604e" font-family="sans-serif" font-size="12">${escapeXML(title)}</text><text x="16" y="${height + 33}" fill="#738474" font-family="sans-serif" font-size="10">离线几何投影 · 非 WebGL 实测 · 简化光照与遮挡</text></svg>`;
  return { svg, stats };
}

/** Same scale in each direction; no per-view rotation or geometry changes. */
export function createReviewCamera(root, view = 'front', aspect = 480 / 600) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  if (bounds.isEmpty()) throw new Error('The rig has no geometry bounds');
  const center = bounds.getCenter(new THREE.Vector3()); const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.y, size.x / aspect, size.z / aspect, .1) * 1.18;
  const distance = Math.max(size.x, size.y, size.z, 1) * 3;
  const camera = new THREE.OrthographicCamera(-span * aspect / 2, span * aspect / 2, span / 2, -span / 2, .01, distance * 3);
  const direction = view === 'side' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, view === 'back' ? -1 : 1);
  camera.position.copy(center).addScaledVector(direction, distance); camera.lookAt(center); camera.updateMatrixWorld(true);
  return camera;
}

async function main() {
  const output = new URL('../artifacts/avatars/', import.meta.url);
  await mkdir(output, { recursive: true });
  for (const [id, name, builder, markup] of [
    ['otter', '沐沐 · 水獭探险家', 'buildOtterRig', 'otterRigMarkup'],
    ['dandelion', '绒绒 · 蒲公英旅行家', 'buildDandelionRig', 'dandelionRigMarkup'],
  ]) {
    const moduleURL = new URL(`../src/components/${id}-avatar.js`, import.meta.url);
    let avatar;
    try { avatar = await import(moduleURL.href); }
    catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes(fileURLToPath(moduleURL))) throw error;
      console.warn(`${id}: module not ready; skipped`); continue;
    }
    if (typeof avatar[markup] === 'function') {
      const svg = avatar[markup]();
      if (!/^\s*<svg\b/.test(svg)) throw new Error(`${markup} did not return SVG markup`);
      await writeFile(new URL(`${id}-2d.svg`, output), svg);
    } else console.warn(`${id}: ${markup} not ready; 2D skipped`);
    if (typeof avatar[builder] !== 'function') { console.warn(`${id}: ${builder} not ready; 3D skipped`); continue; }
    const rig = await avatar[builder]();
    rig.draw?.({ time: 1, emotion: 'neutral', action: 'idle' });
    const root = rig.root ?? rig;
    if (!root?.isObject3D) throw new Error(`${builder} did not return a Three.js root`);
    for (const [view, label] of [['front', '正面'], ['side', '侧面'], ['back', '背面']]) {
      const result = renderProjectedRig(root, createReviewCamera(root, view), { title: `${name} · ${label}` });
      if (!result.stats.drawn) throw new Error(`${id} ${view} has no projected triangles`);
      await writeFile(new URL(`${id}-3d-${view}.svg`, output), result.svg);
      console.log(JSON.stringify({ id, view, ...result.stats }));
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();

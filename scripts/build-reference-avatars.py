#!/usr/bin/env python3
"""Build reference-pixel layers and a 2D felt animation atlas, without AI redraw.

Rebuilds the cutouts first so the layers, atlas and manifest cannot go stale.
Requires Pillow and NumPy in the offline Python environment.
This is a cutout animation pipeline, not a Spine export or a Blender 3D model.
Both runtime and this offline baker use reference-avatar-motion.js poses.
"""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/reference-avatars'
LANCZOS = Image.Resampling.LANCZOS

SPECS = {
    'otter': {
        'headPivot': [510, 448],
        'parts': [
            ('tail', [245, 1060], [(0, 1000), (180, 1000), (278, 1058), (249, 1144), (0, 1183)]),
            ('legL', [325, 1090], [(218, 1110), (394, 1110), (410, 1230), (218, 1230)]),
            ('legR', [560, 1095], [(484, 1104), (717, 1104), (717, 1230), (484, 1230)]),
            ('armR', [698, 575], [(692, 561), (769, 505), (823, 450), (876, 403), (979, 410), (979, 561), (846, 584), (803, 666), (734, 696), (700, 638)]),
            ('scarfTail', [310, 565], [(306, 545), (335, 588), (264, 635), (190, 691), (121, 770), (20, 746), (28, 641), (141, 608), (220, 560)]),
            ('head', [510, 448], [(0, 0), (830, 0), (830, 427), (735, 442), (685, 468), (607, 486), (516, 493), (411, 500), (321, 484), (244, 452), (145, 418), (0, 418)]),
        ],
        'order': ['tail', 'legL', 'legR', 'body', 'armR', 'head', 'scarfTail'],
        'mouth': [521, 285, 139, 83],
        'mouthCenter': [590, 326],
        'eyes': [[425, 262, 59, 62], [627, 195, 57, 61]],
        'eyeClean': [[470, 210, 59, 62], [577, 176, 57, 61]],
        'mouthClean': [472, 361, 139, 83],
        'mouthErase': [(536, 319), (553, 316), (570, 300), (600, 294), (630, 291), (646, 297), (642, 322), (625, 346), (605, 362), (581, 361), (561, 349), (542, 336)],
        'mouthColor': '#725134',
        # Only opaque source pixels at covered joint seams are duplicated.
        # This provides a small underlap, not a second stationary arm/head.
        'jointBridges': [
            [(319, 466), (685, 441), (699, 485), (510, 511), (321, 501)],
            [(684, 550), (725, 552), (754, 634), (709, 651), (685, 615)],
            [(229, 1040), (277, 1048), (278, 1129), (239, 1143)],
            [(218, 1104), (400, 1104), (400, 1123), (218, 1123)],
            [(484, 1098), (707, 1098), (707, 1118), (484, 1118)],
        ],
    },
    'dandelion': {
        'headPivot': [578, 810],
        'parts': [
            ('legL', [491, 1215], [(439, 1228), (543, 1228), (554, 1355), (439, 1355)]),
            ('legR', [584, 1214], [(543, 1228), (635, 1228), (635, 1355), (543, 1355)]),
            ('scarfTail', [485, 865], [(491, 844), (507, 916), (457, 964), (373, 1017), (249, 1085), (112, 1119), (81, 1067), (87, 1007), (206, 969), (349, 920), (421, 877)]),
            ('armR', [752, 954], [(752, 843), (790, 842), (817, 866), (839, 907), (824, 952), (780, 987), (739, 959), (718, 916), (727, 874)]),
            ('head', [578, 810], [(0, 0), (1064, 0), (1064, 781), (831, 781), (794, 789), (757, 805), (707, 809), (653, 806), (585, 808), (521, 810), (464, 802), (417, 789), (371, 778), (320, 785), (0, 819)]),
        ],
        'order': ['legL', 'legR', 'body', 'head', 'scarfTail', 'armR'],
        'mouth': [533, 593, 80, 65],
        'mouthCenter': [572, 622],
        'eyes': [[441, 599, 49, 47], [635, 561, 49, 47]],
        'eyeClean': [[421, 652, 49, 47], [666, 613, 49, 47]],
        'mouthClean': [548, 662, 80, 65],
        'mouthErase': [(542, 604), (599, 600), (605, 627), (589, 644), (555, 644), (540, 630)],
        'mouthColor': '#c56c1c',
        'jointBridges': [
            [(401, 777), (755, 778), (758, 817), (411, 820)],
            [(740, 847), (782, 851), (780, 905), (749, 928), (731, 902)],
            [(445, 1222), (631, 1222), (631, 1241), (445, 1241)],
        ],
    },
}


def polygon_mask(size, points):
    mask = Image.new('L', size)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask


def cut_layers(image, spec):
    occupied = Image.new('L', image.size)
    pieces = []
    # Head ownership wins over small overlaps at the scarf/neck junction.
    masks = {name: polygon_mask(image.size, points) for name, _, points in spec['parts']}
    for name, pivot, _ in reversed(spec['parts']):
        mask = ImageChops.subtract(masks[name], occupied)
        occupied = ImageChops.lighter(occupied, masks[name])
        part = image.copy()
        part.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
        box = part.getbbox()
        if box:
            pieces.append({'name': name, 'pivot': pivot, 'box': box, 'image': part.crop(box)})
    body = image.copy()
    body_mask = ImageChops.invert(occupied)
    # A strict partition produces a pale hairline when separately resampled
    # layers meet at fractional display pixels. Keep 20 source pixels of the
    # covered joint below each moving layer. Grow from the real opaque body,
    # never from the transparent canvas or along a distant hand silhouette.
    source_opaque = image.getchannel('A').point(lambda value: 255 if value == 255 else 0)
    visible_body = ImageChops.multiply(body_mask, source_opaque)
    joint_underlap = ImageChops.multiply(visible_body.filter(ImageFilter.MaxFilter(41)), source_opaque)
    body_mask = ImageChops.lighter(body_mask, joint_underlap)
    bridge_mask = Image.new('L', image.size)
    for points in spec.get('jointBridges', []):
        bridge_mask = ImageChops.lighter(bridge_mask, polygon_mask(image.size, points))
    # Avoid doubling semitransparent paper/wool edges in the neutral pose.
    body_mask = ImageChops.lighter(body_mask, ImageChops.multiply(bridge_mask, source_opaque))
    body.putalpha(ImageChops.multiply(image.getchannel('A'), body_mask))
    box = body.getbbox()
    pieces.append({'name': 'body', 'pivot': [0, 0], 'box': box, 'image': body.crop(box)})
    by_name = {piece['name']: piece for piece in pieces}
    return [by_name[name] for name in spec['order'] if name in by_name]


def pack(images, max_width=2048, padding=4):
    positions, x, y, row_height = [], padding, padding, 0
    for image in images:
        if x + image.width + padding > max_width:
            x, y, row_height = padding, y + row_height + padding, 0
        positions.append((x, y))
        x += image.width + padding
        row_height = max(row_height, image.height)
    width = max(x + image.width + padding for image, (x, y) in zip(images, positions))
    height = max(y + image.height + padding for image, (x, y) in zip(images, positions))
    atlas = Image.new('RGBA', (width, height))
    for image, point in zip(images, positions):
        atlas.alpha_composite(image, point)
    return atlas, positions


def make_faces(source, spec, key):
    """Only the mouth and blink areas change; retain surrounding original fibers."""
    original = source.convert('RGBA')
    x, y, w, h = spec['mouth']
    mouth = original.crop((x, y, x+w, y+h))
    cx, cy, cw, ch = spec['mouthClean']
    clean = original.crop((cx, cy, cx+cw, cy+ch)).resize((w, h), LANCZOS)
    erase = polygon_mask((w, h), [(px-x, py-y) for px, py in spec['mouthErase']]).filter(ImageFilter.GaussianBlur(3))
    cleaned = Image.composite(clean, mouth, erase)
    patches = []
    mx, my = spec['mouthCenter'][0]-x, spec['mouthCenter'][1]-y
    color = spec['mouthColor']
    for expression in ['neutral', 'happy', 'curious', 'concerned', 'talk0', 'talk1', 'talk2']:
        if expression == 'happy' or (key == 'dandelion' and expression == 'neutral'):
            patch = mouth.copy()
        else:
            patch = cleaned.copy()
            draw = ImageDraw.Draw(patch)
            if expression in ['neutral', 'concerned', 'talk0']:
                half = 18 if key == 'otter' else 16
                depth = 3 if expression == 'concerned' else 7
                # A shallow upward smile; concern is never a downturned frown.
                points = [(mx-half+i*half/20, my + depth*(1-((i-20)/20)**2)) for i in range(41)]
                draw.line(points, fill=color, width=4 if key == 'otter' else 3, joint='curve')
            else:
                half = 14 if key == 'otter' else 8
                ry = (12 if expression in ['curious', 'talk1'] else 20) if key == 'otter' else (7 if expression in ['curious', 'talk1'] else 12)
                draw.ellipse((mx-half, my-ry*.45, mx+half, my+ry), fill='#74503a' if key == 'otter' else '#9d551d')
                if expression == 'talk2':
                    draw.ellipse((mx-half*.6, my+ry*.4, mx+half*.6, my+ry*.9), fill='#e9a078' if key == 'otter' else '#e4a14e')
        patches.append((expression, patch))
    eyes = []
    for index, (rect, clean_rect) in enumerate(zip(spec['eyes'], spec['eyeClean'])):
        ex, ey, ew, eh = rect
        patch = original.crop((ex, ey, ex+ew, ey+eh))
        qx, qy, qw, qh = clean_rect
        texture = original.crop((qx, qy, qx+qw, qy+qh)).resize((ew, eh), LANCZOS)
        mask = Image.new('L', (ew, eh))
        ImageDraw.Draw(mask).ellipse((ew*.12, eh*.08, ew*.87, eh*.89), fill=255)
        if key == 'dandelion':
            # A cheek sample carries orange blush into the cream eye area.
            # Recover the eye's local colour from its own boundary instead;
            # retain only fine felt fibers from the neighbouring clean sample.
            pixels = np.asarray(patch.convert('RGB'), dtype=np.float32)
            interior = np.asarray(mask) > 0
            recovered = pixels.copy()
            recovered[interior] = np.mean(pixels[~interior], axis=0)
            for _ in range(600):
                average = (np.roll(recovered, 1, axis=0) + np.roll(recovered, -1, axis=0)
                           + np.roll(recovered, 1, axis=1) + np.roll(recovered, -1, axis=1)) / 4
                recovered[interior] = average[interior]
            detail = (np.asarray(texture.convert('RGB'), dtype=np.float32)
                      - np.asarray(texture.convert('RGB').filter(ImageFilter.GaussianBlur(2)), dtype=np.float32))
            recovered[interior] += detail[interior] * .6
            texture = Image.fromarray(np.uint8(np.clip(recovered, 0, 255))).convert('RGBA')
        patch = Image.composite(texture, patch, mask.filter(ImageFilter.GaussianBlur(3)))
        draw = ImageDraw.Draw(patch)
        eye_color = color if key == 'otter' else '#77471f'
        draw.arc((ew*.25, eh*.29, ew*.78, eh*.66), 5, 165, fill=eye_color, width=4)
        blink = patch
        # Keep the same recovered felt/watercolor around a separate happy eye.
        happy = Image.composite(texture, original.crop((ex, ey, ex+ew, ey+eh)), mask.filter(ImageFilter.GaussianBlur(3)))
        ImageDraw.Draw(happy).arc((ew*.23, eh*.32, ew*.8, eh*.75), 190, 350, fill=eye_color, width=4)
        eyes.append((rect, blink, happy))
    eye_images = [image for _, blink, happy in eyes for image in [blink, happy]]
    atlas, positions = pack([patch for _, patch in patches] + eye_images, max_width=1024)
    atlas.save(OUT/f'{key}-face.png', optimize=True)
    entries = {}
    for (name, patch), (ax, ay) in zip(patches, positions):
        entries[name] = {'x': ax, 'y': ay, 'width': patch.width, 'height': patch.height}
    eye_entries = []
    for index, (rect, blink, happy) in enumerate(eyes):
        bx, by = positions[len(patches)+index*2]
        hx, hy = positions[len(patches)+index*2+1]
        eye_entries.append({'rect': rect,
            'patch': {'x': bx, 'y': by, 'width': blink.width, 'height': blink.height},
            'happyPatch': {'x': hx, 'y': hy, 'width': happy.width, 'height': happy.height}})
    return {'pivot': spec['headPivot'], 'mouth': {'rect': spec['mouth'], 'patches': entries}, 'eyes': eye_entries}


def render_pose(pieces, pose, fit, size):
    frame = Image.new('RGBA', size)
    sc, ox, oy = fit['scale'], fit['offsetX'], fit['offsetY']
    for piece in pieces:
        name = piece['name']
        bone = pose.get(name, {})
        angle, sx, sy = bone.get('rotation', 0), bone.get('scaleX', 1), bone.get('scaleY', 1)
        px, py = piece['pivot']
        x, y, _, _ = piece['box']
        c, s, ry = math.cos(angle), math.sin(angle), pose.get('rootY', 0)
        a, b = c/(sc*sx), s/(sc*sx)
        d, e = -s/(sc*sy), c/(sc*sy)
        tx = px-x-(c*(ox/sc+px)+s*(oy/sc+ry+py))/sx
        ty = py-y+(s*(ox/sc+px)-c*(oy/sc+ry+py))/sy
        transformed = piece['image'].transform(size, Image.Transform.AFFINE, (a, b, tx, d, e, ty), Image.Resampling.BICUBIC)
        frame.alpha_composite(transformed)
    return frame


def bake_dandelion(image, pieces, face):
    fw, fh = 288, 400
    scale = min((fw-16)/image.width, (fh-16)/image.height)
    fit = {'scale': scale, 'offsetX': (fw-image.width*scale)/2, 'offsetY': (fh-image.height*scale)/2}
    # Complete cycles close the walk/wave seam. Idle is slow and restrained.
    sequences = [('idle', 16, 2*math.pi/1.7), ('walk', 12, 2*math.pi/7), ('wave', 12, 2*math.pi/6), ('point', 1, 0)]
    requests = [{'time': i/count*duration, 'parameters': {'action': action}, 'height': image.height}
                for action, count, duration in sequences for i in range(count)]
    code = "import { sampleReferencePose } from './src/components/reference-avatar-motion.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(JSON.parse(s).map(r=>sampleReferencePose(r.time,r.parameters,r.height))));"
    result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, input=json.dumps(requests), capture_output=True, text=True, check=True)
    poses = json.loads(result.stdout)
    frames, actions, images = [], {}, []
    cursor = 0
    for action, count, _ in sequences:
        actions[action] = []
        for _ in range(count):
            actions[action].append(cursor)
            images.append(render_pose(pieces, poses[cursor], fit, (fw, fh)))
            frames.append({'x': (cursor % 6)*fw, 'y': (cursor//6)*fh, 'pose': poses[cursor]})
            cursor += 1
    sheet = Image.new('RGBA', (fw*6, fh*math.ceil(len(images)/6)))
    for image_frame, frame in zip(images, frames):
        sheet.alpha_composite(image_frame, (frame['x'], frame['y']))
    sheet.save(OUT/'dandelion-sprites.png', optimize=True)
    images[0].save(OUT/'dandelion-preview.png', optimize=True)
    return {'width': image.width, 'height': image.height, 'frameWidth': fw, 'frameHeight': fh,
            'frameRate': 12, 'fit': fit, 'frames': frames, 'actions': actions, 'face': face,
            'actionDurations': {action: duration for action, _, duration in sequences},
            'source': 'design/digit-hum-2.png', 'dimensionality': '2d', 'bakeMethod': 'reference-image-cutout-rig'}


def make_reviews(artworks):
    """Save offline contact sheets from the exact same source layers and poses."""
    destination = ROOT/'artifacts/avatars'
    destination.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=18)
    small = ImageFont.load_default(size=13)
    actions = [('idle', 0), ('walk', math.pi/14), ('wave', math.pi/12), ('point', 0)]
    requests = [{'time': time, 'parameters': {'action': action}, 'height': source.height}
                for source, _ in artworks.values() for action, time in actions]
    code = "import { sampleReferencePose } from './src/components/reference-avatar-motion.js';let s='';for await(const c of process.stdin)s+=c;process.stdout.write(JSON.stringify(JSON.parse(s).map(r=>sampleReferencePose(r.time,r.parameters,r.height))));"
    result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, input=json.dumps(requests), capture_output=True, text=True, check=True)
    poses = json.loads(result.stdout)
    sheet = Image.new('RGBA', (1200, 886), '#f6f3e9')
    draw = ImageDraw.Draw(sheet)
    draw.text((18, 10), 'REFERENCE ARTWORK / LOCAL CUTOUT ANIMATION', font=font, fill='#354c45')
    draw.text((18, 34), 'Offline pixel-layer review. A 2D animation, not a reconstructed 3D asset.', font=small, fill='#647269')
    neutral = Image.new('RGBA', (640, 474), '#e7eddc')
    neutral_draw = ImageDraw.Draw(neutral)
    for row, (key, (source, pieces)) in enumerate(artworks.items()):
        scale = min(280/source.width, 380/source.height)
        fit = {'scale': scale, 'offsetX': (300-source.width*scale)/2, 'offsetY': (400-source.height*scale)/2}
        for column, (action, _) in enumerate(actions):
            tile = Image.new('RGBA', (300, 400), '#e7eddc' if row == 0 else '#354b4f')
            for x in range(0, 300, 40):
                ImageDraw.Draw(tile).line((x, 0, x, 400), fill='#dfe6d2' if row == 0 else '#3d5356')
            frame = render_pose(pieces, poses[row*len(actions)+column], fit, (300, 400))
            tile.alpha_composite(frame)
            sheet.alpha_composite(tile, (column*300, 64+row*411))
            draw.text((column*300+12, 70+row*411), f'{key.upper()} / {action}', font=small,
                      fill='#354c45' if row == 0 else '#e7eddc')
        x = row*320
        neutral_draw.text((x+20, 15), 'Watercolor otter' if key == 'otter' else 'Felt dandelion', font=font, fill='#354c45')
        frame = render_pose(pieces, {'rootY': 0}, fit, (300, 400))
        neutral.alpha_composite(frame, (x+10, 46))
    sheet.convert('RGB').save(destination/'reference-artwork-motions.png', optimize=True)
    neutral.convert('RGB').save(destination/'reference-artwork-preview.png', optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(ROOT/'scripts/prepare-reference-cutouts.py')], cwd=ROOT, check=True)
    data, artworks = {}, {}
    for key, spec in SPECS.items():
        source = Image.open(OUT/f'{key}-cutout.png').convert('RGBA')
        pieces = cut_layers(source, spec)
        artworks[key] = (source, pieces)
        raw = Image.open(ROOT/'public/design'/('digit-hum-1.jpg' if key == 'otter' else 'digit-hum-2.png'))
        face = make_faces(raw, spec, key)
        if key == 'otter':
            atlas, positions = pack([piece['image'] for piece in pieces])
            atlas.save(OUT/'otter-layers.png', optimize=True)
            layers = []
            for piece, (ax, ay) in zip(pieces, positions):
                x, y, right, bottom = piece['box']
                layers.append({'name': piece['name'], 'x': x, 'y': y, 'width': right-x, 'height': bottom-y,
                               'atlasX': ax, 'atlasY': ay, 'pivot': piece['pivot']})
            data[key] = {'width': source.width, 'height': source.height, 'layers': layers, 'order': spec['order'],
                         'face': face, 'source': 'design/digit-hum-1.jpg', 'dimensionality': '2d'}
            scale = min(288/source.width, 400/source.height)
            fit = {'scale': scale, 'offsetX': (288-source.width*scale)/2, 'offsetY': (400-source.height*scale)/2}
            preview = render_pose(pieces, {'rootY': 0}, fit, (288, 400))
            preview.save(OUT/'otter-preview.png', optimize=True)
        else:
            data[key] = bake_dandelion(source, pieces, face)
    data_path = ROOT/'src/data/reference-avatar-data.js'
    data_path.write_text('// Generated by scripts/build-reference-avatars.py. Source artwork pixels, not a 3D reconstruction.\nexport const referenceAvatarData = '+json.dumps(data, ensure_ascii=False, separators=(',', ':'))+';\n')
    provenance = {'schemaVersion': 1,
                  'method': 'deterministic-reference-pixel-cutout-and-2d-atlas',
                  'dimensionality': '2d', 'sources': {}, 'generators': {}, 'outputs': {}}
    for source in [ROOT/'public/design/digit-hum-1.jpg', ROOT/'public/design/digit-hum-2.png']:
        provenance['sources'][str(source.relative_to(ROOT))] = hashlib.sha256(source.read_bytes()).hexdigest()
    for generator in [ROOT/'scripts/prepare-reference-cutouts.py', Path(__file__).resolve(), ROOT/'src/components/reference-avatar-motion.js']:
        provenance['generators'][str(generator.relative_to(ROOT))] = hashlib.sha256(generator.read_bytes()).hexdigest()
    provenance['animationData'] = {'path': str(data_path.relative_to(ROOT)), 'sha256': hashlib.sha256(data_path.read_bytes()).hexdigest()}
    for path in sorted(OUT.glob('*.png')):
        with Image.open(path) as image:
            provenance['outputs'][path.name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'size': list(image.size), 'bytes': path.stat().st_size}
    (OUT/'manifest.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2)+'\n')
    make_reviews(artworks)
    print('Built original-pixel otter layers and 41 felt cutout-animation frames; '+str(data_path.relative_to(ROOT)))


if __name__ == '__main__':
    main()

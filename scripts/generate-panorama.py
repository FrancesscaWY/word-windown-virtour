"""Generate a seamless 2:1 equirectangular calibration illustration, not a site photograph.

Optional regeneration needs Pillow. The checked-in PNG needs no runtime dependency.
"""
from pathlib import Path
import hashlib
import json
import math
import random
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 2048, 1024
random.seed(42)
image = Image.new('RGB', (WIDTH, HEIGHT))
draw = ImageDraw.Draw(image)

def mix(a, b, t):
    return tuple(round(x * (1 - t) + y * t) for x, y in zip(a, b))

for y in range(HEIGHT):
    if y < HEIGHT // 2:
        color = mix((103, 157, 177), (218, 232, 211), (y / (HEIGHT / 2)) ** .65)
    else:
        color = mix((171, 187, 128), (61, 101, 74), ((y - HEIGHT / 2) / (HEIGHT / 2)) ** .55)
    draw.line((0, y, WIDTH, y), fill=color)

# All horizon objects stay away from the seam; the poles remain uniform.
for x, y, scale in [(175, 270, .7), (580, 330, .8), (1340, 260, .65), (1730, 360, .7)]:
    for offset, radius in [(-60, 26), (-20, 38), (30, 31), (68, 20)]:
        cx = x + int(offset * scale)
        ry = int(radius * scale)
        draw.ellipse((cx - ry * 2, y - ry, cx + ry * 2, y + ry), fill=(225, 235, 218))
draw.ellipse((1500, 175, 1566, 241), fill=(249, 231, 170))

for i in range(30):
    x = 55 + i * 66
    peak = 450 + int(math.sin(i * .7) * 16)
    draw.polygon([(x - 50, 520), (x - 18, peak), (x + 15, peak + 10), (x + 55, 520)], fill=(139, 165, 119))

# A non-real, original miniature architectural garden.
for x in [110, 340, 625, 1355, 1620, 1870]:
    draw.rectangle((x - 27, 463, x + 27, 521), fill=(208, 192, 153))
    draw.polygon([(x - 37, 465), (x, 435), (x + 37, 465)], fill=(157, 137, 112))
    for j in [-14, 3]:
        draw.rectangle((x + j, 480, x + j + 10, 500), fill=(124, 150, 126))

draw.polygon([(930, 516), (1118, 516), (1360, 925), (688, 925)], fill=(204, 198, 156))
draw.polygon([(966, 516), (1082, 516), (1235, 925), (813, 925)], fill=(229, 218, 175))
for y in [575, 635, 735, 860]:
    half = 58 + (y - 516) * .35
    draw.line((1024-half, y, 1024+half, y), fill=(201, 191, 152), width=2)

# Stylized tower; a test-scene motif only, not a survey of the Eiffel Tower.
draw.polygon([(1016, 300), (1032, 300), (1040, 389), (1067, 464), (1100, 524), (1069, 524), (1024, 466), (979, 524), (948, 524), (981, 464), (1008, 389)], fill=(122, 111, 80))
draw.polygon([(1020, 315), (1028, 315), (1033, 389), (1015, 389)], fill=(218, 197, 144))
draw.polygon([(1010, 401), (1038, 401), (1054, 449), (994, 449)], fill=(215, 195, 146))
draw.line((1024, 280, 1024, 303), fill=(103, 107, 77), width=4)
draw.line((1002, 390, 1046, 390), fill=(92, 101, 72), width=7)
draw.line((976, 463, 1072, 463), fill=(92, 101, 72), width=8)
for a, b in [((1010, 404), (1048, 445)), ((1038, 404), (1000, 445)), ((988, 477), (1069, 516)), ((1060, 477), (979, 516))]:
    draw.line((*a, *b), fill=(99, 102, 73), width=3)

for x in [75, 240, 485, 735, 1280, 1475, 1720, 1955]:
    size = 38 + random.randint(0, 16)
    draw.rectangle((x-3, 486, x+4, 563), fill=(115, 116, 77))
    for dx, dy, radius in [(-16, -20, size-10), (13, -24, size-6), (0, -48, size-12)]:
        draw.ellipse((x+dx-radius, 503+dy-radius, x+dx+radius, 503+dy+radius), fill=(87, 132, 89))
    draw.ellipse((x-26, 550, x+26, 560), fill=(112, 146, 94))

output = ROOT / 'public/assets/demo-panorama.png'
output.parent.mkdir(parents=True, exist_ok=True)
image.save(output, optimize=True)
manifest = {
    'id': 'procedural-garden-360', 'file': 'demo-panorama.png',
    'width': WIDTH, 'height': HEIGHT, 'projection': 'equirectangular',
    'source': 'Original deterministic procedural illustration from scripts/generate-panorama.py',
    'license': 'CC0-1.0', 'realSitePhotography': False,
    'displayLabel': '原创程序生成的 360° 测试场景 · 非世界之窗实拍',
    'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
}
(output.parent / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'Generated {output.name}: {WIDTH}x{HEIGHT}, {output.stat().st_size} bytes')

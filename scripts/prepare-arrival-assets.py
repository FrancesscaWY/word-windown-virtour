"""Derive web assets from the supplied designs; originals are never modified."""
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
import hashlib
import json
from PIL import Image, ImageOps, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public/design'
OUTPUT = ROOT / 'public/assets/arrival'
OUTPUT.mkdir(parents=True, exist_ok=True)


def save(image, name, width=None):
    if width and image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
    image.save(OUTPUT / name, optimize=True)


def lift_paper(image, paper, threshold, gain, feather=24):
    """Keep painted pigment, rather than a rectangular piece of reference paper.

    The reference's pale paper has very little pigment in any channel. Use its
    local white point to form a soft matte; feather the already cropped artwork
    so the original cut edges cannot become visible on another background.
    """
    image = image.copy().convert('RGBA')
    pixels = []
    width, height = image.size
    for index, (red, green, blue, alpha) in enumerate(image.getdata()):
        pigment = max((base - channel) / base for base, channel in zip(paper, (red, green, blue)))
        opacity = max(0, min(1, (pigment - threshold) * gain))
        x, y = index % width, index // width
        edge = min(1, x / feather, (width - 1 - x) / feather,
                   y / feather, (height - 1 - y) / (feather * 1.8))
        # Smoothstep avoids a new visible boundary at the end of the feather.
        edge = max(0, edge)
        edge = edge * edge * (3 - 2 * edge)
        pixels.append((red, green, blue, round(alpha * opacity * edge)))
    image.putdata(pixels)
    return image


with ZipFile(SOURCE / '介绍页.zip') as archive:
    images = {}
    for item in archive.infolist():
        if item.filename.startswith('__MACOSX/') or not item.filename.endswith('.png'):
            continue
        # The supplied macOS ZIP has UTF-8 names without the UTF-8 flag.
        try:
            name = item.filename.encode('cp437').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            name = item.filename
        images[name.rsplit('/', 1)[-1]] = Image.open(BytesIO(archive.read(item))).convert('RGBA')

    def find(stamp):
        matches = [image for name, image in images.items() if stamp in name]
        if len(matches) != 1:
            raise ValueError(f'Expected one supplied image matching {stamp}')
        return matches[0]

    title = find('6.50.54')
    save(title, 'welcome-title.png')
    # Preserve the supplied lettering, but let the two columns be composed
    # independently: the original companion column extends below the main one.
    save(title.crop((0, 0, 117, 534)), 'welcome-title-main.png')
    save(title.crop((164, 312, 298, 696)), 'welcome-title-companion.png')
    save(find('6.50.43'), 'welcome-invitation.png')
    save(find('6.50.19'), 'welcome-guide.png')
    save(find('6.50.36'), 'welcome-arrows.png')
    background = find('6.51.27')
    # The wash and skyline are separate layers, with no second copy of the skyline.
    save(background.crop((0, 0, 2182, 1530)), 'welcome-background.png', 1000)
    skyline = lift_paper(background.crop((540, 1510, 1590, 2966)),
                         (247, 243, 232), .025, 10, feather=54)
    save(skyline, 'welcome-landmarks.png', 650)

design = Image.open(SOURCE / 'yindao.png').convert('RGBA')


def feather_crop(box, name, feather=16, remove_paper=False):
    image = design.crop(box)
    if remove_paper:
        save(lift_paper(image, (254, 234, 209), .055, 8.5, feather), name)
        return
    mask = Image.new('L', image.size, 255)
    draw = ImageDraw.Draw(mask)
    for edge in range(feather):
        value = round(255 * edge / feather)
        draw.rectangle((edge, edge, image.width - edge - 1, image.height - edge - 1), outline=value)
    image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    save(image, name)


feather_crop((50, 355, 802, 702), 'mode-interactive.png', remove_paper=True)
feather_crop((56, 882, 797, 1134), 'mode-immersive.png', remove_paper=True)
feather_crop((50, 1305, 802, 1577), 'mode-companion.png', remove_paper=True)
feather_crop((0, 0, 332, 159), 'leaves.png', 8, remove_paper=True)
feather_crop((0, 1716, 852, 1846), 'meadow.png', 8)

# Mirror a text-free patch to make a seamless, local paper texture.
patch = design.crop((356, 12, 612, 140)).convert('RGB')
texture = Image.new('RGB', (patch.width * 2, patch.height * 2))
texture.paste(patch, (0, 0))
texture.paste(ImageOps.mirror(patch), (patch.width, 0))
texture.paste(ImageOps.flip(patch), (0, patch.height))
texture.paste(ImageOps.flip(ImageOps.mirror(patch)), (patch.width, patch.height))
# Retain the grain without the reference screenshot's strong orange cast.
texture = Image.blend(Image.new('RGB', texture.size, '#fbf6ea'), texture, .18)
save(texture, 'paper.png')

manifest = {
    'source': 'User-supplied public/design/介绍页.zip and public/design/yindao.png',
    'changes': 'Original title and mascot; resized crops, soft pigment mattes to remove paper rectangles, feathered edges, lightened mirrored paper texture; no generated replacement artwork.',
    'files': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(OUTPUT.glob('*.png'))},
}
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'Prepared {len(manifest["files"])} arrival assets in {OUTPUT}')

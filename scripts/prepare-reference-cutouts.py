#!/usr/bin/env python3
"""Reproduce the transparent animal artwork from the supplied reference pixels.

Requires Pillow and NumPy (both are in the bundled workspace Python runtime).
No model download, background service, or image generation is used. The source
dimensions stay unchanged so that the animation layers use source coordinates.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets/reference-avatars"


def composite_foreground(rgb, background, alpha):
    """Remove the old paper/studio tint from soft boundary pixels."""
    alpha = np.clip(alpha, 0, 1)
    foreground = np.clip(
        (rgb - background * (1 - alpha[:, :, None]))
        / np.maximum(alpha, 0.04)[:, :, None],
        0,
        255,
    )
    # RGB under zero alpha is not visible, but retaining the divided backdrop
    # there bloats the PNG and produces misleading colored noise in viewers
    # which inspect the RGB planes. Do not discard any nonzero fiber alpha.
    foreground[alpha < 1 / 255] = 0
    result = Image.fromarray(foreground.astype("uint8")).convert("RGBA")
    result.putalpha(Image.fromarray((alpha * 255).astype("uint8")))
    return result


def extract_otter(source):
    rgb = np.asarray(source.convert("RGB"), dtype=float)
    height, width = rgb.shape[:2]
    distance = 255 - rgb.min(axis=2)

    # Flood only paper that reaches a canvas edge. Closed cream highlights
    # inside the watercolor drawing stay opaque. copy() is required because
    # an array-backed Pillow image can otherwise be read-only to floodfill.
    paper = Image.fromarray((distance < 45).astype("uint8") * 255).copy()
    for point in [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]:
        ImageDraw.floodfill(paper, point, 128, thresh=0)
    silhouette = Image.fromarray((np.asarray(paper) != 128).astype("uint8") * 255)
    core = np.asarray(
        silhouette.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(0.8)),
        dtype=float,
    ) / 255
    alpha = np.maximum(np.clip((distance - 3) / 70, 0, 1), core)
    # Neutral paper at the outer edge is transparent, but the goggles and
    # hat contain real gray/white paint highlights inside the solid drawing.
    alpha[(rgb.max(axis=2) - rgb.min(axis=2) < 2) & (core < 0.5)] = 0
    return composite_foreground(rgb, np.full_like(rgb, 255), alpha)


def extract_dandelion(source):
    rgb = np.asarray(source.convert("RGB"), dtype=float)
    height, width = rgb.shape[:2]
    yy, xx = np.mgrid[0:height, 0:width]
    x = (xx - width / 2) / width
    y = (yy - height / 2) / height

    # The studio backdrop is warm and gently graded, rather than white. Fit
    # its color field from the empty canvas edges, then recover fiber alpha
    # from the green/blue residual. A simple white chroma key loses the wool.
    samples = (xx < 0.065 * width) | (xx > 0.95 * width) | (yy < 0.012 * height)
    basis = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=-1)
    coefficients = np.linalg.lstsq(basis[samples][::10], rgb[samples][::10], rcond=None)[0]
    background = basis @ coefficients
    distance = np.maximum(background[:, :, 1] - rgb[:, :, 1], background[:, :, 2] - rgb[:, :, 2])
    alpha = np.clip((distance - 3) / 14, 0, 1)

    # Hand-reviewed opaque interior regions prevent bright felt and seed
    # highlights being mistaken for the equally bright studio backdrop.
    core = Image.new("L", (width, height))
    draw = ImageDraw.Draw(core)
    for ellipse in [
        (355, 475, 725, 775),
        (250, 342, 825, 830),
        (314, 875, 786, 1225),
        (468, 845, 640, 973),
        (723, 845, 811, 973),
        # The white lighthouse dome matches the pale studio backdrop. Its
        # interior is painted felt, not a hole in the landmark crown.
        (675, 240, 723, 279),
    ]:
        draw.ellipse(ellipse, fill=255)
    draw.polygon([
        (687, 265), (719, 270), (718, 296), (709, 322),
        (695, 345), (679, 347), (674, 325), (679, 292),
    ], fill=255)
    # Likewise the bright metal camera plate belongs to the solid camera.
    draw.polygon([
        (598, 820), (644, 813), (721, 812), (753, 818),
        (757, 850), (746, 924), (596, 934), (589, 850),
    ], fill=255)
    for cx, cy, radius in [
        (156, 519, 23), (344, 465, 20), (441, 388, 21),
        (591, 358, 25), (735, 426, 22), (822, 569, 21),
        (881, 588, 11), (856, 694, 18), (266, 586, 21),
    ]:
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=255)
    alpha = np.maximum(alpha, np.asarray(core.filter(ImageFilter.GaussianBlur(2)), dtype=float) / 255)

    # Exclude the photographed floor/contact shadow while retaining the two
    # small feet, and preserve the transparent gap between the lower legs.
    feet = Image.new("L", (width, height))
    draw = ImageDraw.Draw(feet)
    draw.polygon([
        (449, 1210), (492, 1214), (520, 1242), (544, 1272),
        (553, 1303), (543, 1327), (524, 1334), (496, 1331),
        (478, 1316), (463, 1288), (451, 1250),
    ], fill=255)
    draw.polygon([
        (552, 1209), (615, 1207), (620, 1232), (614, 1263),
        (609, 1282), (611, 1309), (598, 1324), (570, 1327),
        (550, 1318), (542, 1298), (543, 1274),
    ], fill=255)
    feet_alpha = np.asarray(feet.filter(ImageFilter.GaussianBlur(1.3)), dtype=float) / 255
    alpha = np.where(yy > 1231, np.minimum(alpha, feet_alpha), alpha)
    alpha[(xx < 65) | (xx > 950)] = 0

    # Keep fine low-opacity wool around the connected character silhouette,
    # while removing faint isolated residuals in the distant studio backdrop.
    # Closing 1px gaps retains the thin seed stems; a 20px perimeter leaves
    # the wispy fur and tiny seed balls untouched at the original resolution.
    support = Image.fromarray((alpha > 50 / 255).astype("uint8") * 255)
    support = support.filter(ImageFilter.MaxFilter(3)).copy()
    ImageDraw.floodfill(support, (550, 650), 128, thresh=0)
    connected = Image.fromarray((np.asarray(support) == 128).astype("uint8") * 255)
    nearby = np.asarray(connected.filter(ImageFilter.MaxFilter(41))) > 0
    alpha[~nearby] = 0
    return composite_foreground(rgb, background, alpha)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, name, extractor in [
        ("digit-hum-1.jpg", "otter", extract_otter),
        ("digit-hum-2.png", "dandelion", extract_dandelion),
    ]:
        with Image.open(ROOT / "public/design" / filename) as source:
            result = extractor(source)
        destination = OUTPUT / f"{name}-cutout.png"
        result.save(destination, optimize=True)
        print(f"{destination.relative_to(ROOT)} {result.width}×{result.height} RGBA")


if __name__ == "__main__":
    main()

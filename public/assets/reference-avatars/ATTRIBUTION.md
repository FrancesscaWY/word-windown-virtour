# Reference-derived animal artwork

- `otter-cutout.png` is derived from the user-supplied `public/design/digit-hum-1.jpg` (979 × 1230).
- `dandelion-cutout.png` is derived from the user-supplied `public/design/digit-hum-2.png` (1064 × 1478).

These transparent PNGs retain the source artwork pixels. They are background mattes, with edge-color decontamination and hand-reviewed opaque interior/foot masks; they are not AI redraws. Original references are unchanged. Canvas dimensions and coordinates are retained for reproducible animation-layer extraction.

The watercolor reference uses an edge-connected white-paper mask. The felt reference uses a quadratic warm-background color fit, a soft fiber matte, opaque felt-highlight masks, and separate foot silhouettes to exclude the photographed floor shadow. Fine fur/background separation from one flattened image is approximate at the outermost transparent fibers.

Rebuild the complete asset set with the bundled Python runtime (Pillow and NumPy):

```sh
/home/francessca/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build-reference-avatars.py
```

The builder first runs `prepare-reference-cutouts.py`, then creates the otter layer atlas, felt animation atlas, facial patches, previews, runtime coordinates and `manifest.json`. The manifest records source, generator and output hashes so these files can be checked as one asset set.

`otter-layers.png` retains the supplied watercolor pixels in head, arm, feet, scarf, tail and body layers. The local Canvas player applies small joint transforms with separate foot lanes. This is a custom cutout player, not a Spine editor export or commercial Spine runtime.

`dandelion-sprites.png` contains 41 transparent frames baked offline from the supplied felt artwork layers. The local Canvas player selects frames at each action's authored duration and overlays expression patches. This is a 2D artwork atlas, not a Blender model or renders of a reconstructed 3D character. Both new avatars retain the source-facing view; no back view or free rotation is supplied. Mouth patches follow speech playback state, not inferred phonemes.

Source usage rights remain those of the user-provided references; no third-party stock assets or model downloads were added.

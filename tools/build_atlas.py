"""Build the Chog map sprite atlases from the local 96px thumbnails.

Reads  ../../web/public/chogs/<tokenId>.webp   (READ-ONLY, never written)
Writes ../public/img/atlas-24.webp, atlas-48.webp, atlas.json

Grid: 45 columns, tile index = tokenId - 1, row-major.
Run:  python tools/build_atlas.py
"""
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "..", "web", "public", "chogs"))
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "img"))
N = 1969
COLS = 45
ROWS = (N + COLS - 1) // COLS
# size -> (webp quality, byte budget)
SIZES = {24: (82, 600_000), 48: (80, 2_500_000)}


def load(tid):
    p = os.path.join(SRC, f"{tid}.webp")
    try:
        im = Image.open(p)
        im.load()
        return im.convert("RGB")
    except Exception as e:  # missing thumb -> night tile
        print(f"  ! token {tid}: {e}", file=sys.stderr)
        return Image.new("RGB", (96, 96), (14, 9, 28))


def main():
    os.makedirs(OUT, exist_ok=True)
    thumbs = [load(t) for t in range(1, N + 1)]
    meta = {"cols": COLS, "rows": ROWS, "n": N, "sizes": []}
    for size, (q, budget) in SIZES.items():
        sheet = Image.new("RGB", (COLS * size, ROWS * size), (14, 9, 28))
        for i, im in enumerate(thumbs):
            tile = im if im.size == (size, size) else im.resize((size, size), Image.Resampling.BOX if size < 96 else Image.Resampling.LANCZOS)
            sheet.paste(tile, ((i % COLS) * size, (i // COLS) * size))
        path = os.path.join(OUT, f"atlas-{size}.webp")
        while True:
            sheet.save(path, "WEBP", quality=q, method=6)
            kb = os.path.getsize(path)
            if kb <= budget or q <= 40:
                break
            q -= 6
        print(f"atlas-{size}.webp  {sheet.size[0]}x{sheet.size[1]}  q={q}  {kb / 1024:.0f} KB")
        meta["sizes"].append(size)
    with open(os.path.join(OUT, "atlas.json"), "w") as f:
        json.dump(meta, f)
    print("atlas.json", meta)


if __name__ == "__main__":
    main()

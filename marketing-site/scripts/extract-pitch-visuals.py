#!/usr/bin/env python3
"""
Extract product UI crops from the pitch deck PDF.

Region coordinates are defined for a 1920×1080 pixmap (fitz Matrix(2, 2)).
The PDF mediabox is 960×540 pt — scale coords with RENDER_SCALE / COORD_REF_SCALE.
"""

from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PDF = Path("/Users/rubenjohanneselge/Downloads/Index_Casting_Pitch_Deck_Innsbruck.pdf")
OUT = ROOT / "public" / "images" / "product"

# Slide background (pitch deck) — trim this so presentation copy disappears
SLIDE_BG = (236, 234, 230)

# (page_1based, left, top, right, bottom) @ 1920×1080 reference
REGIONS: dict[str, tuple[int, int, int, int, int]] = {
    # Slide 1 — UI cluster only (no logo glyph / slide copy on the left)
    "hero-stack": (1, 855, 72, 1905, 1010),
    # Slide 2 — fragmented tools (each window isolated)
    "problem-options": (2, 505, 34, 1048, 348),
    "problem-calendar": (2, 722, 40, 1338, 418),
    "problem-invoices": (2, 462, 358, 998, 718),
    "problem-chat": (2, 922, 378, 1398, 698),
    # Slide 3 — connected workflow
    "platform-connected": (3, 668, 24, 1905, 1045),
    # Slide 4 — agency UI windows (no slide copy on the left)
    "agency-workflow": (4, 698, 20, 1905, 1045),
    "agency-calendar": (4, 748, 48, 1905, 398),
    "agency-client-chat": (4, 568, 192, 1905, 618),
    "agency-option-threads": (4, 598, 492, 1905, 1045),
    # Slide 5 — client (phone centered; panels on the right only)
    "client-discovery-phone": (5, 752, 105, 1065, 988),
    "client-option-threads": (5, 1118, 54, 1902, 432),
    "client-chat-workflow": (5, 1110, 402, 1902, 992),
    # Slide 6 — model phones (two separate devices, no bleed between them)
    "model-phones": (6, 798, 68, 1872, 998),
    "model-phone-inbox": (6, 805, 68, 1210, 998),
    "model-phone-request": (6, 1242, 68, 1872, 998),
}

COORD_REF_SCALE = 2
RENDER_SCALE = 5

MAX_WIDTHS: dict[str, int] = {
    "hero-stack": 2000,
    "platform-connected": 2000,
    "agency-workflow": 2000,
    "agency-calendar": 2000,
    "agency-client-chat": 2000,
    "agency-option-threads": 2000,
    "client-discovery-phone": 960,
    "client-option-threads": 2000,
    "client-chat-workflow": 2000,
    "model-phones": 2000,
    "model-phone-inbox": 800,
    "model-phone-request": 800,
    "problem-options": 2000,
    "problem-calendar": 2000,
    "problem-invoices": 2000,
    "problem-chat": 2000,
}


def pixmap_box(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    l, t, r, b = box
    factor = RENDER_SCALE / COORD_REF_SCALE
    return (
        int(round(l * factor)),
        int(round(t * factor)),
        int(round(r * factor)),
        int(round(b * factor)),
    )


def crop_page(doc: fitz.Document, page_idx: int, box: tuple[int, int, int, int]) -> Image.Image:
    page = doc.load_page(page_idx)
    mat = fitz.Matrix(RENDER_SCALE, RENDER_SCALE)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    l, t, r, b = pixmap_box(box)
    r = min(r, img.width)
    b = min(b, img.height)
    return img.crop((l, t, r, b))


def trim_slide_margins(img: Image.Image, threshold: int = 14, pad: int = 6) -> Image.Image:
    """Remove pitch-deck slide background; keep UI cards and windows."""
    rgb = img.convert("RGB")
    bg = Image.new("RGB", rgb.size, SLIDE_BG)
    diff = ImageChops.difference(rgb, bg).convert("L")
    mask = diff.point(lambda p: 255 if p > threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        return rgb
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(rgb.width, r + pad)
    b = min(rgb.height, b + pad)
    return rgb.crop((l, t, r, b))


def sharpen(img: Image.Image) -> Image.Image:
    return img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=140, threshold=2))


def save_webp(img: Image.Image, path: Path, max_width: int | None = None) -> tuple[int, int]:
    out = trim_slide_margins(img)
    out = sharpen(out)
    if max_width and out.width > max_width:
        ratio = max_width / out.width
        out = out.resize((max_width, int(out.height * ratio)), Image.Resampling.LANCZOS)
        out = sharpen(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, format="WEBP", quality=96, method=6)
    kb = path.stat().st_size // 1024
    print(f"  {path.name}: {out.width}x{out.height} ({kb} KB)")
    return out.width, out.height


def main() -> None:
    if not PDF.is_file():
        raise SystemExit(f"PDF not found: {PDF}")

    doc = fitz.open(PDF)
    dims: dict[str, tuple[int, int]] = {}
    print(f"Extracting {len(REGIONS)} visuals @ render {RENDER_SCALE}x (coords ref {COORD_REF_SCALE}x)")

    for name, region in REGIONS.items():
        page, l, t, r, b = region
        img = crop_page(doc, page - 1, (l, t, r, b))
        w, h = save_webp(img, OUT / f"{name}.webp", max_width=MAX_WIDTHS.get(name))
        dims[name] = (w, h)

    doc.close()

    print("\nPaste into productVisuals.ts:")
    for name in REGIONS:
        w, h = dims[name]
        print(f'  "{name}": {{ width: {w}, height: {h} }},')


if __name__ == "__main__":
    main()

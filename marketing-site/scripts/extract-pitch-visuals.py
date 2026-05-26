#!/usr/bin/env python3
"""
Extract product UI crops from the pitch deck PDF.

Region coordinates are defined for a 1920×1080 pixmap (fitz Matrix(2, 2)).
The PDF mediabox is 960×540 pt — do NOT multiply coords by render scale directly.
"""

from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PDF = Path("/Users/rubenjohanneselge/Downloads/Index_Casting_Pitch_Deck_Innsbruck.pdf")
OUT = ROOT / "public" / "images" / "product"

# (page_1based, left, top, right, bottom) @ 1920×1080 reference
REGIONS: dict[str, tuple[int, int, int, int, int]] = {
    # Slide 1 — UI cluster (trim stray logo glyph on the left)
    "hero-stack": (1, 820, 68, 1905, 1010),
    # Slide 2 — fragmented tools collage
    "problem-options": (2, 500, 32, 1045, 345),
    "problem-calendar": (2, 715, 38, 1335, 415),
    "problem-invoices": (2, 455, 355, 995, 715),
    "problem-chat": (2, 915, 375, 1395, 695),
    # Slide 3 — connected workflow
    "platform-connected": (3, 655, 22, 1905, 1045),
    # Slide 4 — agency stack
    "agency-workflow": (4, 665, 18, 1905, 1045),
    "agency-calendar": (4, 715, 42, 1905, 395),
    "agency-client-chat": (4, 545, 195, 1905, 615),
    "agency-option-threads": (4, 585, 495, 1905, 1045),
    # Slide 5 — client
    "client-discovery-phone": (5, 525, 50, 1145, 1020),
    "client-option-threads": (5, 1175, 48, 1905, 475),
    "client-chat-workflow": (5, 1035, 465, 1905, 1020),
    # Slide 6 — models
    "model-phones": (6, 780, 58, 1875, 1005),
    "model-phone-inbox": (6, 780, 58, 1275, 1005),
    "model-phone-request": (6, 1265, 58, 1875, 1005),
}

# Reference pixmap size for REGIONS (Matrix(2,2) on 960×540 pt pages)
COORD_REF_SCALE = 2
RENDER_SCALE = 4

MAX_WIDTHS: dict[str, int] = {
    "hero-stack": 1800,
    "platform-connected": 1600,
    "agency-workflow": 1600,
    "agency-calendar": 1600,
    "agency-client-chat": 1600,
    "agency-option-threads": 1600,
    "client-discovery-phone": 720,
    "client-option-threads": 1400,
    "client-chat-workflow": 1400,
    "model-phones": 1600,
    "model-phone-inbox": 600,
    "model-phone-request": 600,
    "problem-options": 1600,
    "problem-calendar": 1600,
    "problem-invoices": 1600,
    "problem-chat": 1600,
}


def pixmap_box(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Map 1920×1080 reference coords → current render scale."""
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


def trim_margins(img: Image.Image, threshold: int = 12, pad: int = 4) -> Image.Image:
    """Trim near-white slide margins; keep UI content."""
    rgb = img.convert("RGB")
    white = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, white).convert("L")
    mask = diff.point(lambda p: 255 if p > threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        return rgb
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(rgb.width, r + pad)
    b = min(rgb.height, b + pad)
    cropped = rgb.crop((l, t, r, b))
    return cropped.filter(ImageFilter.UnsharpMask(radius=0.8, percent=100, threshold=3))


def save_webp(img: Image.Image, path: Path, max_width: int | None = None) -> tuple[int, int]:
    out = trim_margins(img)
    if max_width and out.width > max_width:
        ratio = max_width / out.width
        out = out.resize((max_width, int(out.height * ratio)), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, format="WEBP", quality=94, method=6)
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

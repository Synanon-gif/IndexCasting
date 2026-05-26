#!/usr/bin/env python3
"""Extract tight product UI crops from pitch deck — trim margins, high DPI."""

from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
PDF = Path("/Users/rubenjohanneselge/Downloads/Index_Casting_Pitch_Deck_Innsbruck.pdf")
OUT = ROOT / "public" / "images" / "product"

# Base coords on 1920×1080 reference (scaled by RENDER_SCALE)
REGIONS: dict[str, tuple[int, int, int, int, int]] = {
    # Slide 1 — product cluster only (no left copy)
    "hero-stack": (1, 780, 72, 1910, 1010),
    # Slide 2 — individual UI panels
    "problem-options": (2, 548, 48, 1060, 338),
    "problem-calendar": (2, 768, 52, 1340, 408),
    "problem-invoices": (2, 488, 368, 1000, 708),
    "problem-chat": (2, 928, 388, 1390, 688),
    # Slide 3 — connected workflow (right panel only)
    "platform-connected": (3, 668, 28, 1910, 1040),
    # Slide 4 — agency UI stack (tighter left edge — no slide typography)
    "agency-workflow": (4, 680, 24, 1910, 1040),
    "agency-calendar": (4, 980, 88, 1910, 448),
    "agency-client-chat": (4, 700, 248, 1910, 588),
    "agency-option-threads": (4, 688, 518, 1910, 1000),
    # Slide 5 — client
    "client-discovery-phone": (5, 528, 56, 1140, 1020),
    "client-option-threads": (5, 1188, 52, 1910, 468),
    "client-chat-workflow": (5, 1048, 472, 1910, 1020),
    # Slide 6 — models
    "model-phones": (6, 788, 64, 1870, 1000),
    "model-phone-inbox": (6, 788, 64, 1270, 1000),
    "model-phone-request": (6, 1268, 64, 1870, 1000),
}

RENDER_SCALE = 3  # 5760×3240 — sharp on retina

MAX_WIDTHS: dict[str, int] = {
    "hero-stack": 1600,
    "platform-connected": 1400,
    "agency-workflow": 1400,
    "agency-calendar": 1400,
    "agency-client-chat": 1400,
    "agency-option-threads": 1400,
    "client-discovery-phone": 640,
    "client-option-threads": 1200,
    "client-chat-workflow": 1200,
    "model-phones": 1400,
    "model-phone-inbox": 560,
    "model-phone-request": 560,
}


def scale_box(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    l, t, r, b = box
    s = RENDER_SCALE
    return l * s, t * s, r * s, b * s


def crop_page(doc: fitz.Document, page_idx: int, box: tuple[int, int, int, int]) -> Image.Image:
    page = doc.load_page(page_idx)
    mat = fitz.Matrix(RENDER_SCALE, RENDER_SCALE)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    l, t, r, b = scale_box(box)
    return img.crop((l, t, r, b))


def trim_margins(img: Image.Image, min_diff: int = 14) -> Image.Image:
    """Remove near-white slide margins — UI is light-on-white, not dark-on-black."""
    rgb = img.convert("RGB")
    white = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, white).convert("L")
    mask = diff.point(lambda p: 255 if p > min_diff else 0)
    bbox = mask.getbbox()
    if not bbox:
        return rgb
    cropped = rgb.crop(bbox)
    return cropped.filter(ImageFilter.UnsharpMask(radius=1.0, percent=105, threshold=3))


def save_webp(img: Image.Image, path: Path, max_width: int | None = None) -> tuple[int, int]:
    out = trim_margins(img)
    if max_width and out.width > max_width:
        ratio = max_width / out.width
        out = out.resize((max_width, int(out.height * ratio)), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, format="WEBP", quality=92, method=6)
    print(f"  {path.name}: {out.width}x{out.height} ({path.stat().st_size // 1024} KB)")
    return out.width, out.height


def post_process_derived_panels(dims: dict[str, tuple[int, int]]) -> None:
    """Slice composite workflow images into panel assets (PDF crops can miss panels)."""
    wf_path = OUT / "agency-workflow.webp"
    if wf_path.is_file():
        wf = Image.open(wf_path)
        w, h = wf.size
        agency_slices = [
            ("agency-calendar", 0.0, 0.38),
            ("agency-client-chat", 0.34, 0.54),
        ]
        for name, a, b in agency_slices:
            crop = wf.crop((0, int(h * a), w, int(h * b)))
            dims[name] = save_webp(crop, OUT / f"{name}.webp", max_width=MAX_WIDTHS.get(name))

    phones_path = OUT / "model-phones.webp"
    if phones_path.is_file():
        phones = Image.open(phones_path)
        w, h = phones.size
        panel = phones.crop((int(w * 0.02), 0, int(w * 0.52), h))
        pw, ph = panel.size
        for name, a, b in [
            ("model-phone-inbox", 0.0, 0.55),
            ("model-phone-request", 0.45, 1.0),
        ]:
            crop = panel.crop((0, int(ph * a), pw, int(ph * b)))
            dims[name] = save_webp(crop, OUT / f"{name}.webp", max_width=MAX_WIDTHS.get(name))

    if PDF.is_file():
        doc = fitz.open(PDF)
        page = doc.load_page(4)
        mat = fitz.Matrix(RENDER_SCALE, RENDER_SCALE)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        panel = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        l, t, r, b = scale_box((620, 40, 1910, 1020))
        panel = panel.crop((l, t, r, b))
        pw, ph = panel.size
        for name, a, b in [
            ("client-option-threads", 0.0, 0.42),
            ("client-chat-workflow", 0.38, 1.0),
        ]:
            crop = panel.crop((0, int(ph * a), pw, int(ph * b)))
            dims[name] = save_webp(crop, OUT / f"{name}.webp", max_width=MAX_WIDTHS.get(name))
        doc.close()


def main() -> None:
    if not PDF.is_file():
        raise SystemExit(f"PDF not found: {PDF}")

    doc = fitz.open(PDF)
    dims: dict[str, tuple[int, int]] = {}
    print(f"Extracting {len(REGIONS)} visuals @ {RENDER_SCALE}x -> {OUT}")

    for name, region in REGIONS.items():
        page, l, t, r, b = region
        img = crop_page(doc, page - 1, (l, t, r, b))
        w, h = save_webp(img, OUT / f"{name}.webp", max_width=MAX_WIDTHS.get(name))
        dims[name] = (w, h)

    doc.close()

    post_process_derived_panels(dims)

    print("\nDimensions for productVisuals.ts:")
    for name, (w, h) in dims.items():
        print(f'  "{name}": {{ width: {w}, height: {h} }},')
    print("Done.")


if __name__ == "__main__":
    main()

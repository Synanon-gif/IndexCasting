#!/usr/bin/env python3
"""Extract cropped product UI regions from the pitch deck PDF (no slide text)."""

from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PDF = Path("/Users/rubenjohanneselge/Downloads/Index_Casting_Pitch_Deck_Innsbruck.pdf")
OUT = ROOT / "public" / "images" / "product"

# Regions: (page_1based, left, top, right, bottom) on 1920×1080 @ 2× render
REGIONS: dict[str, tuple[int, int, int, int, int]] = {
    "hero-stack": (1, 720, 64, 1910, 1020),
    "problem-options": (2, 500, 36, 1040, 340),
    "problem-calendar": (2, 720, 44, 1320, 400),
    "problem-invoices": (2, 460, 360, 980, 700),
    "problem-chat": (2, 900, 380, 1380, 680),
    "platform-connected": (3, 640, 24, 1910, 1040),
    "agency-workflow": (4, 600, 16, 1910, 1040),
    "agency-calendar": (4, 860, 72, 1910, 420),
    "agency-client-chat": (4, 640, 260, 1580, 560),
    "agency-option-threads": (4, 620, 500, 1910, 1000),
    "client-discovery-phone": (5, 500, 48, 1120, 1020),
    "client-option-threads": (5, 1160, 44, 1910, 460),
    "client-chat-workflow": (5, 1020, 460, 1910, 1020),
    "model-phones": (6, 760, 56, 1880, 1000),
    "model-phone-inbox": (6, 760, 56, 1260, 1000),
    "model-phone-request": (6, 1240, 56, 1880, 1000),
}


def crop_page(doc: fitz.Document, page_idx: int, box: tuple[int, int, int, int]) -> Image.Image:
    page = doc.load_page(page_idx)
    mat = fitz.Matrix(2, 2)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return img.crop(box)


def save_webp(img: Image.Image, path: Path, max_width: int | None = None) -> None:
    out = img.convert("RGB")
    if max_width and out.width > max_width:
        ratio = max_width / out.width
        out = out.resize((max_width, int(out.height * ratio)), Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, format="WEBP", quality=86, method=6)
    print(f"  {path.name}: {out.width}×{out.height} ({path.stat().st_size // 1024} KB)")


def main() -> None:
    if not PDF.is_file():
        raise SystemExit(f"PDF not found: {PDF}")

    doc = fitz.open(PDF)
    print(f"Extracting {len(REGIONS)} visuals → {OUT}")

    max_widths = {
        "hero-stack": 1400,
        "platform-connected": 1200,
        "agency-workflow": 1200,
        "client-discovery-phone": 560,
        "model-phones": 1100,
        "model-phone-inbox": 480,
        "model-phone-request": 520,
    }

    for name, (page, l, t, r, b) in REGIONS.items():
        img = crop_page(doc, page - 1, (l, t, r, b))
        save_webp(img, OUT / f"{name}.webp", max_width=max_widths.get(name))

    doc.close()
    print("Done.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Gera os ícones da extensão (π branco sobre quadrado escuro arredondado).

Uso: python3 scripts/make-icons.py   (requer Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf"
BG = (28, 28, 31, 255)
FG = (245, 245, 245, 255)
SIZES = (16, 32, 48, 128)
SCALE = 8  # desenha grande e reduz: bordas e glifo ficam suaves
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def icon(size: int) -> Image.Image:
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.22), fill=BG)
    font = ImageFont.truetype(FONT, int(big * 0.78))
    # O π da DejaVu tem folga embaixo; centraliza pela caixa do glifo.
    left, top, right, bottom = draw.textbbox((0, 0), "π", font=font)
    draw.text(
        ((big - (right - left)) / 2 - left, (big - (bottom - top)) / 2 - top),
        "π",
        font=font,
        fill=FG,
    )
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon-{size}.png"
        icon(size).save(path)
        print(f"{path} ({size}x{size})")


if __name__ == "__main__":
    main()

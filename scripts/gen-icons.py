# Genera los iconos PWA a partir de assets/nestra_logo.png con Pillow.
# - icon-192 / icon-512: logo centrado sobre fondo blanco (any).
# - icon-maskable-512: logo en el safe zone (80%) sobre fondo de marca (maskable).
from PIL import Image
import os

SRC = "assets/nestra_logo.png"
BG = (255, 255, 255, 255)          # fondo "any"
BG_MASK = (255, 255, 255, 255)     # fondo maskable (cambiar a color de marca si se desea)

def make(out, size, pad_ratio, bg):
    base = Image.new("RGBA", (size, size), bg)
    logo = Image.open(SRC).convert("RGBA")
    box = int(size * pad_ratio)
    w, h = logo.size
    scale = min(box / w, box / h)
    logo = logo.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    x = (size - logo.size[0]) // 2
    y = (size - logo.size[1]) // 2
    base.alpha_composite(logo, (x, y))
    base.convert("RGB").save(out, "PNG")
    print("wrote", out)

if __name__ == "__main__":
    os.makedirs("assets", exist_ok=True)
    make("assets/icon-192.png", 192, 0.72, BG)
    make("assets/icon-512.png", 512, 0.72, BG)
    make("assets/icon-maskable-512.png", 512, 0.6, BG_MASK)

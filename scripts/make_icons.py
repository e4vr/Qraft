from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / "public"
for size in (192, 512):
    image = Image.new("RGB", (size, size), "#086bc4")
    draw = ImageDraw.Draw(image)
    inset = round(size * 0.16)
    draw.rounded_rectangle((inset, inset, size - inset, size - inset), radius=round(size * 0.15), fill="#ffffff")
    line = round(size * 0.085)
    center = size // 2
    draw.rounded_rectangle((center - line // 2, round(size * 0.28), center + line // 2, round(size * 0.72)), radius=line // 2, fill="#086bc4")
    draw.rounded_rectangle((round(size * 0.28), center - line // 2, round(size * 0.72), center + line // 2), radius=line // 2, fill="#086bc4")
    image.save(root / f"icon-{size}.png", optimize=True)

"""生成应用图标；仅构建资产时需要 Pillow，运行客户端不依赖 Python。"""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
out = root / 'assets'
out.mkdir(exist_ok=True)
scale = 4
image = Image.new('RGBA', (256 * scale, 256 * scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
def points(values):
    return [(int(x * scale), int(y * scale)) for x, y in values]
draw.rounded_rectangle((8 * scale, 8 * scale, 248 * scale, 248 * scale), radius=56 * scale, fill='#23392d')
draw.polygon(points([(128, 61), (199, 101), (128, 141), (57, 101)]), fill='#bed2a5')
for offset in (0, 35):
    draw.line(points([(57, 121 + offset), (128, 161 + offset), (199, 121 + offset)]), fill='#bed2a5', width=9 * scale, joint='curve')
image = image.resize((256, 256), Image.Resampling.LANCZOS)
image.save(out / 'icon.png')
image.save(out / 'icon.ico', sizes=[(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)])
print(out)

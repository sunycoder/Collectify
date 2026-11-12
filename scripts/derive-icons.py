"""只从用户指定的 icon.png 派生安装图标，绝不重绘或覆盖原 PNG。"""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
source = Image.open(root / 'assets' / 'icon.png').convert('RGBA')
canvas = Image.new('RGBA', (max(source.size), max(source.size)), (0, 0, 0, 0))
canvas.alpha_composite(source, ((canvas.width - source.width)//2, (canvas.height - source.height)//2))
canvas.save(root / 'assets' / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
canvas.resize((1024,1024), Image.Resampling.LANCZOS).save(root / 'assets' / 'icon.icns')
print('Derived ICO / ICNS from assets/icon.png')

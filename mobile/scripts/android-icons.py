# Makes the Android launcher icons from the web app's maskable icon.
# Run from mobile/: python3 scripts/android-icons.py   (needs Pillow)
from pathlib import Path
from PIL import Image, ImageDraw

here = Path(__file__).resolve().parent.parent
src = Image.open(here / '../web/icons/maskable-512.png').convert('RGBA')
res = here / 'android/app/src/main/res'
bg = src.getpixel((2, 2))
dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

# Adaptive foreground and monochrome: 108dp canvas, artwork at 90% so the star stays in the safe zone.
def layer(img, size):
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner = round(size * 0.9)
    canvas.alpha_composite(img.resize((inner, inner), Image.LANCZOS), ((size - inner) // 2,) * 2)
    return canvas

fg = src.copy()
px = fg.load()
mono = Image.new('RGBA', src.size)
mpx = mono.load()
for y in range(src.height):
    for x in range(src.width):
        r, g, b, a = px[x, y]
        d = min(255, int((abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])) * 1.6))
        px[x, y] = (r, g, b, d)
        mpx[x, y] = (255, 255, 255, d)

for name, k in dens.items():
    d = res / f'mipmap-{name}'
    d.mkdir(parents=True, exist_ok=True)
    s108, s48 = round(108 * k), round(48 * k)
    layer(fg, s108).save(d / 'ic_launcher_foreground.png', optimize=True)
    layer(mono, s108).save(d / 'ic_launcher_monochrome.png', optimize=True)
    # Legacy icons (Android 7): rounded square and circle.
    sq = src.resize((s48, s48), Image.LANCZOS)
    for fname, shape in (('ic_launcher.png', 'rounded'), ('ic_launcher_round.png', 'round')):
        mask = Image.new('L', (s48 * 4, s48 * 4), 0)
        draw = ImageDraw.Draw(mask)
        if shape == 'round':
            draw.ellipse((0, 0, s48 * 4 - 1, s48 * 4 - 1), fill=255)
        else:
            draw.rounded_rectangle((0, 0, s48 * 4 - 1, s48 * 4 - 1), radius=s48 * 4 // 6, fill=255)
        out = sq.copy()
        out.putalpha(mask.resize((s48, s48), Image.LANCZOS))
        out.save(d / fname, optimize=True)

any_ = res / 'mipmap-anydpi-v26'
any_.mkdir(parents=True, exist_ok=True)
xml = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/icon_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
'''
for n in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    (any_ / n).write_text(xml)
(res / 'values/icon_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="icon_background">#%02X%02X%02X</color>\n</resources>\n' % bg[:3])
print('Android icons written to', res)

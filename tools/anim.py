"""Frame-by-frame check of the LCD in every state. Writes tools/shots/anim_*.png (a contact sheet per scenario)."""
import os, sys, io
from playwright.sync_api import sync_playwright
from PIL import Image
for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
ID = sys.argv[1] if len(sys.argv) > 1 else "1462"
URL = f"http://127.0.0.1:8790/?chog={ID}&debug=1"
OUT = os.path.join(os.path.dirname(__file__), "shots")

def sheet(name, frames):
    w, h = frames[0].size
    im = Image.new("RGB", (w * len(frames) + 8 * (len(frames) - 1), h), (10, 6, 24))
    for i, f in enumerate(frames):
        im.paste(f, (i * (w + 8), 0))
    im.save(f"{OUT}/anim_{name}.png")

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(2000)
    lcd = pg.locator("#lcd")
    shot = lambda: Image.open(io.BytesIO(lcd.screenshot())).convert("RGB")

    def frames(n, gap):
        out = []
        for _ in range(n):
            out.append(shot())
            pg.wait_for_timeout(gap)
        return out

    def setbase(patch, meta=None):
        pg.evaluate("""async ([id, patch, meta]) => {
          const r = await fetch('/api/dev/' + id, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({state: patch, meta, clearCool: true})});
          const v = await r.json(); window.__pet.cur.cool = {}; window.__pet.applyView(v); window.__pet.say('');
        }""", [int(ID), patch, meta])
        pg.wait_for_timeout(300)

    T = 1791900000
    # 1 feed menu + eating the favourite
    setbase({"food": 30, "fun": 50, "clean": 80, "poop": 0, "energy": 80, "nap": 0, "awake": 9999999999, "away": False})
    pg.click(".ico[data-i='0']")
    pg.wait_for_timeout(400)
    f = [shot()]
    pg.click(".food >> nth=2")
    f += frames(7, 450)
    sheet("feed", f)
    pg.wait_for_timeout(1500)
    # 2 dirty + poop + hungry
    setbase({"clean": 18, "poop": 2, "food": 12})
    sheet("dirty", frames(3, 700))
    # 3 bath
    pg.click(".ico[data-i='2']")
    sheet("bath", frames(5, 600))
    pg.wait_for_timeout(1500)
    # 4 tuck in, then wake (grumpy)
    setbase({"energy": 40, "nap": 0, "awake": 0})
    pg.click(".ico[data-i='3']")
    sl = frames(4, 900)
    pg.evaluate("window.__pet.cur.cool = {}")
    pg.click(".ico[data-i='3']")
    sl += frames(3, 500)
    sheet("sleep", sl)
    # 5 away, then come back with a meal
    setbase({"away": True, "food": 0, "nap": 0, "awake": 9999999999})
    pg.wait_for_timeout(1200)
    aw = frames(1, 300)
    pg.click(".ico[data-i='0']"); pg.wait_for_timeout(300); pg.click(".food >> nth=0")
    aw += frames(6, 600)
    sheet("away", aw)
    pg.wait_for_timeout(1500)
    # 6 moved cutscene (fire and forget)
    pg.evaluate("void window.__pet.screen.play('moved')")
    sheet("moved", frames(7, 900))
    pg.wait_for_timeout(800)
    # 7 game
    setbase({"energy": 90, "nap": 0, "awake": 9999999999})
    pg.click(".ico[data-i='1']")
    g = frames(2, 1100)
    pg.keyboard.down("ArrowLeft"); g += frames(3, 1500); pg.keyboard.up("ArrowLeft")
    pg.keyboard.down("ArrowRight"); g += frames(3, 1500); pg.keyboard.up("ArrowRight")
    sheet("game", g)
    pg.wait_for_timeout(26000)
    sheet("after_game", frames(3, 700))
    pg.screenshot(path=f"{OUT}/anim_page_after.png")
    print("errors:", errs[:10])
    br.close()

"""Screenshot Chog Pet locally (desktop + phone) and print console errors. Usage: python shoot.py [url] [tag]"""
import sys, os
from playwright.sync_api import sync_playwright
for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790/?chog=953"
TAG = sys.argv[2] if len(sys.argv) > 2 else "a"
OUT = os.path.join(os.path.dirname(__file__), "shots")
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    for name, vp, dpr in (("desk", {"width": 1440, "height": 900}, 1), ("phone", {"width": 390, "height": 844}, 2)):
        ctx = br.new_context(viewport=vp, device_scale_factor=dpr)
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: m.type in ("error", "warning") and errs.append(m.text))
        pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_timeout(2500)
        pg.screenshot(path=f"{OUT}/{TAG}_{name}.png", full_page=(name == "phone"))
        print(name, "errors:", errs[:8])
        ctx.close()
    br.close()

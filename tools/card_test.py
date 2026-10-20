import os
from playwright.sync_api import sync_playwright
for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
OUT = os.path.join(os.path.dirname(__file__), "shots")
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    pg = br.new_page(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    pg.goto("http://127.0.0.1:8790/?chog=71", wait_until="networkidle")
    pg.wait_for_timeout(2000)
    with pg.expect_download() as d:
        pg.click("#shareBtn")
    d.value.save_as(f"{OUT}/card.png")
    print("card", d.value.suggested_filename, "x:", pg.get_attribute("#xBtn", "href")[:160])
    br.close()

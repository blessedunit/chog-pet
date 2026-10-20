"""End-to-end sign-in with a throwaway key: injected EIP-1193 provider, personal_sign done in Python."""
import os, io
from eth_account import Account
from eth_account.messages import encode_defunct
from playwright.sync_api import sync_playwright
for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(k, None)
acct = Account.create()
ADDR = acct.address.lower()
ID = 1462
OUT = os.path.join(os.path.dirname(__file__), "shots")

def sign(hexmsg):
    msg = bytes.fromhex(hexmsg[2:])
    return "0x" + acct.sign_message(encode_defunct(primitive=msg)).signature.hex().removeprefix("0x")

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome")
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.expose_function("pySign", sign)
    ctx.add_init_script(f"""window.ethereum = {{ request: async ({{method, params}}) => {{
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['{acct.address}'];
        if (method === 'personal_sign') return await window.pySign(params[0]);
        throw new Error('unsupported ' + method); }} }};""")
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(f"http://127.0.0.1:8790/?chog={ID}&debug=1", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    print("button before:", pg.inner_text("#walletBtn"))
    pg.click("#walletBtn")
    pg.wait_for_timeout(2500)
    print("button after:", pg.inner_text("#walletBtn"), "| token stored:", bool(pg.evaluate("localStorage.getItem('pet.token')")))
    print("name button hidden (not owner):", pg.is_hidden("#nameBtn"))
    # pretend this wallet is the home, then reload the view
    r = pg.evaluate("""async ([id, addr]) => { const r = await fetch('/api/dev/' + id, {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({meta:{owner: addr}, clearCool: true})}); return r.status; }""", [ID, ADDR])
    print("dev patch:", r)
    # name endpoint: the worker checks the live owner again, so the real chain owner wins
    res = pg.evaluate("""async (id) => { const r = await fetch('/api/pet/' + id + '/name', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({name:'Mochi', token: localStorage.getItem('pet.token')})}); return [r.status, (await r.json()).error || 'ok']; }""", ID)
    print("name as non-owner on chain:", res)
    # bad signature is refused
    bad = pg.evaluate("""async (addr) => { const r = await fetch('/api/auth', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({address: addr, ts: Math.floor(Date.now()/1000), signature: '0x' + '11'.repeat(65)})}); return r.status; }""", ADDR)
    print("forged signature status:", bad)
    # signed feed shows the wallet in the visitor log
    pg.evaluate("window.__pet.cur.cool = {}")
    pg.click(".ico[data-i='4']")
    pg.wait_for_timeout(1500)
    print("log top:", pg.inner_text("#log").split("\n")[:3])
    pg.screenshot(path=f"{OUT}/wallet.png")
    print("errors:", errs[:5])
    br.close()

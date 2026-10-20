"""Chog Pet static data: name number + traits for every Chog Genesis token (read-only from ../data/meta).

Token id != the number in the NFT's name (tokenURI file = ((id+1459) % 1969) + 1), so we keep both.
Output: public/data/chogs.json  {"v":1, "n":[name# per id], "t":[[trait values per id in KEYS order]], "k":KEYS}
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
META = HERE.parent / "data" / "meta"
OUT = HERE / "public" / "data" / "chogs.json"
KEYS = ["Background", "Aura", "Base", "Skin", "Side", "Body", "Mouth", "Eyes", "Head", "Accessory", "Form", "Tier", "Naked"]

names, traits, titles = [], [], {}
for i in range(1, 1970):
    m = json.loads((META / f"{i}.json").read_text(encoding="utf-8"))
    num = re.match(r"\s*CHOG #(\d+)\s*(?:\W+\s*(.+))?$", m["name"])
    names.append(int(num.group(1)))
    if num.group(2):
        titles[str(i)] = num.group(2).strip()   # the 1:1s carry their own name, e.g. "Blaze"
    a = {x["trait_type"]: x["value"] for x in m.get("attributes", [])}
    traits.append([a.get(k, "") for k in KEYS])
assert len(set(names)) == 1969
OUT.write_text(json.dumps({"v": 1, "k": KEYS, "n": names, "nm": titles, "t": traits}, separators=(",", ":")), encoding="utf-8")
print(OUT, OUT.stat().st_size)

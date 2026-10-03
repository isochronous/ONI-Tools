"""Copy the game's oni-data-dump.json into data/<build>.json, stripping Klei's rich-text
markup from every string (link, colour, italics tags) so the app never sees it.

    python tools/import-dump.py [path-to-oni-data-dump.json]
"""
import json, os, re, sys

TAGS = re.compile(r"<[^>]+>")
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), "Documents", "Klei", "OxygenNotIncluded", "oni-data-dump.json")

def clean(v):
    if isinstance(v, str):
        return TAGS.sub("", v).strip()
    if isinstance(v, list):
        return [clean(x) for x in v]
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    return v

d = clean(json.load(open(src, encoding="utf-8")))
build = d["game"]["build"].split()[0]          # e.g. U59-744825-SCRPAND -> U59-744825
build = "-".join(build.split("-")[:2])
# One file per build and DLC set.
active = d["game"]["activeDlcs"]
known = [x["id"] for x in d["dlcs"]]
if set(active) >= set(known):
    flavour = "all-dlcs"
elif not active:
    flavour = "base"
elif set(active) == set(known) - {"EXPANSION1_ID"}:
    flavour = "no-spaced-out"          # the base game plus every content pack
else:
    flavour = "+".join(x.replace("_ID", "").lower() for x in active)
out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "%s-%s.json" % (build, flavour))
json.dump(d, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("wrote", out, os.path.getsize(out) // 1024, "KB; names like:", d["names"]["PlantFiber"], "/", d["dlcs"][0]["name"])

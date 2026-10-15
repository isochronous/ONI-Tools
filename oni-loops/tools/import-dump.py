"""Copy the game's oni-data-dump.<flavour>.json into data/<build>-<flavour>.json, stripping
Klei's rich-text markup from every string (link, colour, italics tags) so the app never sees
it. When the dump's icon folder is next to it, its PNGs are copied to app/public/icons and the
tags they cover are listed in data/icons.json.

    python tools/import-dump.py [path-to-oni-data-dump.json] [--no-icons]
"""
import json, os, re, shutil, sys

TAGS = re.compile(r"<[^>]+>")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
klei = os.path.join(os.path.expanduser("~"), "Documents", "Klei", "OxygenNotIncluded")
src = args[0] if args else os.path.join(klei, "oni-data-dump.json")
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

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
# The Db always holds the base game's Starmap destinations, but rockets only visit them
# without Spaced Out, so they are dropped from a Spaced Out dump.
if "EXPANSION1_ID" in active:
    d["spaceDestinations"] = []
out = os.path.join(root, "data", "%s-%s.json" % (build, flavour))
json.dump(d, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("wrote", out, os.path.getsize(out) // 1024, "KB; names like:", d["names"]["PlantFiber"], "/", d["dlcs"][0]["name"])

# Icons: one folder per dump run, the same for every flavour, so the latest run wins.
icons = os.path.join(os.path.dirname(os.path.abspath(src)), "oni-data-dump.icons")
if "--no-icons" not in sys.argv and os.path.isdir(icons):
    dest = os.path.join(root, "app", "public", "icons")
    exported = set(json.load(open(os.path.join(icons, "index.json"), encoding="utf-8")))
    # Only what the app can show: elements, things some conversion mentions, and the
    # buildings, critters, and plants that do the converting. The dump exports every prefab.
    body = json.dumps({k: v for k, v in d.items() if k not in ("items", "names", "elements")})
    wanted = {e["id"] for e in d["elements"] if not e["disabled"]}
    wanted |= {b["id"] for b in d["buildings"]} | {f for r in d["recipes"] for f in r["fabricators"]}
    wanted |= {c["id"] for c in d["critters"]} | {p["id"] for p in d["plants"]}
    wanted |= {f["id"] for f in d.get("features", [])}
    wanted |= {f["vent"]["drill"]["building"] for f in d.get("features", []) if f.get("vent") and f["vent"].get("drill")}
    wanted |= {it["id"] for it in d["items"] if '"%s"' % it["id"] in body}
    # The icon folder holds the latest run only, and a base-game run lacks Spaced Out's things,
    # so icons already imported are kept; the manifest is what the app wants and has.
    os.makedirs(dest, exist_ok=True)
    kept = {f[:-4] for f in os.listdir(dest) if f.endswith(".png")}
    for tag in sorted(wanted & exported):
        shutil.copyfile(os.path.join(icons, tag + ".png"), os.path.join(dest, tag + ".png"))
    # A dump of one flavour wants only its own things, so what the other flavour's import
    # put in the manifest stays too; only icons no flavour wants go.
    old = set(json.load(open(os.path.join(root, "data", "icons.json"), encoding="utf-8"))) if os.path.exists(os.path.join(root, "data", "icons.json")) else set()
    have = (wanted & exported) | (wanted & kept) | (old & kept)
    for f in os.listdir(dest):
        if f.endswith(".png") and f[:-4] not in have:
            os.remove(os.path.join(dest, f))
    manifest = sorted(have)
    json.dump(manifest, open(os.path.join(root, "data", "icons.json"), "w", encoding="utf-8"))
    print("copied", len(wanted & exported), "of", len(exported), "icons to", dest, "; manifest", len(manifest), "; wanted but missing:", sorted(wanted - have)[:40], len(wanted - have))

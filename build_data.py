#!/usr/bin/env python3
"""Build the offline loot-builder data from the local pf2e-system packs.

Usage:  python3 -I loot-builder/build_data.py
Writes data/items.js (item index, spells, treasure table, scroll/wand templates) and
data/desc/<group>.js (system descriptions, loaded on demand). Rerun after updating pf2e-system.
"""
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from statblocks import Enricher, clean_html  # noqa: E402

PROJECT = os.path.dirname(HERE)
PACKS = os.path.join(PROJECT, "pf2e-system", "packs", "pf2e")
EQUIP = os.path.join(PACKS, "equipment")
SPELLS = os.path.join(PACKS, "spells")
GM_SCREEN = os.path.join(PACKS, "journals", "gm-screen.json")
OUT = os.path.join(HERE, "data", "items.js")
DESC_DIR = os.path.join(HERE, "data", "desc")

# directory under equipment/ -> specialty subcategory
SPECIAL_DIRS = {"aeon-stones": "Aeon stones", "artifacts": "Artifacts", "contracts": "Contracts", "grimoires": "Grimoires",
                "intelligent-weapons": "Intelligent weapons", "spellhearts": "Spellhearts", "tattoos": "Tattoos",
                "materials": "Materials", "spell-catalysts": "Spell catalysts"}
CLASS_NAMES = ["alchemist", "animist", "barbarian", "bard", "champion", "cleric", "commander", "druid", "exemplar", "fighter",
               "gunslinger", "inventor", "investigator", "kineticist", "magus", "monk", "oracle", "psychic", "ranger", "rogue",
               "sorcerer", "summoner", "swashbuckler", "thaumaturge", "witch", "wizard"]
GLYPH = {"a": "◆", "1": "◆", "d": "◆◆", "2": "◆◆", "t": "◆◆◆", "3": "◆◆◆", "r": "⤾", "f": "◇"}


def load_json_tree(root):
    for dp, _, files in os.walk(root):
        for fn in sorted(files):
            if fn.endswith(".json") and not fn.startswith("_"):
                path = os.path.join(dp, fn)
                try:
                    with open(path) as fh:
                        d = json.load(fh)
                except (OSError, ValueError):
                    continue
                if isinstance(d, dict) and "system" in d:
                    yield os.path.relpath(path, root)[:-5], d


def cp(price):
    v = (price or {}).get("value") or {}
    return v.get("pp", 0) * 1000 + v.get("gp", 0) * 100 + v.get("sp", 0) * 10 + v.get("cp", 0)


def title(s):
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", str(s)).replace("-", " ").replace("_", " ")
    return s[:1].upper() + s[1:]


def render_html(en, text):
    """Enrichers to readable text, action glyph spans to symbols, simple formatting tags kept."""
    text = re.sub(r'<span class="action-glyph">\s*([A-Za-z0-9])\s*</span>', lambda m: GLYPH.get(m.group(1).lower(), m.group(1)), text or "")
    return clean_html(en.convert(text))


def action_cost(desc):
    m = re.search(r"<strong>\s*(?:Activate|Cast a Spell)[^<]*</strong>\s*(?:<span[^>]*>\s*([A-Za-z0-9])\s*</span>|(\d+)\s*(minute|hour)s?)?", desc or "")
    if not m:
        return None
    if m.group(1):
        return GLYPH.get(m.group(1).lower(), m.group(1))
    if m.group(2):
        return f"{m.group(2)} {m.group(3)}"
    return "other"


def consumable_kind(d):
    s, t, ty = d["system"], set(d["system"]["traits"]["value"]), d["type"]
    cat = s.get("category")
    if ty == "ammo":
        return "Ammunition"
    if ty == "weapon" and s.get("group") == "bomb":
        return "Bomb"
    if cat in ("elixir", "mutagen", "poison", "drug", "potion", "oil", "talisman", "fulu", "snare", "gadget", "scroll", "toolkit"):
        return title(cat)
    if cat == "catalyst" or "catalyst" in t:
        return "Spell catalyst"
    for k in ("snare", "talisman", "fulu", "elixir", "mutagen", "poison", "potion", "oil", "bomb", "drug", "gadget"):
        if k in t:
            return title(k)
    if "alchemical" in t:
        return "Alchemical tool"
    return "Other"


def classify(rel, d):
    """(category, subcategory) for the table; derived from type, traits, usage and the pack directory."""
    s, t, ty = d["system"], set(d["system"]["traits"]["value"]), d["type"]
    top = rel.split("/")[0] if "/" in rel else ""
    usage = ((s.get("usage") or {}).get("value") or "")
    if ty == "weapon":
        if s.get("group") == "bomb":
            return "Alchemical", "Bombs"
        if top == "intelligent-weapons":
            return "Specialty", "Intelligent weapons"
        return "Weapons", title(s.get("category") or "weapon")
    if ty == "armor":
        return "Armor", title(s.get("category") or "armor")
    if ty == "shield":
        return "Shields", "Magic shield" if "magical" in t else "Shield"
    if ty == "ammo":
        return "Ammunition", "Alchemical" if "alchemical" in t else "Magical"
    if top in SPECIAL_DIRS and top != "spell-catalysts":
        return "Specialty", SPECIAL_DIRS[top]
    if "consumable" in t or ty == "consumable":
        kind = consumable_kind(d)
        return ("Alchemical", kind) if "alchemical" in t else ("Consumables", kind)
    if "alchemical" in t:
        return "Alchemical", "Tools"
    if usage.startswith("etched"):
        return "Runes", "Weapon runes" if ("weapon" in usage or "dagger" in usage) else ("Armor runes" if "armor" in usage else "Other runes")
    if "staff" in t:
        return "Staves", "Staves"
    if "wand" in t or s.get("category") == "wand":
        return "Wands", "Wands"
    if usage.startswith("worn"):
        slot = re.sub(r"^worn-?", "", usage)
        return "Worn items", title(slot) if slot else "No slot"
    if usage.startswith(("applied", "affixed")):
        return "Applied & affixed", "Applied" if usage.startswith("applied") else "Affixed"
    if usage.startswith("held"):
        return "Held items", "Held"
    if ty == "backpack":
        return "Other gear", "Containers"
    return "Other gear", "Other"


def bulk_label(b):
    if b is None:
        return None
    return "L" if b == 0.1 else (int(b) if float(b).is_integer() else b)


def class_signals(name, raw_desc):
    """Conservative 'intended for' classes: explicit wording only (name like "Druid's Crown", "if you are a rogue",
    "requirements ... a wizard"). The monk weapon trait is deliberately ignored."""
    text = re.sub(r"<[^>]+>", " ", raw_desc or "")
    out = []
    for c in CLASS_NAMES:
        if re.search(rf"\b{c}(?:'s)?\b", name, re.I) or re.search(
                rf"\b(?:you must be an?|if you(?:'| a)re an?|only an?|requirements?\b[^.]{{0,60}}\ban?) {c}\b", text, re.I):
            out.append(c)
    return out


def spell_names_in(desc, en_names):
    out = []
    for m in re.finditer(r"@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\]", desc or ""):
        n = en_names.get(m.group(1), m.group(1) if not re.fullmatch(r"[A-Za-z0-9]{16}", m.group(1)) else None)
        if n and n not in out:
            out.append(n)
    return out


def build_items(en):
    items, descs, templates = [], collections.defaultdict(dict), {"scroll": {}, "wand": {}}
    bases = []
    stats = collections.Counter()
    licenses = {}
    for rel, d in load_json_tree(EQUIP):
        ty, s, name = d["type"], d["system"], d["name"]
        if ty in ("treasure", "kit"):
            stats["treasure/kit"] += 1
            continue
        m = re.fullmatch(r"Scroll of (\d+)(?:st|nd|rd|th)-rank Spell", name)
        w = re.fullmatch(r"Magic Wand \((\d+)(?:st|nd|rd|th)-Rank Spell\)", name)
        if m or w:
            kind, rank = ("scroll", int(m.group(1))) if m else ("wand", int(w.group(1)))
            templates[kind][rank] = {"u": d["_id"], "n": name, "l": s["level"]["value"], "p": cp(s.get("price"))}
            stats["templates"] += 1
            continue
        t = s["traits"]["value"]
        lvl = (s.get("level") or {}).get("value", 0)
        cat0 = s.get("category") or ""
        if (ty in ("weapon", "armor") and "magical" not in t and lvl <= 2 and s["traits"].get("rarity") in ("common", "uncommon")
                and cp(s.get("price")) > 0 and s.get("group") != "bomb" and "barding" not in cat0
                and not set(t) & {"siege", "consumable", "alchemical", "companion"}):
            dm = s.get("damage") or {}
            base = {"id": rel, "u": d["_id"], "n": name, "ty": ty, "p": cp(s.get("price")), "b": bulk_label((s.get("bulk") or {}).get("value")),
                    "cat": cat0, "grp": s.get("group"), "t": t, "rng": s.get("range")}
            if ty == "weapon" and dm.get("die"):
                base["wd"] = [dm.get("dice"), dm.get("die"), dm.get("damageType")]
            bases.append(base)
        if lvl == 0 and "magical" not in t:
            stats["level0 mundane"] += 1
            continue
        pub = s.get("publication") or {}
        if pub.get("title"):
            licenses[pub["title"]] = pub.get("license") or "?"
        raw_desc = (s.get("description") or {}).get("value") or ""
        cat, sub = classify(rel, d)
        consumable = "consumable" in t or ty in ("consumable", "ammo")
        rec = {
            "id": rel, "u": d["_id"], "n": name, "l": lvl, "ty": ty,
            "c": cat, "sc": sub,
            "r": s["traits"].get("rarity", "common"),
            "t": [x for x in t if x != "consumable"],
            "p": cp(s.get("price")),
            "b": bulk_label((s.get("bulk") or {}).get("value")),
            "k": 1 if consumable else 0,
        }
        per = (s.get("price") or {}).get("per")
        if per and per > 1:
            rec["per"] = per
        if s.get("baseItem"):
            rec["bi"] = s["baseItem"]
        if consumable:
            rec["ck"] = consumable_kind(d)
        us = (s.get("usage") or {}).get("value")
        if us:
            rec["us"] = us
        mat = (s.get("material") or {}).get("type")
        if mat:
            rec["mat"] = mat
        if ty == "weapon":
            dm = s.get("damage") or {}
            rec["wd"] = [dm.get("dice"), dm.get("die"), dm.get("damageType")] if dm.get("die") else None
            rec["grp"] = s.get("group")
            rec["rng"] = s.get("range")
            rec["rl"] = (s.get("reload") or {}).get("value")
        elif ty == "ammo" and s.get("damage"):
            dm = s["damage"]
            rec["wd"] = [dm.get("dice"), dm.get("die"), dm.get("damageType")] if dm.get("die") else None
        elif ty == "armor":
            rec["ar"] = [s.get("acBonus"), s.get("dexCap"), s.get("checkPenalty"), s.get("speedPenalty"), s.get("strength")]
            rec["grp"] = s.get("group")
        elif ty == "shield":
            rec["sh"] = [s.get("acBonus"), s.get("hardness"), (s.get("hp") or {}).get("max")]
        ax = action_cost(raw_desc)
        if ax is not None:
            rec["ax"] = ax
        if "invested" in t:
            rec["inv"] = 1
        sp = spell_names_in(raw_desc, en.names)
        if sp:
            rec["sp"] = sp
        cls = class_signals(name, raw_desc)
        if cls:
            rec["cl"] = cls
        items.append(rec)
        descs[cat][rel] = raw_desc
    print("items:", len(items), dict(stats))
    print("runed-gear bases:", len(bases))
    return items, descs, templates, licenses, bases


def build_spells(en):
    spells, descs = [], {}
    for rel, d in load_json_tree(SPELLS):
        s = d["system"]
        if d["type"] != "spell":
            continue
        t = s["traits"]["value"]
        if s.get("ritual") or s.get("category") in ("ritual", "focus") or "focus" in t or "cantrip" in t:
            continue
        lvl = s["level"]["value"]
        dmg = sorted({x.get("type") for x in (s.get("damage") or {}).values() if x.get("type")})
        sv = (s.get("defense") or {}).get("save") or {}
        spells.append({
            "id": rel, "u": d["_id"], "n": d["name"], "l": lvl,
            "r": s["traits"].get("rarity", "common"),
            "td": s["traits"].get("traditions") or [],
            "t": [x for x in t if x not in ("concentrate", "manipulate")],
            "tm": (s.get("time") or {}).get("value"),
            "sv": sv.get("statistic"),
            "dt": dmg,
            "hv": 1 if s.get("heightening") else 0,
            "ar": ((s.get("area") or {}).get("type")),
        })
        descs[rel] = (s.get("description") or {}).get("value") or ""
    print("spells:", len(spells))
    return spells, descs


def build_treasure():
    with open(GM_SCREEN) as fh:
        j = json.load(fh)
    html = None

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                yield from walk(v)
        elif isinstance(o, list):
            for v in o:
                yield from walk(v)
        elif isinstance(o, str):
            yield o
    for sx in walk(j):
        if "Party Treasure by Level" in sx:
            html = sx[sx.index("Party Treasure by Level"):]
            break
    rows = []
    gp = lambda x: int(re.sub(r"[^\d]", "", x))  # noqa: E731
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) >= 6 and cells[0].isdigit():
            rows.append({"l": int(cells[0]), "total": gp(cells[1]), "perm": cells[2], "cons": cells[3], "cur": gp(cells[4]), "pc": gp(cells[5])})
        if len(rows) == 20:
            break
    assert len(rows) == 20, len(rows)
    print("treasure rows:", len(rows), rows[4])
    return rows


def write_desc(descs, en, name):
    os.makedirs(DESC_DIR, exist_ok=True)
    path = os.path.join(DESC_DIR, re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + ".js")
    out = {k: render_html(en, v) for k, v in descs.items()}
    return path, out


PUBLISHER = {}


def write_orc_notice(licenses):
    """ORC-NOTICE.md listing every ORC-licensed source included in this build (same format as the encounter builder)."""
    orc = sorted(t for t, lic in licenses.items() if lic == "ORC")
    lines = [
        "# ORC Notice", "",
        "This product is licensed under the ORC License held in the Library of Congress at TX 9-307-067 and available",
        "online at various locations including paizo.com/orclicense, azoralaw.com/orclicense, and others.",
        "All warranties are disclaimed as set forth therein.", "",
        "## Attribution", "", "This product is based on the following Licensed Material:", "",
        *[f"- *{t}* © Paizo Inc." for t in orc], "",
        "## Reserved Material", "",
        "Reserved Material elements in this product include all elements designated as Reserved Material under the",
        "ORC License, including all elements designated as Reserved Material by the Licensors listed above.", "",
        "## Expressly Designated Licensed Material", "",
        "This product contains no Expressly Designated Licensed Material.", "", "---", "",
        "Generated by build_data.py from the publication data of the included items.", "",
    ]
    with open(os.path.join(HERE, "ORC-NOTICE.md"), "w") as fh:
        fh.write("\n".join(lines))
    print(f"wrote ORC-NOTICE.md ({len(orc)} ORC sources)")


def main():
    en = Enricher(PACKS)
    items, idescs, templates, licenses, bases = build_items(en)
    spells, sdescs = build_spells(en)
    treasure = build_treasure()
    for attempt in (1, 2):
        shards = {}
        for cat, dd in idescs.items():
            path, out = write_desc(dd, en, cat)
            shards[path] = out
        path, out = write_desc(sdescs, en, "spells")
        shards[path] = out
        missing = {k for k in en.used_keys if k not in en.lang}
        if attempt == 1 and missing and en.refresh_glossary(en.used_keys):
            en.used_keys = set()
            continue
        break
    for old in os.listdir(DESC_DIR) if os.path.isdir(DESC_DIR) else []:
        os.remove(os.path.join(DESC_DIR, old))
    total = 0
    for path, out in shards.items():
        with open(path, "w") as fh:
            fh.write("window.LB_DESC_ADD(")
            json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
            fh.write(");\n")
        total += os.path.getsize(path)
    print(f"descriptions: {len(shards)} shards, {total // 1024} KB; unresolved glossary keys: {sorted(k for k in en.used_keys if k not in en.lang)[:5]}")
    for it in items:
        it["dg"] = re.sub(r"[^a-z0-9]+", "-", it["c"].lower()).strip("-")
    data = {
        "items": items,
        "spells": spells,
        "treasure": treasure,
        "templates": templates,
        "bases": bases,
        "packs": {"item": "pf2e.equipment-srd", "spell": "pf2e.spells-srd"},
        "classes": CLASS_NAMES,
    }
    with open(OUT, "w") as fh:
        fh.write("window.LB_DATA=")
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write(";\n")
    print(f"wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    with open(os.path.join(HERE, "data", "licenses.json"), "w") as fh:
        json.dump(licenses, fh, indent=1, sort_keys=True)
    write_orc_notice(licenses)


if __name__ == "__main__":
    main()

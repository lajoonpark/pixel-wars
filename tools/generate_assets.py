#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "generated"
SVG_OUT = ROOT / "public" / "assets" / "svg"
MANIFEST_PATH = ROOT / "public" / "assets" / "asset-manifest.json"

PALETTE = {
    "outline": (27, 36, 48, 255),
    "shadow": (0, 0, 0, 60),
    "player": (52, 149, 255, 255),
    "enemy": (255, 83, 89, 255),
    "neutral": (246, 213, 112, 255),
}

manifest: list[dict[str, Any]] = []


def ensure(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def record(name: str, rel_path: Path, intended_use: str, size: tuple[int, int], method: str) -> None:
    manifest.append(
        {
            "assetName": name,
            "filePath": str(rel_path).replace("\\", "/"),
            "intendedUse": intended_use,
            "size": f"{size[0]}x{size[1]}",
            "generationMethod": method,
        }
    )


def save_png(img: Image.Image, rel_path: str, name: str, intended_use: str, method: str = "Pillow") -> None:
    path = ROOT / rel_path
    ensure(path.parent)
    img.save(path, "PNG")
    record(name, Path(rel_path), intended_use, img.size, method)


def save_svg(content: str, rel_path: str, name: str, intended_use: str) -> None:
    path = ROOT / rel_path
    ensure(path.parent)
    path.write_text(content, encoding="utf-8")
    record(name, Path(rel_path), intended_use, (64, 64), "SVG")


def draw_tile(base: tuple[int, int, int], accents: list[tuple[tuple[int, int, int], tuple[int, int, int, int]]]) -> Image.Image:
    img = Image.new("RGBA", (32, 32), (*base, 255))
    d = ImageDraw.Draw(img)
    for _, (x1, y1, x2, y2) in accents:
        shade = (max(base[0] - 20, 0), max(base[1] - 20, 0), max(base[2] - 20, 0), 255)
        d.rectangle((x1, y1, x2, y2), fill=shade)
    d.rectangle((0, 0, 31, 31), outline=PALETTE["outline"])
    return img


def gen_tiles() -> None:
    tiles = {
        "plains": ((129, 187, 88), [((0, 0, 0), (4, 5, 10, 10)), ((0, 0, 0), (18, 12, 27, 16))]),
        "forest": ((73, 132, 69), [((0, 0, 0), (3, 7, 8, 24)), ((0, 0, 0), (17, 4, 24, 20))]),
        "mountain": ((122, 127, 133), [((0, 0, 0), (4, 11, 14, 23)), ((0, 0, 0), (16, 7, 28, 25))]),
        "river": ((78, 137, 219), [((0, 0, 0), (4, 10, 28, 15)), ((0, 0, 0), (6, 16, 26, 21))]),
        "swamp": ((82, 109, 72), [((0, 0, 0), (6, 12, 11, 16)), ((0, 0, 0), (17, 17, 23, 22))]),
        "snow": ((220, 232, 240), [((0, 0, 0), (6, 7, 10, 10)), ((0, 0, 0), (18, 15, 22, 19))]),
        "road": ((154, 131, 94), [((0, 0, 0), (0, 13, 31, 18)), ((0, 0, 0), (12, 0, 18, 31))]),
        "city_ground": ((141, 132, 144), [((0, 0, 0), (7, 9, 12, 14)), ((0, 0, 0), (16, 16, 25, 22))]),
    }
    for name, (base, accents) in tiles.items():
        img = draw_tile(base, accents)
        save_png(img, f"public/assets/generated/tiles/{name}.png", name, "terrain tile")


def gen_buildings() -> None:
    specs = {
        "farm": ((140, 95, 63), (112, 176, 78)),
        "military_camp": ((88, 108, 76), (175, 180, 89)),
        "city": ((104, 112, 129), (170, 173, 184)),
        "defense_outpost": ((102, 84, 95), (205, 102, 112)),
        "factory": ((84, 91, 99), (222, 171, 88)),
    }
    for name, (body, roof) in specs.items():
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((8, 21, 24, 29), fill=PALETTE["shadow"])
        d.rectangle((7, 12, 24, 24), fill=body, outline=PALETTE["outline"])
        d.polygon([(7, 12), (15, 6), (24, 12)], fill=roof, outline=PALETTE["outline"])
        d.rectangle((13, 16, 17, 24), fill=(40, 45, 51), outline=PALETTE["outline"])
        save_png(img, f"public/assets/generated/buildings/{name}.png", name, "building sprite")


def gen_building_animation() -> None:
    anim_specs = {
        "factory_working": (4, (240, 173, 72)),
        "farm_producing": (4, (142, 202, 109)),
        "city_active": (4, (125, 202, 255)),
        "outpost_firing": (4, (255, 108, 112)),
    }
    for anim_name, (frames, glow) in anim_specs.items():
        for i in range(frames):
            img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
            d = ImageDraw.Draw(img)
            d.rectangle((7, 12, 24, 24), fill=(97, 106, 118), outline=PALETTE["outline"])
            alpha = 90 + i * 35
            d.ellipse((10, 7, 22, 19), fill=(*glow, min(alpha, 210)))
            d.rectangle((12, 16, 19, 24), fill=(58, 63, 72), outline=PALETTE["outline"])
            save_png(
                img,
                f"public/assets/generated/buildings/anim/{anim_name}_{i}.png",
                f"{anim_name}_{i}",
                f"{anim_name} frame",
            )


def unit_frame(base: tuple[int, int, int], accent: tuple[int, int, int], stance: str, faction: str) -> Image.Image:
    img = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((6, 17, 18, 22), fill=PALETTE["shadow"])
    d.rectangle((8, 9, 16, 18), fill=base, outline=PALETTE["outline"])
    d.rectangle((9, 6, 15, 11), fill=accent, outline=PALETTE["outline"])
    d.rectangle((6, 11, 8, 16), fill=accent, outline=PALETTE["outline"])
    d.rectangle((16, 11, 18, 16), fill=accent, outline=PALETTE["outline"])
    banner = PALETTE["player"] if faction == "player" else PALETTE["enemy"]
    d.rectangle((10, 2, 14, 5), fill=banner, outline=PALETTE["outline"])
    if stance == "walk":
        d.rectangle((8, 18, 10, 22), fill=(42, 44, 49), outline=PALETTE["outline"])
        d.rectangle((14, 17, 16, 21), fill=(42, 44, 49), outline=PALETTE["outline"])
    elif stance == "attack":
        d.rectangle((16, 10, 22, 12), fill=(78, 80, 89), outline=PALETTE["outline"])
    return img


def tank_frame(faction: str, firing: bool = False) -> Image.Image:
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((7, 21, 25, 29), fill=PALETTE["shadow"])
    body = (80, 110, 90) if faction == "player" else (126, 86, 86)
    d.rectangle((6, 14, 26, 23), fill=body, outline=PALETTE["outline"])
    d.rectangle((10, 10, 22, 16), fill=(112, 122, 130), outline=PALETTE["outline"])
    d.rectangle((22, 12, 30, 14), fill=(102, 104, 110), outline=PALETTE["outline"])
    if firing:
        d.ellipse((29, 10, 31, 16), fill=(255, 210, 88))
    return img


def gen_units() -> None:
    unit_specs = {
        "infantry": ((96, 110, 120), (182, 189, 195)),
        "scout": ((88, 102, 109), (201, 184, 130)),
    }
    for faction in ("player", "enemy"):
        for unit_name, (base, accent) in unit_specs.items():
            for stance in ("idle", "walk", "attack"):
                for frame in range(4):
                    img = unit_frame(base, accent, stance, faction)
                    if frame % 2 == 1:
                        img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    save_png(
                        img,
                        f"public/assets/generated/units/{faction}/{unit_name}_{stance}_{frame}.png",
                        f"{faction}_{unit_name}_{stance}_{frame}",
                        f"{unit_name} {stance} frame",
                    )
        for frame in range(4):
            move_img = tank_frame(faction, False)
            fire_img = tank_frame(faction, True)
            if frame % 2 == 1:
                move_img = move_img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                fire_img = fire_img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            save_png(
                move_img,
                f"public/assets/generated/units/{faction}/tank_move_{frame}.png",
                f"{faction}_tank_move_{frame}",
                "tank move frame",
            )
            save_png(
                fire_img,
                f"public/assets/generated/units/{faction}/tank_fire_{frame}.png",
                f"{faction}_tank_fire_{frame}",
                "tank fire frame",
            )


def gen_combat_effects() -> None:
    bullet = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(bullet)
    d.ellipse((2, 2, 6, 6), fill=(255, 226, 112), outline=PALETTE["outline"])
    save_png(bullet, "public/assets/generated/effects/bullet.png", "bullet", "bullet effect")

    shell = Image.new("RGBA", (16, 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(shell)
    d.rectangle((2, 3, 12, 5), fill=(255, 188, 89), outline=PALETTE["outline"])
    d.polygon([(12, 2), (15, 4), (12, 6)], fill=(255, 215, 120), outline=PALETTE["outline"])
    save_png(shell, "public/assets/generated/effects/shell_trail.png", "shell_trail", "shell trail effect")

    ring = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(ring)
    d.ellipse((4, 20, 28, 30), outline=(83, 221, 255), width=2)
    save_png(ring, "public/assets/generated/effects/selection_ring.png", "selection_ring", "selection highlight")

    for i in range(6):
        exp = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        d = ImageDraw.Draw(exp)
        r = 4 + i * 3
        d.ellipse((16 - r, 16 - r, 16 + r, 16 + r), fill=(255, max(40, 184 - i * 25), 55, 220), outline=PALETTE["outline"])
        save_png(exp, f"public/assets/generated/effects/explosion_{i}.png", f"explosion_{i}", "explosion frame")

    dmg = Image.new("RGBA", (64, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(dmg)
    for i in range(10):
        x = i * 6
        d.rectangle((x, 2, x + 5, 13), outline=PALETTE["outline"], fill=(255, 102, 102))
    save_png(dmg, "public/assets/generated/effects/damage_numbers.png", "damage_numbers", "damage number strip")


def weather_frame(kind: str, frame: int) -> Image.Image:
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if kind == "rain":
        for i in range(0, 256, 20):
            y = (i + frame * 7) % 256
            d.line((i, y, i + 8, y + 14), fill=(126, 170, 236, 110), width=1)
    elif kind == "snowstorm":
        for i in range(0, 256, 18):
            y = (i + frame * 5) % 256
            d.ellipse((i, y, i + 3, y + 3), fill=(255, 255, 255, 120))
    elif kind == "sandstorm":
        for i in range(0, 256, 22):
            y = (i + frame * 4) % 256
            d.rectangle((i, y, i + 8, y + 2), fill=(201, 161, 101, 100))
    elif kind == "fog":
        d.ellipse((30 + frame * 5, 70, 220, 170), fill=(150, 167, 181, 95))
        d.ellipse((20, 120, 240 - frame * 4, 220), fill=(131, 148, 161, 85))
    return img


def gen_weather() -> None:
    for kind in ("rain", "fog", "snowstorm", "sandstorm"):
        for i in range(4):
            img = weather_frame(kind, i)
            save_png(
                img,
                f"public/assets/generated/weather/{kind}_{i}.png",
                f"{kind}_{i}",
                f"{kind} overlay frame",
            )

    fow = Image.new("RGBA", (256, 256), (23, 26, 39, 142))
    save_png(fow, "public/assets/generated/weather/fog_of_war.png", "fog_of_war", "darkened fog-of-war layer")


def icon_svg(path_d: str, color: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="1" y="1" width="62" height="62" rx="10" fill="#1e2733" stroke="#0d131a" stroke-width="2"/>
  <path d="{path_d}" fill="{color}" stroke="#0d131a" stroke-width="2" stroke-linejoin="round"/>
</svg>
"""


def gen_svgs() -> None:
    ui_icons = {
        "build": "M14 44h36v8H14zm8-8h20v8H22zm6-20h8v16h-8z",
        "move": "M8 32h48M32 8v48M48 16l8 16-8 14M16 16L8 32l8 14",
        "attack": "M10 42l14-22 9 6 18-14-12 21-8-6-12 17z",
        "stop": "M16 16h32v32H16z",
        "research": "M20 16h24l6 8-18 24L14 24z",
        "donate": "M14 26h36v24H14zM18 18h28v8H18z",
        "alliance": "M10 36l10-16 12 8 12-8 10 16-22 14z",
        "weather": "M16 40h32a10 10 0 0 0 0-20 13 13 0 0 0-25-3 9 9 0 0 0-7 23z",
        "vision": "M6 32s10-14 26-14 26 14 26 14-10 14-26 14S6 32 6 32zm26 8a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
    }
    eco_icons = {
        "money": "M10 20h44v24H10zM18 26h8v12h-8zm20 0h8v12h-8z",
        "population": "M14 44c0-8 8-12 18-12s18 4 18 12v6H14zm8-20a10 10 0 1 1 20 0 10 10 0 0 1-20 0z",
        "weapons": "M8 44l30-30 8 8-30 30H8zM42 10l8 8",
        "tanks": "M8 30h34l8 10H8zM12 22h20v8H12zM18 18h8v4h-8z",
        "supply": "M12 16h40v32H12zM20 24h24M20 32h24M20 40h16",
        "research": "M20 10h24l8 8-20 36L12 18z",
    }
    tech_icons = {
        "tech_ballistics": "M10 40l20-26 8 6 16-10-12 20-8-6-12 20z",
        "tech_logistics": "M12 18h40v10H12zm6 16h28v12H18z",
        "tech_armor": "M32 8l20 8v16c0 12-8 20-20 24-12-4-20-12-20-24V16z",
        "tech_medicine": "M26 10h12v18h18v12H38v18H26V40H8V28h18z",
        "tech_sensors": "M32 10l14 14-14 14-14-14zM16 48h32",
        "tech_industry": "M12 44h40v8H12zM18 20h8v24h-8zm20-8h8v32h-8z",
    }
    for name, path_d in {**ui_icons, **eco_icons, **tech_icons}.items():
        save_svg(icon_svg(path_d, "#9ed2ff"), f"public/assets/svg/{name}.svg", name, "ui or economy icon")

    factions = {
        "player_banner": ("#3495ff", "#90c8ff"),
        "enemy_banner": ("#ff5359", "#ff9da0"),
    }
    for name, (main, detail) in factions.items():
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 64">
  <rect x="2" y="2" width="124" height="60" rx="10" fill="#1d2530" stroke="#0c1218" stroke-width="4"/>
  <path d="M16 32h96" stroke="{main}" stroke-width="16" stroke-linecap="round"/>
  <path d="M54 18h20v28H54z" fill="{detail}" stroke="#0c1218" stroke-width="3"/>
</svg>
"""
        save_svg(svg, f"public/assets/svg/{name}.svg", name, "faction banner/emblem")


def main() -> None:
    ensure(OUT)
    ensure(SVG_OUT)
    gen_tiles()
    gen_buildings()
    gen_building_animation()
    gen_units()
    gen_combat_effects()
    gen_weather()
    gen_svgs()
    ensure(MANIFEST_PATH.parent)
    MANIFEST_PATH.write_text(json.dumps({"assets": manifest}, indent=2), encoding="utf-8")
    print(f"Generated {len(manifest)} assets -> {MANIFEST_PATH}")


if __name__ == "__main__":
    main()

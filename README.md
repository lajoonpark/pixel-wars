# Pixel Wars Prototype

First playable real-time prototype for a fast-paced pixel-war strategy game using TypeScript + Phaser.

## Run

```bash
npm install
python3 -m pip install -r requirements.txt
npm run assets:generate
npm run dev
```

## Controls

- WASD / Arrow keys: move camera
- Mouse wheel: zoom
- Left drag: drag-select player infantry
- Left click: single select
- Right click: issue tile movement command

## Prototype Features

- Real-time tile-based battlefield
- Two factions (Player blue, Enemy red)
- Infantry unit selection, movement, and auto-combat
- Fast time-to-kill combat readability
- Minimap and top HUD (population, money, army size, selected units)
- Generated pixel-art assets and SVG icon set

## Asset Pipeline

- Pixel PNG assets are generated with Pillow via `tools/generate_assets.py`
- Scalable UI/tech/resource/faction icons are generated as SVG
- Asset manifest is generated at `public/assets/asset-manifest.json`

Regenerate all assets:

```bash
npm run assets:generate
```

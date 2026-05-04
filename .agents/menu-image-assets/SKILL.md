---
name: menu-image-assets
description: Generate Saizeriya-style generic menu item image assets for Betterzeriya. Use when the agent needs to create or refresh menu item thumbnails from apps/betterzeriya/src/lib/assets/data/menu.json using 4x4 generated contact sheets, split them into per-code WebP files, and update imageUrl values. This skill must use generic casual Italian restaurant food imagery only: no Saizeriya logos, trademarks, signage, text, labels, or brand marks.
---

# Menu Image Assets

Generate menu thumbnails by asking the image generation tool for 4x4 contact sheets, then split each sheet into per-menu-item images.

## Outputs

- Final item images: `apps/betterzeriya/src/lib/assets/image/{code}.webp`
- UI references: `apps/betterzeriya/src/routes/sessions/[id]/+page.svelte` loads images with `import.meta.glob('../../../lib/assets/image/*.webp', { eager: true, query: '?url', import: 'default' })`
- Menu data: keep `apps/betterzeriya/src/lib/assets/data/menu.json` free of generated public URLs; use `imageUrl` only for explicit external/official image URLs.
- Temporary sheet files: `tmp/menu-image-sheets/sheet-001.webp`, etc.

Do not reference images directly from `$CODEX_HOME/generated_images`. Copy or convert them into the workspace first.

## Workflow

1. Read `apps/betterzeriya/src/lib/assets/data/menu.json`.
2. Chunk menu entries into groups of 16 in file order.
3. For each chunk, call the built-in image generation tool once with the prompt template below.
4. Find the newly generated files under `$CODEX_HOME/generated_images/<thread-id>/`.
5. Copy or convert the generated sheets to `tmp/menu-image-sheets/sheet-001.webp`, `sheet-002.webp`, and so on in generation order.
6. Split every sheet into a 4x4 grid in left-to-right, top-to-bottom order.
7. Save each crop as `apps/betterzeriya/src/lib/assets/image/{code}.webp`, preferably 512x512 WebP.
8. Ensure the UI maps each menu `code` to its generated asset through `import.meta.glob`.
9. Run `bun check:fix` and `bun run test`.

## Prompt Template

Use this prompt once per 16-item chunk. Normalize half-width kana in menu names with `NFKC` before inserting them.

```text
Create one square contact-sheet image divided into an exact 4x4 grid of equal square cells.
Each cell is a realistic, appetizing food photo for one menu item from a generic Japanese casual Italian family restaurant.
Order is strict: fill the grid left-to-right across the top row, then the second row, third row, and bottom row.

Menu items:
1. row 1, column 1: <item 1 name>
2. row 1, column 2: <item 2 name>
3. row 1, column 3: <item 3 name>
4. row 1, column 4: <item 4 name>
5. row 2, column 1: <item 5 name>
6. row 2, column 2: <item 6 name>
7. row 2, column 3: <item 7 name>
8. row 2, column 4: <item 8 name>
9. row 3, column 1: <item 9 name>
10. row 3, column 2: <item 10 name>
11. row 3, column 3: <item 11 name>
12. row 3, column 4: <item 12 name>
13. row 4, column 1: <item 13 name>
14. row 4, column 2: <item 14 name>
15. row 4, column 3: <item 15 name>
16. row 4, column 4: <item 16 name>

Style: clean menu photography, centered dish, natural restaurant table lighting, consistent camera angle, realistic plating, no people.
Layout: 4 columns by 4 rows, equal cell sizes, each dish fully contained in its own cell with enough padding for later cropping.
Constraints: no text, no labels, no numbers, no logos, no watermarks, no brand marks, no trademarks, no restaurant signage, no mascots, no Saizeriya branding.
For any empty unused cell, leave the cell as a plain neutral tabletop with no dish and no text.
```

## Local Split Snippet

Use a local image tool available in the repo/environment. If `sharp` is not installed, use `bunx sharp-cli`, ImageMagick, Pillow, or another available image processor. Avoid adding runtime dependencies just for a one-off split.

The split must:

- Center-crop each sheet to a square if needed.
- Divide the square into four equal columns and four equal rows.
- Map crop index `0..15` to the matching menu chunk item.
- Resize each output to `512x512`.
- Save as WebP.

After splitting, verify:

```bash
find apps/betterzeriya/src/lib/assets/image -type f -name '*.webp' | wc -l
node -e "const menu=require('./apps/betterzeriya/src/lib/assets/data/menu.json'); console.log(menu.length, menu.filter((item)=>item.imageUrl).length)"
```

## Safety Notes

- These are generated approximations, not exact official product photos.
- Never include Saizeriya logos, signage, trademarks, or in-image menu text.
- Keep original generated files in `$CODEX_HOME/generated_images`; do not delete them unless explicitly asked.

# Product screenshots

Drop a file here named after the slot and it replaces the placeholder on next
render. No code change, no re-layout — the box is already the right shape.

Accepted extensions: `.png` `.jpg` `.jpeg` `.webp` `.avif`

| File | Ratio | What it shows |
| --- | --- | --- |
| `heroGrid.png` | 2:1 | A retailer grid row — three cards, each carrying its own **Try this look** button top-right |
| `cardButton.png` | 4:7 | A single product card on the store's own page — button top-right, tick top-left |
| `fitPanel.png` | 1:1 | Side panel — a top from one store and jeans from another, ticked, **Try this fit (2)** |
| `fitResult.png` | 2:3 | The composed cross-store render with the applied pieces listed underneath |
| `collections.png` | 1:2 | Saved tab — twelve looks, mixed retailers, filed into collections |
| `expertContext.jpg` | 560:817 | Actual side panel — the generated try-on and the expert analysis opening below it |
| `expertOpinion.jpg` | 560:817 | Actual expert UI — fit feedback, colour pairings, suggestions and follow-up prompts |
| `uploadOnce.png` | 1:1 | One uploaded portrait branching into several garment choices |
| `sourceIntegrity.png` | 1:1 | The same garment preserved from source to fitted result |

Ratios are matched to the captures they hold, so `object-cover` trims very
little. If a file's own ratio differs, the centre is kept and the long edge is
cropped — so leave a little headroom around anything that must stay in frame.

Slot metadata lives in [`lib/shots-meta.ts`](../../lib/shots-meta.ts); the
filesystem lookup is in [`lib/shots.ts`](../../lib/shots.ts). To change a slot's
shape, edit `ratio` there — nothing else needs touching.

The pipeline diagram in "How it works" is drawn as inline SVG
([`components/site/pipeline-diagram.tsx`](../../components/site/pipeline-diagram.tsx)),
so it needs no capture.

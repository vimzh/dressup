/**
 * Product screenshots live in `public/shots/`. Each slot renders the real image
 * the moment a file with the matching name appears, and falls back to labelled
 * scaffolding until then — so recapturing is a drop-in, never a re-layout.
 * Ratios are the captures' own pixel ratios, so `object-cover` trims nothing.
 * See `public/shots/README.md`.
 *
 * Metadata only: safe to import from client components. The filesystem lookup
 * lives in `lib/shots.ts`, which is server-only.
 */
export const SHOTS = {
  cardButton: {
    label:
      "One product card on the retailer's own page — Try this look in the top-right, tick in the top-left",
    ratio: "476 / 844",
    size: "476 × 844",
  },
  collections: {
    label: "Saved tab — twelve looks, mixed retailers, filed into collections",
    ratio: "810 / 1658",
    size: "810 × 1658",
  },
  collectionsDetail: {
    label: "Saved looks — a closer view of the collection grid",
    ratio: "730 / 1200",
    size: "730 × 1200",
  },
  expertContext: {
    label:
      "Actual Z-dress side panel — a generated try-on with the AI expert analysis opening below it",
    ratio: "560 / 817",
    size: "560 × 817",
  },
  expertOpinion: {
    label:
      "Actual Z-dress AI expert interface — fit feedback, colour pairings, suggestions and follow-up questions",
    ratio: "560 / 817",
    size: "560 × 817",
  },
  fitPanel: {
    label:
      "Side panel — a shirt and jeans from AJIO ticked together, ready to render as one fit",
    ratio: "1030 / 1014",
    size: "1030 × 1014",
  },
  fitResult: {
    label: "The composed cross-store render, with the pieces it applied listed",
    ratio: "1070 / 1556",
    size: "1070 × 1556",
  },
  gridAfter: {
    label:
      "The same row after — every card swapped to its own render, each marked ON YOU with save, opinion and revert",
    ratio: "1946 / 1110",
    size: "1946 × 1110",
  },
  gridBefore: {
    label:
      "A row of product cards as the store ships them, each carrying its own Try this look button in the top-right",
    ratio: "1946 / 1105",
    size: "1946 × 1105",
  },
  gridParallel: {
    label:
      "Three cards mid-render at the same time — each showing its own Trying on… pill",
    ratio: "1946 / 1130",
    size: "1946 × 1130",
  },
  heroGrid: {
    label:
      "A Myntra grid mid-scroll — every card carrying its own Try this look button in the top-right",
    ratio: "1533 / 750",
    size: "1533 × 750",
  },
  sourceIntegrity: {
    label:
      "The same striped shirt preserved from source garment to fitted result",
    ratio: "1 / 1",
    size: "1254 × 1254",
  },
  uploadOnce: {
    label:
      "One uploaded portrait branching into several garments without another setup step",
    ratio: "1 / 1",
    size: "1254 × 1254",
  },
} as const;

export type ShotName = keyof typeof SHOTS;
export type ResolvedShots = Record<ShotName, string | null>;

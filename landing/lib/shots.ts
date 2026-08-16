import fs from "node:fs";
import path from "node:path";
import {
  type ResolvedShots,
  SHOTS,
  type ShotName,
} from "@/lib/shots-meta";

const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif"];

/** Server-only. Returns a public path per shot, or null if not captured yet. */
export function resolveShots(): ResolvedShots {
  const dir = path.join(process.cwd(), "public", "shots");
  const entries = new Map<ShotName, string | null>();

  for (const name of Object.keys(SHOTS) as ShotName[]) {
    const hit = EXTENSIONS.map((ext) => `${name}${ext}`).find((file) =>
      fs.existsSync(path.join(dir, file))
    );
    entries.set(name, hit ? `/shots/${hit}` : null);
  }

  return Object.fromEntries(entries) as ResolvedShots;
}

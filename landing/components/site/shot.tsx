import Image from "next/image";
import { cn } from "@/lib/utils";
import { SHOTS, type ShotName } from "@/lib/shots-meta";

/**
 * Renders the real product screenshot when one has been captured, and holds the
 * exact space it will occupy — labelled — when it hasn't.
 */
export function Shot({
  name,
  src,
  className,
  frame,
  priority = false,
}: {
  name: ShotName;
  src: string | null;
  className?: string;
  /** Caps the width of tall portrait captures so they don't dominate a card. */
  frame?: string;
  priority?: boolean;
}) {
  const { label, ratio, size } = SHOTS[name];

  if (src) {
    return (
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xs border border-white/10 bg-white/[0.02]",
          frame && "mx-auto",
          frame,
          className
        )}
        style={{ aspectRatio: ratio }}
      >
        <Image
          alt={label}
          className="object-cover"
          fill
          priority={priority}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 900px"
          src={src}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xs border border-white/15 border-dashed bg-white/[0.025]",
        frame && "mx-auto",
        frame,
        className
      )}
      style={{ aspectRatio: ratio }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(115deg,transparent_46%,color-mix(in_oklab,var(--glow)_9%,transparent)_50%,transparent_54%)]"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center">
        <span className="font-mono text-[10px] text-white/35 uppercase tracking-[0.18em]">
          {name}
        </span>
        <span className="max-w-[34ch] text-balance text-sm text-white/50 leading-snug">
          {label}
        </span>
        <span className="font-mono text-[10px] text-white/25 tracking-wide">
          {size}
        </span>
      </div>
    </div>
  );
}

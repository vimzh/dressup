"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Card whose highlight tracks the cursor. The gradient is driven by motion
 * values written straight to a CSS custom property, so pointer movement never
 * triggers a React render.
 */
export function FeatureCard({
  index,
  title,
  children,
  media,
  className,
}: {
  index: number;
  title: string;
  children: ReactNode;
  media?: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const mouseX = useMotionValue(-400);
  const mouseY = useMotionValue(-400);

  const spotlight = useMotionTemplate`radial-gradient(340px circle at ${mouseX}px ${mouseY}px, color-mix(in oklab, var(--glow) 20%, transparent), transparent 72%)`;

  const track = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    mouseX.set(event.clientX - rect.left);
    mouseY.set(event.clientY - rect.top);
  };

  return (
    <motion.div
      className={cn(
        "group relative overflow-hidden rounded-xs border border-white/10 bg-white/[0.02] p-7 backdrop-blur-sm transition-colors duration-500 hover:border-white/20 sm:p-8",
        className
      )}
      initial={
        reduced ? { opacity: 0 } : { opacity: 0, y: 34, filter: "blur(8px)" }
      }
      onMouseMove={track}
      transition={{
        delay: (index % 3) * 0.08,
        duration: 0.75,
        ease: EASE,
      }}
      viewport={{ margin: "-64px", once: true }}
      whileInView={
        reduced ? { opacity: 1 } : { filter: "blur(0px)", opacity: 1, y: 0 }
      }
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-400 group-hover:opacity-100"
        style={{ background: spotlight }}
      />

      <div className="relative flex h-full flex-col">
        <span className="mb-5 font-mono text-[11px] text-glow/70 tabular-nums tracking-[0.2em]">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="display-section mb-3 text-2xl text-white sm:text-[1.75rem]">
          {title}
        </h3>
        <div className="text-[15px] text-white/55 leading-relaxed [&_strong]:font-medium [&_strong]:text-white/85">
          {children}
        </div>
        {media ? <div className="mt-7">{media}</div> : null}
      </div>
    </motion.div>
  );
}

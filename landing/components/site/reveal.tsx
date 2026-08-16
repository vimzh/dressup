"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

export function Reveal({
  children,
  className,
  delay = 0,
  y = 26,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li" | "span";
}) {
  const reduced = useReducedMotion();
  const Tag = motion[as];

  return (
    <Tag
      className={className}
      initial={
        reduced
          ? { opacity: 0 }
          : { opacity: 0, y, filter: "blur(8px)" }
      }
      transition={{ delay, duration: 0.75, ease: EASE }}
      viewport={{ margin: "-72px", once: true }}
      whileInView={
        reduced
          ? { opacity: 1 }
          : { filter: "blur(0px)", opacity: 1, y: 0 }
      }
    >
      {children}
    </Tag>
  );
}

/**
 * Per-character entrance for the hero. Words are kept whole so the line still
 * wraps at spaces; only the glyphs inside them are staggered.
 */
export function SplitHeading({
  text,
  className,
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const words = text.split(" ");
  let index = 0;

  return (
    <motion.span
      animate="show"
      className={className}
      initial="hidden"
      transition={{ delayChildren: delay, staggerChildren: reduced ? 0 : 0.028 }}
      variants={{ hidden: {}, show: {} }}
    >
      {words.map((word, wordIndex) => (
        <span className="inline-block whitespace-nowrap" key={word + wordIndex}>
          {word.split("").map((char) => {
            index += 1;
            return (
              <motion.span
                className="inline-block will-change-[transform,filter]"
                key={char + index}
                transition={{ duration: 0.9, ease: EASE }}
                variants={{
                  hidden: reduced
                    ? { opacity: 0 }
                    : { filter: "blur(14px)", opacity: 0, y: "0.42em" },
                  show: reduced
                    ? { opacity: 1 }
                    : { filter: "blur(0px)", opacity: 1, y: "0em" },
                }}
              >
                {char}
              </motion.span>
            );
          })}
          {wordIndex < words.length - 1 ? (
            <span className="inline-block">&nbsp;</span>
          ) : null}
        </span>
      ))}
    </motion.span>
  );
}

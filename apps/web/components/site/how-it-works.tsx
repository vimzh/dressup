"use client";

import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { PipelineDiagram } from "@/components/site/pipeline-diagram";
import { Reveal } from "@/components/site/reveal";

const STEPS = [
  {
    body: "Use a clear full-body photo. Zdress screens it once so unsuitable crops fail before they affect every try-on.",
    meta: "once",
    title: "Upload your photo",
  },
  {
    body: "Browse any supported store. Product cards receive Try this look and Add to fit controls automatically.",
    meta: "any of 17 sites",
    title: "Open any product page",
  },
  {
    body: "A vision pre-flight identifies the garment category and rejects bags, banners and unsupported items before YouCam is called.",
    meta: "before any spend",
    title: "Screened before anything is spent",
  },
  {
    body: "Zdress uploads the garment, creates and polls the YouCam task, then swaps the result into the product card.",
    meta: "in place",
    title: "YouCam renders it, in place",
  },
];

export function HowItWorks() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    offset: ["start 70%", "end 60%"],
    target: trackRef,
  });
  const drawn = useSpring(scrollYProgress, {
    damping: 32,
    restDelta: 0.001,
    stiffness: 90,
  });
  const glowY = useTransform(drawn, (v) => `${v * 100}%`);

  return (
    <section className="relative px-6 py-24 sm:py-32" id="how-it-works">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <p className="mb-4 font-mono text-[11px] text-glow/70 uppercase tracking-[0.22em]">
            How it works
          </p>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="display-section max-w-3xl text-balance text-[clamp(2.25rem,6vw,4.25rem)] text-white">
            Four steps, and only one of them is yours
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
          <div className="relative" ref={trackRef}>
            {/* Rail: a static hairline with a progress line drawn over it. */}
            <div
              aria-hidden="true"
              className="absolute top-2 bottom-2 left-[15px] w-px bg-white/10"
            />
            <motion.div
              aria-hidden="true"
              className="absolute top-2 bottom-2 left-[15px] w-px origin-top bg-glow"
              style={{ scaleY: drawn }}
            />
            <motion.div
              aria-hidden="true"
              className="absolute left-[11px] size-2.5 rounded-full bg-glow shadow-[0_0_18px_6px_color-mix(in_oklab,var(--glow)_55%,transparent)]"
              style={{ top: glowY }}
            />

            <ol className="space-y-14">
              {STEPS.map((step, i) => (
                <motion.li
                  className="relative pl-12"
                  initial={{ opacity: 0, x: -14, filter: "blur(6px)" }}
                  key={step.title}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  viewport={{ margin: "-96px", once: true }}
                  whileInView={{ filter: "blur(0px)", opacity: 1, x: 0 }}
                >
                  <span className="absolute top-0.5 left-0 flex size-8 items-center justify-center rounded-xs border border-white/15 bg-background font-mono text-[11px] text-white/60 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="display-section text-xl text-white sm:text-2xl">
                      {step.title}
                    </h3>
                    <span className="font-mono text-[11px] text-glow/60 tracking-wide">
                      {step.meta}
                    </span>
                  </div>
                  <p className="mt-3 max-w-xl text-[15px] text-white/50 leading-relaxed">
                    {step.body}
                  </p>
                </motion.li>
              ))}
            </ol>
          </div>

          <div className="lg:sticky lg:top-28 lg:self-start">
            <PipelineDiagram />
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useScroll, useSpring } from "motion/react";

const HACKATHON_URL = "https://youcam-api.devpost.com/";

export function TopBanner() {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    damping: 30,
    restDelta: 0.001,
    stiffness: 120,
  });

  return (
    <div className="sticky top-0 z-50 bg-black">
      <a
        className="group flex items-center justify-center gap-x-2 gap-y-0.5 px-4 py-2.5 text-center"
        href={HACKATHON_URL}
        rel="noreferrer"
        target="_blank"
      >
        <span className="text-[13px] text-white/70 leading-tight">
          Built for the{" "}
          <span className="text-white">
            YouCam API Skin AI &amp; Apparel VTO Hackathon
          </span>
          <span className="mx-2 hidden text-white/25 sm:inline">/</span>
          <span className="hidden sm:inline">
            powered by{" "}
            <span className="text-white">YouCam Apparel Virtual Try-On</span>
          </span>
        </span>
        <ArrowUpRight className="size-3.5 shrink-0 text-white/40 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white" />
      </a>

      {/* Reading progress for the whole page. */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px origin-left bg-glow"
        style={{ scaleX: progress }}
      />
    </div>
  );
}

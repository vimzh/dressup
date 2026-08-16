"use client";

import {
  Bookmark,
  Check,
  Copy,
  Download,
  Flame,
  Layers,
  Store,
  Terminal,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useState } from "react";
import SmoothButton from "@/components/smoothui/smooth-button";
import { SplitHeading } from "@/components/site/reveal";
import { Shot } from "@/components/site/shot";
import type { ResolvedShots } from "@/lib/shots-meta";

const EASE = [0.16, 1, 0.3, 1] as const;
const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/vimzh/dressup/main/apps/web/public/downloads/install-zdress.command -o /tmp/install-zdress.command && bash /tmp/install-zdress.command";

const CROSS_SITE = [
  {
    body: "Pick pieces on different stores and combine them into one outfit.",
    icon: Store,
    title: "Build across sites",
  },
  {
    body: "Tops, bottoms and shoes return as one finished try-on.",
    icon: Layers,
    title: "Rendered as one look",
  },
  {
    body: "Save looks into collections and revisit them whenever.",
    icon: Bookmark,
    title: "Kept, not lost",
  },
];

export function Hero({ shots }: { shots: ResolvedShots }) {
  const reduced = useReducedMotion();
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  const rise = (delay: number) => ({
    animate: { filter: "blur(0px)", opacity: 1, y: 0 },
    initial: reduced
      ? { opacity: 0 }
      : { filter: "blur(6px)", opacity: 0, y: 18 },
    transition: { delay, duration: 0.8, ease: EASE },
  });

  return (
    <section className="relative px-6 pt-20 pb-16 sm:pt-28 sm:pb-24">
      <div className="mx-auto max-w-5xl">
        <motion.p
          className="mb-7 flex items-center justify-center gap-2.5 text-center"
          {...rise(0.05)}
        >
          <Image
            alt="Zdress"
            className="size-8"
            height={32}
            priority
            src="/brand/zdress-mark.png"
            width={32}
          />
          <span className="font-mono text-[11px] text-white/45 uppercase tracking-[0.22em]">
            Apparel Virtual Try-On
          </span>
        </motion.p>

        <h1 className="display-poster text-center text-[clamp(3.5rem,15vw,10.5rem)] text-white">
          <SplitHeading delay={0.15} text="The model" />
          <br />
          <span className="text-glow">
            <SplitHeading delay={0.42} text="is you" />
          </span>
        </h1>

        <motion.p
          className="mx-auto mt-8 max-w-2xl text-balance text-center text-base text-white/60 leading-relaxed sm:text-lg"
          {...rise(0.75)}
        >
          Upload your photo once. Zdress adds a{" "}
          <span className="text-white/90">Try this look</span> button across
          sixteen retailers and Pinterest, then swaps each product photo for
          you wearing it. Without leaving the page.
        </motion.p>

        <motion.div
          className="mt-11 flex flex-col items-center justify-center gap-3 sm:flex-row"
          {...rise(0.88)}
        >
          <SmoothButton
            asChild
            className="w-full sm:w-auto"
            size="lg"
            variant="candy"
          >
            <a download href="/downloads/zdress-installer-macos.zip">
              <Download /> Download Chrome installer
            </a>
          </SmoothButton>
          <SmoothButton
            className="w-full sm:w-auto"
            color="neutral"
            prefix={<Flame />}
            size="lg"
            variant="candy"
          >
            Install for Firefox
          </SmoothButton>
        </motion.div>

        <motion.div
          className="mx-auto mt-5 max-w-2xl rounded-lg border border-white/10 bg-black/25 p-3 text-left"
          {...rise(0.96)}
        >
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <span className="flex items-center gap-2 font-mono text-[11px] text-white/55 uppercase tracking-[0.16em]">
              <Terminal className="size-3.5 text-glow" /> Terminal install · macOS
            </span>
            <button
              aria-live="polite"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11px] text-white/55 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glow"
              onClick={copyInstallCommand}
              type="button"
            >
              {copyStatus === "copied" ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copyStatus === "copied"
                ? "Copied"
                : copyStatus === "error"
                  ? "Copy failed"
                  : "Copy"}
            </button>
          </div>
          <code className="block overflow-x-auto rounded-md bg-black/40 px-3 py-3 font-mono text-[12px] text-white/70 leading-relaxed whitespace-nowrap">
            {INSTALL_COMMAND}
          </code>
          <p className="px-1 pt-2 text-[12px] text-white/40 leading-relaxed">
            Downloads and unpacks Zdress, opens Chrome Extensions, and copies
            the folder path. Chrome still requires the final Load unpacked
            approval.
          </p>
        </motion.div>

        {/* The thing that makes it more than a widget: it isn't bound to one store. */}
        <motion.div
          className="mt-16 grid gap-px overflow-hidden rounded-xs border border-white/10 bg-white/10 sm:mt-20 sm:grid-cols-3"
          {...rise(1.06)}
        >
          {CROSS_SITE.map(({ body, icon: Icon, title }) => (
            <div
              className="group bg-background/80 p-6 backdrop-blur-sm transition-colors duration-500 hover:bg-background/40"
              key={title}
            >
              <Icon className="mb-4 size-4 text-glow transition-transform duration-500 group-hover:-translate-y-0.5" />
              <h2 className="display-section mb-2 text-base text-white">
                {title}
              </h2>
              <p className="text-[13px] text-white/50 leading-relaxed">{body}</p>
            </div>
          ))}
        </motion.div>

        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="mt-6"
          initial={
            reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 40 }
          }
          transition={{ delay: 1.15, duration: 1, ease: EASE }}
        >
          <Shot name="heroGrid" priority src={shots.heroGrid} />
        </motion.div>
      </div>
    </section>
  );
}

import { Download, Flame } from "lucide-react";
import SmoothButton from "@/components/smoothui/smooth-button";
import { Reveal } from "@/components/site/reveal";

export function Footer() {
  return (
    <footer className="relative px-6 pt-16 pb-14">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <div className="rounded-xs border border-white/10 bg-white/[0.02] px-8 py-14 text-center sm:px-14 sm:py-20">
            <h2 className="display-poster mx-auto max-w-3xl text-balance text-[clamp(2.5rem,8vw,5.5rem)] text-white">
              Stop guessing.{" "}
              <span className="text-glow">Start seeing.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-balance text-[15px] text-white/50 leading-relaxed">
              Try products on the pages you already shop, then keep the looks
              that work.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
            </div>
          </div>
        </Reveal>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-white/10 border-t pt-8 sm:flex-row">
          <p className="font-mono text-[11px] text-white/30 tracking-wide">
            Zdress — powered by YouCam Apparel Virtual Try-On
          </p>
          <nav className="flex items-center gap-6 text-[13px]">
            <a
              className="text-white/45 transition-colors hover:text-white"
              href="https://youcam-api.devpost.com/"
              rel="noreferrer"
              target="_blank"
            >
              Hackathon
            </a>
            <a
              className="text-white/45 transition-colors hover:text-white"
              href="https://yce.perfectcorp.com/business/api"
              rel="noreferrer"
              target="_blank"
            >
              YouCam API
            </a>
            <a
              className="text-white/45 transition-colors hover:text-white"
              href="#features"
            >
              Features
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

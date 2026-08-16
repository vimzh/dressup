"use client";

import { motion, useReducedMotion } from "motion/react";

const BOXES = [
  { lane: "page", title: "Product card · Try this look", y: 20 },
  { lane: "extension", title: "content script", y: 84 },
  { lane: "extension", title: "service worker", y: 148 },
  { lane: "backend · localhost", title: "POST /api/tryon", y: 218 },
  { lane: "page", title: "card render swap", y: 376 },
];

const CALLS = [
  { note: "screen + categorise", title: "vision pre-flight", y: 278 },
  { note: "upload → task → poll", title: "YouCam cloth", y: 322 },
];

const BOX_X = 44;
const BOX_W = 236;
const BOX_H = 36;

/**
 * The request path, drawn rather than screenshotted — it is a diagram, not a
 * product surface. Connectors draw themselves in on first view.
 */
export function PipelineDiagram() {
  const reduced = useReducedMotion();

  const stroke = (delay: number) => ({
    initial: reduced ? { pathLength: 1 } : { pathLength: 0 },
    transition: { delay, duration: 0.7, ease: "easeInOut" as const },
    viewport: { margin: "-64px", once: true },
    whileInView: { pathLength: 1 },
  });

  return (
    <div className="relative w-full overflow-hidden rounded-xs border border-white/10 bg-white/[0.02] p-4">
      <svg
        aria-label="Request path: a click in the product grid travels through the content script and service worker to a local Node backend, which screens the garment and calls YouCam to render it, then swaps the result back into the card."
        className="w-full"
        role="img"
        viewBox="0 0 320 440"
      >
        <defs>
          <marker
            id="arrow"
            markerHeight="6"
            markerWidth="6"
            orient="auto"
            refX="5"
            refY="3"
          >
            <path d="M0,0 L6,3 L0,6 z" fill="rgba(255,255,255,0.35)" />
          </marker>
          <marker
            id="arrow-glow"
            markerHeight="6"
            markerWidth="6"
            orient="auto"
            refX="5"
            refY="3"
          >
            <path d="M0,0 L6,3 L0,6 z" fill="var(--glow)" />
          </marker>
        </defs>

        {/* Spine: card → content script → service worker → backend */}
        {[
          { from: 56, to: 84 },
          { from: 120, to: 148 },
          { from: 184, to: 218 },
        ].map((seg, i) => (
          <motion.line
            key={seg.from}
            markerEnd="url(#arrow)"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1"
            x1={BOX_X + BOX_W / 2}
            x2={BOX_X + BOX_W / 2}
            y1={seg.from}
            y2={seg.to - 6}
            {...stroke(0.1 + i * 0.12)}
          />
        ))}

        <text
          className="fill-white/30 font-mono"
          fontSize="7"
          x={BOX_X + BOX_W / 2 + 8}
          y={136}
        >
          garment image URL
        </text>

        {/* Backend fan-out to the two APIs */}
        <motion.path
          d={`M ${BOX_X + 20} ${254} L ${BOX_X + 20} ${296} L ${BOX_X + 36} ${296}`}
          fill="none"
          markerEnd="url(#arrow-glow)"
          stroke="var(--glow)"
          strokeOpacity="0.5"
          strokeWidth="1"
          {...stroke(0.5)}
        />
        <motion.path
          d={`M ${BOX_X + 20} ${254} L ${BOX_X + 20} ${340} L ${BOX_X + 36} ${340}`}
          fill="none"
          markerEnd="url(#arrow-glow)"
          stroke="var(--glow)"
          strokeOpacity="0.5"
          strokeWidth="1"
          {...stroke(0.62)}
        />

        {/* Result returns up the left gutter and back into the card */}
        <motion.path
          d={`M ${BOX_X + BOX_W / 2} ${412} L ${BOX_X + BOX_W / 2} ${426} L 18 426 L 18 38 L ${BOX_X - 6} 38`}
          fill="none"
          markerEnd="url(#arrow)"
          stroke="rgba(255,255,255,0.22)"
          strokeDasharray="3 3"
          strokeWidth="1"
          {...stroke(0.8)}
        />
        <text
          className="fill-white/30 font-mono"
          fontSize="7"
          textAnchor="middle"
          transform="rotate(-90 26 232)"
          x={26}
          y={232}
        >
          render swaps into the card you clicked
        </text>
        <motion.line
          markerEnd="url(#arrow)"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="1"
          x1={BOX_X + BOX_W / 2}
          x2={BOX_X + BOX_W / 2}
          y1={352}
          y2={370}
          {...stroke(0.74)}
        />

        {/* API calls — accented, because this is where the units are spent */}
        {CALLS.map((call, i) => (
          <motion.g
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }}
            key={call.title}
            transition={{ delay: 0.55 + i * 0.1, duration: 0.5 }}
            viewport={{ margin: "-64px", once: true }}
            whileInView={{ opacity: 1, x: 0 }}
          >
            <rect
              fill="color-mix(in oklab, var(--glow) 10%, transparent)"
              height="28"
              rx="2"
              stroke="color-mix(in oklab, var(--glow) 45%, transparent)"
              strokeWidth="1"
              width={BOX_W - 36}
              x={BOX_X + 36}
              y={call.y}
            />
            <text
              className="fill-white/85"
              fontSize="9.5"
              fontWeight="500"
              x={BOX_X + 46}
              y={call.y + 12}
            >
              {call.title}
            </text>
            <text
              className="fill-white/40 font-mono"
              fontSize="7"
              x={BOX_X + 46}
              y={call.y + 22}
            >
              {call.note}
            </text>
          </motion.g>
        ))}

        {/* Nodes */}
        {BOXES.map((box, i) => (
          <motion.g
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            key={box.title}
            transition={{ delay: i * 0.1, duration: 0.5 }}
            viewport={{ margin: "-64px", once: true }}
            whileInView={{ opacity: 1, y: 0 }}
          >
            <rect
              fill="rgba(255,255,255,0.04)"
              height={BOX_H}
              rx="2"
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="1"
              width={BOX_W}
              x={BOX_X}
              y={box.y}
            />
            <text
              className="fill-white/30 font-mono"
              fontSize="6.5"
              letterSpacing="1"
              x={BOX_X + 12}
              y={box.y + 14}
            >
              {box.lane.toUpperCase()}
            </text>
            <text
              className="fill-white"
              fontSize="10.5"
              fontWeight="500"
              x={BOX_X + 12}
              y={box.y + 27}
            >
              {box.title}
            </text>
          </motion.g>
        ))}
      </svg>
    </div>
  );
}

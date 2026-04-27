"use client";

import { motion, useScroll, useSpring } from "framer-motion";

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const x = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  return (
    <motion.div
      aria-hidden
      className="fixed top-16 left-0 right-0 h-px origin-left z-40 pointer-events-none"
      style={{
        scaleX: x,
        background:
          "linear-gradient(to right, transparent, var(--color-accent), var(--color-accent-3), transparent)",
        boxShadow: "0 0 12px var(--color-accent-glow)",
      }}
    />
  );
}

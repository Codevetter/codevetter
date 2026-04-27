"use client";

import { useMemo } from "react";

type Props = {
  count?: number;
  className?: string;
};

export function ParticleField({ count = 28, className = "" }: Props) {
  const particles = useMemo(() => {
    const seed = (i: number) => {
      const x = Math.sin(i * 9301 + 49297) * 233280;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }, (_, i) => ({
      left: seed(i) * 100,
      top: seed(i + 1000) * 100,
      size: seed(i + 2000) * 2 + 1,
      delay: seed(i + 3000) * 6,
      duration: seed(i + 4000) * 6 + 6,
      opacity: seed(i + 5000) * 0.5 + 0.2,
    }));
  }, [count]);

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[--color-accent] animate-float"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: p.opacity,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            boxShadow: "0 0 6px currentColor",
          }}
        />
      ))}
    </div>
  );
}

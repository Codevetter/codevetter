import { Button } from "@/components/atoms/Button";
import { Aurora } from "@/components/effects/Aurora";
import { ParticleField } from "@/components/effects/ParticleField";
import { ArrowRight, Apple, Terminal } from "lucide-react";

export function CTA() {
  return (
    <section
      id="download"
      className="py-32 relative overflow-hidden border-t border-[--color-line]"
    >
      <Aurora intensity="high" />
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-50" aria-hidden />
      <ParticleField count={32} />

      <div className="relative max-w-5xl mx-auto px-6">
        <div className="relative corner-frame bg-[--color-bg-elev]/80 border border-[--color-line] backdrop-blur-md p-12 md:p-16 noise overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 0%, rgba(125,211,252,0.18), transparent 70%)",
            }}
            aria-hidden
          />
          <div className="relative text-center">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[--color-accent] border border-[--color-accent]/30 bg-[--color-accent]/5 px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[--color-accent] animate-pulse-soft" />
              STATUS_READY · v1.1.9
            </span>
            <h2 className="mt-6 font-display text-[clamp(2.4rem,6vw,4.8rem)] font-bold leading-[1.02] tracking-tight">
              Stop trusting agents{" "}
              <span className="text-gradient">blindly.</span>
            </h2>
            <p className="mt-6 text-[16px] text-[--color-text-dim] max-w-xl mx-auto leading-relaxed">
              Install in 30 seconds. First review in under a minute. Diff never
              leaves your laptop.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="primary"
                href="https://github.com/sarthakagrawal927/CodeVetter/releases/latest"
              >
                <Apple className="w-4 h-4" strokeWidth={1.5} />
                macOS · Apple Silicon
                <ArrowRight
                  className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={1.5}
                />
              </Button>
              <Button
                variant="outline"
                href="https://github.com/sarthakagrawal927/CodeVetter/releases/latest"
              >
                macOS · Intel
              </Button>
              <Button
                variant="outline"
                href="https://github.com/sarthakagrawal927/CodeVetter/releases/latest"
              >
                Windows
              </Button>
              <Button
                variant="outline"
                href="https://github.com/sarthakagrawal927/CodeVetter/releases/latest"
              >
                Linux · AppImage
              </Button>
            </div>

            <div className="mt-10 max-w-md mx-auto bg-[--color-bg] border border-[--color-line] font-mono text-[12px] text-left">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[--color-line]">
                <Terminal className="w-3.5 h-3.5 text-[--color-accent]" strokeWidth={1.5} />
                <span className="label-mono">install via brew</span>
              </div>
              <div className="px-4 py-3 text-[--color-text-dim]">
                <span className="text-[--color-accent]">$</span> brew install --cask{" "}
                <span className="text-[--color-text]">codevetter</span>
              </div>
            </div>

            <div className="mt-8 inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[--color-text-mute]">
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[--color-ok]" />
                signed
              </span>
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[--color-ok]" />
                auto-updates
              </span>
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[--color-ok]" />
                no account
              </span>
              <span className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[--color-ok]" />
                ISC
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { Check } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import { SectionHeading } from "./Bento";

const tiers = [
  {
    name: "Solo",
    price: "$0",
    cadence: "forever",
    body: "The full desktop binary. Bring your own LLM key. Use forever, no asterisks.",
    features: [
      "Unlimited reviews",
      "All providers",
      "Local SQLite history",
      "Auto-updates from GitHub",
    ],
    cta: { label: "Download", href: "#download" },
    highlight: false,
  },
  {
    name: "Team",
    price: "$12",
    cadence: "/ user / month",
    body: "Shared review presets, org policy rules, and SSO. Everything stays on each machine.",
    features: [
      "Everything in Solo",
      "Shared rule packs",
      "Audit log export",
      "SSO (Google, Okta)",
      "Priority support",
    ],
    cta: { label: "Join the waitlist", href: "#download" },
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "talk to us",
    body: "Air-gapped install, custom model routing, on-prem audit log sink, dedicated SE.",
    features: [
      "Everything in Team",
      "Air-gapped binary",
      "Custom CWE rule sets",
      "Procurement-friendly contract",
    ],
    cta: { label: "Contact sales", href: "mailto:hello@codevetter.dev" },
    highlight: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-28 border-t border-[--color-line] relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" aria-hidden />
      <div className="relative max-w-7xl mx-auto px-6">
        <SectionHeading
          eyebrow="Pricing"
          title={
            <>
              Free for solo. <span className="text-[--color-accent]">Honest above it.</span>
            </>
          }
          sub="No tokens, no per-review fees. We don't see your code, so we can't bill on it."
        />

        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative bg-[--color-surface] border p-7 flex flex-col transition-colors ${
                t.highlight
                  ? "border-[--color-accent]/50 shadow-[0_0_60px_-20px_var(--color-accent-glow)]"
                  : "border-[--color-line] hover:border-[--color-accent]/30"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-3 left-7 font-mono text-[10px] uppercase tracking-[0.22em] bg-[--color-accent] text-[#001016] px-2.5 py-0.5">
                  Most popular
                </span>
              )}
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[--color-text-dim]">
                {t.name}
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-display text-5xl font-bold tracking-tight">
                  {t.price}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[--color-text-mute]">
                  {t.cadence}
                </span>
              </div>
              <p className="mt-3 text-[14px] text-[--color-text-dim] leading-relaxed">
                {t.body}
              </p>
              <ul className="mt-6 space-y-2.5 flex-1">
                {t.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2.5 text-[13px] text-[--color-text]"
                  >
                    <Check
                      className="w-4 h-4 mt-0.5 text-[--color-accent] shrink-0"
                      strokeWidth={2}
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant={t.highlight ? "primary" : "outline"}
                href={t.cta.href}
                className="mt-7 justify-center"
              >
                {t.cta.label}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

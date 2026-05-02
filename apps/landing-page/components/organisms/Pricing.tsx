import { Check, Star } from "lucide-react";

import { Button } from "@/components/atoms/Button";

import { SectionHeading } from "./Bento";

const tiers = [
  {
    name: "Solo",
    price: "$0",
    cadence: "forever",
    body: "The full desktop binary. Bring your own LLM key. Use forever, no strings attached.",
    features: [
      "Unlimited local reviews",
      "All LLM providers",
      "Local SQLite history",
      "Automatic updates",
    ],
    cta: { label: "Download Now", href: "#download" },
    highlight: false,
  },
  {
    name: "Team",
    price: "$12",
    cadence: "per user / month",
    body: "Shared review presets and org policy rules. Everything stays on each machine.",
    features: [
      "Everything in Solo",
      "Shared rule packs",
      "Audit log export",
      "SSO Authentication",
      "Priority support",
    ],
    cta: { label: "Get Early Access", href: "#download" },
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "tailored for you",
    body: "Air-gapped installs, custom model routing, and dedicated security engineering.",
    features: [
      "Everything in Team",
      "Air-gapped deployment",
      "Custom CWE rulesets",
      "On-prem audit logs",
      "SLA guarantee",
    ],
    cta: { label: "Talk to Sales", href: "mailto:hello@codevetter.dev" },
    highlight: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-32 relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" aria-hidden />
      <div className="relative max-w-7xl mx-auto px-6">
        <SectionHeading
          eyebrow="Pricing"
          title={
            <>
              Free for solo. <span className="text-gradient">Honest above it.</span>
            </>
          }
          sub="No tokens, no per-review fees. We don't see your code, so we can't bill on it."
        />

        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col p-10 rounded-[2.5rem] border transition-all duration-500 ${
                t.highlight
                  ? "bg-white/[0.04] border-blue-500/30 shadow-[0_0_80px_rgba(96,165,250,0.1)] backdrop-blur-3xl z-10 scale-105"
                  : "bg-white/[0.02] border-white/5 hover:border-white/10 hover:bg-white/[0.03]"
              }`}
            >
              {t.highlight && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-blue-500 text-white text-[10px] font-bold uppercase tracking-widest shadow-xl shadow-blue-500/20">
                  <Star className="w-3 h-3 fill-current" />
                  Most Popular
                </div>
              )}
              
              <div className="mb-8">
                <div className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">
                  {t.name}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-white tracking-tight">
                    {t.price}
                  </span>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t.cadence}
                  </span>
                </div>
              </div>

              <p className="text-[15px] text-gray-400 leading-relaxed mb-8">
                {t.body}
              </p>

              <div className="space-y-4 mb-10 flex-1">
                {t.features.map((f) => (
                  <div
                    key={f}
                    className="flex items-start gap-3 text-sm text-gray-300"
                  >
                    <div className="mt-1 flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    </div>
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              <Button
                variant={t.highlight ? "primary" : "outline"}
                href={t.cta.href}
                className="w-full h-14 justify-center"
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
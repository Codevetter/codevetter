import { ShieldCheck } from "lucide-react";

const cols = [
  {
    label: "Product",
    items: [
      { l: "Features", h: "#features" },
      { l: "How it works", h: "#how" },
      { l: "Pricing", h: "#pricing" },
      { l: "Changelog", h: "https://github.com/sarthakagrawal927/CodeVetter/releases" },
    ],
  },
  {
    label: "Resources",
    items: [
      { l: "Documentation", h: "https://github.com/sarthakagrawal927/CodeVetter#readme" },
      { l: "GitHub", h: "https://github.com/sarthakagrawal927/CodeVetter" },
      { l: "Issues", h: "https://github.com/sarthakagrawal927/CodeVetter/issues" },
    ],
  },
  {
    label: "Company",
    items: [
      { l: "Privacy", h: "#" },
      { l: "Security", h: "#" },
      { l: "Contact", h: "mailto:hello@codevetter.dev" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-[--color-line] bg-[--color-bg-elev]/60">
      <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-5 gap-8">
        <div className="col-span-2">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[--color-accent]" strokeWidth={1.5} />
            <span className="font-mono text-[13px] tracking-[0.22em] uppercase font-semibold">
              CodeVetter
            </span>
          </div>
          <p className="mt-4 text-[13px] text-[--color-text-dim] max-w-xs leading-relaxed">
            A second pair of eyes for the agent era. Desktop-first. Open source.
            Made by engineers tired of merging unreviewed AI patches.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.label}>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[--color-text-mute] mb-4">
              {c.label}
            </div>
            <ul className="space-y-2.5">
              {c.items.map((it) => (
                <li key={it.l}>
                  <a
                    href={it.h}
                    className="text-[13px] text-[--color-text-dim] hover:text-[--color-text] transition-colors"
                  >
                    {it.l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[--color-line]">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[--color-text-mute]">
          <span>© {new Date().getFullYear()} CodeVetter — ISC</span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[--color-ok] animate-pulse-soft" />
            All systems operational
          </span>
        </div>
      </div>
    </footer>
  );
}

import { Spotlight } from "@/components/effects/Spotlight";
import { SectionHeading } from "./Bento";

const providers = [
  {
    name: "Anthropic",
    models: ["Opus 4.7", "Sonnet 4.6", "Haiku 4.5"],
    status: "Native",
    accent: "from-[#f97316] to-[#fbbf24]",
    note: "Recommended for security review",
  },
  {
    name: "OpenAI",
    models: ["GPT-5", "GPT-5 Codex", "o5-mini"],
    status: "Native",
    accent: "from-[#10b981] to-[#7dd3fc]",
    note: "Fast diffs · cheap codex tier",
  },
  {
    name: "OpenRouter",
    models: ["Kimi K2", "Llama 4", "Mistral"],
    status: "Gateway",
    accent: "from-[#a78bfa] to-[#f472b6]",
    note: "300+ models · single key",
  },
  {
    name: "Local · Ollama",
    models: ["Qwen 3 Coder", "DeepSeek v3"],
    status: "Beta",
    accent: "from-[#7dd3fc] to-[#a78bfa]",
    note: "Air-gapped · no key needed",
  },
];

export function Providers() {
  return (
    <section
      id="providers"
      className="py-28 border-t border-[--color-line] relative overflow-hidden"
    >
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" aria-hidden />
      <div
        className="absolute right-0 top-1/2 w-[600px] h-[600px] rounded-full pointer-events-none opacity-50 blur-3xl -translate-y-1/2"
        style={{
          background:
            "radial-gradient(closest-side, rgba(125,211,252,0.10), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-12 gap-12 items-end">
          <div className="lg:col-span-7">
            <SectionHeading
              eyebrow="Provider matrix"
              title={
                <>
                  Any model. <span className="text-gradient">Your key.</span>
                </>
              }
              sub="CodeVetter is provider-agnostic. Test the same diff across models, pin one per repo, or rotate as new releases land."
            />
          </div>
          <div className="lg:col-span-5 grid grid-cols-2 gap-3 font-mono text-[10.5px]">
            <Stat n="300+" l="Models reachable" />
            <Stat n="0" l="Tokens we proxy" />
            <Stat n="<200ms" l="Provider switch" />
            <Stat n="∞" l="Reviews / month" />
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-4">
          {providers.map((p) => (
            <Spotlight
              key={p.name}
              className="group relative bg-[--color-surface] border border-[--color-line] hover:border-[--color-accent]/40 transition-colors p-6 overflow-hidden"
            >
              <div
                className={`absolute -top-32 -right-32 w-72 h-72 rounded-full blur-3xl opacity-0 group-hover:opacity-30 transition-opacity bg-gradient-to-br ${p.accent}`}
                aria-hidden
              />
              <div
                className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[--color-accent] to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                aria-hidden
              />
              <div className="relative">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="font-display text-2xl font-semibold tracking-tight">
                      {p.name}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-[--color-text-mute]">
                      {p.note}
                    </div>
                  </div>
                  <span
                    className={`font-mono text-[9px] uppercase tracking-[0.22em] px-2 py-1 border shrink-0 ${
                      p.status === "Native"
                        ? "text-[--color-ok] border-[--color-ok]/40 bg-[--color-ok]/5"
                        : p.status === "Beta"
                          ? "text-[--color-warn] border-[--color-warn]/40 bg-[--color-warn]/5"
                          : "text-[--color-accent] border-[--color-accent]/40 bg-[--color-accent]/5"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-5">
                  {p.models.map((m) => (
                    <span
                      key={m}
                      className="font-mono text-[11px] text-[--color-text-dim] border border-[--color-line] bg-[--color-bg] px-2.5 py-1 hover:border-[--color-accent]/40 hover:text-[--color-accent] transition-colors"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </Spotlight>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="border border-[--color-line] bg-[--color-bg] p-3">
      <div className="font-display text-2xl font-bold tabular-nums text-[--color-text]">
        {n}
      </div>
      <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[--color-text-mute]">
        {l}
      </div>
    </div>
  );
}

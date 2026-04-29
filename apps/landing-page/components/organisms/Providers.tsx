import { Spotlight } from "@/components/effects/Spotlight";
import { SectionHeading } from "./Bento";

const providers = [
  {
    name: "Anthropic",
    models: ["Claude 3.5 Sonnet", "Claude 3 Opus"],
    status: "Native",
    accent: "from-orange-500 to-amber-500",
    note: "Recommended for security review",
  },
  {
    name: "OpenAI",
    models: ["GPT-4o", "GPT-4o-mini", "o1-preview"],
    status: "Native",
    accent: "from-emerald-500 to-sky-500",
    note: "Fast diffs · robust reasoning",
  },
  {
    name: "OpenRouter",
    models: ["Gemini 1.5 Pro", "Llama 3.1 405B"],
    status: "Gateway",
    accent: "from-purple-500 to-pink-500",
    note: "300+ models · single API key",
  },
  {
    name: "Local LLMs",
    models: ["Qwen 2.5 Coder", "DeepSeek Coder"],
    status: "Private",
    accent: "from-blue-500 to-indigo-500",
    note: "100% private · air-gapped",
  },
];

export function Providers() {
  return (
    <section
      id="providers"
      className="py-32 relative overflow-hidden"
    >
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none" aria-hidden />
      
      <div className="relative max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-12 gap-16 items-end mb-20">
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
          <div className="lg:col-span-5 grid grid-cols-2 gap-4">
            <ProviderStat n="300+" l="Models reachable" />
            <ProviderStat n="0" l="Tokens proxied" />
            <ProviderStat n="<200ms" l="Provider latency" />
            <ProviderStat n="∞" l="Reviews allowed" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {providers.map((p) => (
            <Spotlight
              key={p.name}
              className="group relative bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all duration-500 p-8 rounded-[2rem] overflow-hidden"
            >
              <div
                className={`absolute -top-32 -right-32 w-80 h-80 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity bg-gradient-to-br ${p.accent}`}
                aria-hidden
              />
              <div className="relative flex flex-col h-full">
                <div className="flex items-start justify-between mb-8">
                  <div>
                    <h3 className="font-display text-2xl font-bold text-white mb-2">
                      {p.name}
                    </h3>
                    <p className="text-sm text-gray-500 font-medium">
                      {p.note}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border shadow-sm ${
                      p.status === "Native"
                        ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10"
                        : p.status === "Private"
                          ? "text-blue-400 border-blue-500/20 bg-blue-500/10"
                          : "text-purple-400 border-purple-500/20 bg-purple-500/10"
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
                
                <div className="flex flex-wrap gap-2 mt-auto">
                  {p.models.map((m) => (
                    <span
                      key={m}
                      className="text-xs font-semibold text-gray-400 border border-white/5 bg-white/[0.03] px-3 py-1.5 rounded-xl group-hover:border-blue-500/20 group-hover:text-gray-200 transition-colors"
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

function ProviderStat({ n, l }: { n: string; l: string }) {
  return (
    <div className="group p-5 rounded-2xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/10 transition-all">
      <div className="font-display text-3xl font-bold text-white group-hover:text-blue-400 transition-colors tabular-nums">
        {n}
      </div>
      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">
        {l}
      </div>
    </div>
  );
}
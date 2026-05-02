import { useCallback,useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PrerequisiteStatus } from "@/lib/tauri-ipc";
import {
  checkPrerequisites,
  isTauriAvailable,
  setPreference,
} from "@/lib/tauri-ipc";

interface OnboardingProps {
  onComplete: () => void;
}

type Step = "welcome" | "prerequisites" | "model" | "tour";

const STEPS: Step[] = ["welcome", "prerequisites", "model", "tour"];

type ModelOption = "sonnet" | "opus" | "haiku";

const MODEL_OPTIONS: { value: ModelOption; label: string; desc: string }[] = [
  { value: "sonnet", label: "Sonnet", desc: "Fast, good for most tasks" },
  { value: "opus", label: "Opus", desc: "Powerful, for complex work" },
  { value: "haiku", label: "Haiku", desc: "Quick, for simple tasks" },
];

const TOUR_ITEMS: { icon: string; label: string; desc: string }[] = [
  { icon: "\u2302", label: "Home", desc: "Usage stats & overview" },
  { icon: "\u2714", label: "Review", desc: "AI code review" },
  { icon: "\u2699", label: "Settings", desc: "Configuration" },
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [isAnimating, setIsAnimating] = useState(false);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteStatus | null>(
    null
  );
  const [prerequisitesLoading, setPrerequisitesLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelOption>("sonnet");

  const currentIndex = STEPS.indexOf(step);

  const goToStep = useCallback(
    (nextStep: Step) => {
      const nextIndex = STEPS.indexOf(nextStep);
      const dir = nextIndex > currentIndex ? "forward" : "backward";
      setDirection(dir);
      setIsAnimating(true);
      // Small delay so the exit animation plays before entering new step
      setTimeout(() => {
        setStep(nextStep);
        setIsAnimating(false);
      }, 150);
    },
    [currentIndex]
  );

  // Check prerequisites when reaching that step
  useEffect(() => {
    if (step === "prerequisites" && !prerequisites && !prerequisitesLoading) {
      setPrerequisitesLoading(true);
      if (isTauriAvailable()) {
        void checkPrerequisites()
          .then(setPrerequisites)
          .catch(() => {
            // Fallback: assume nothing is available
            setPrerequisites({
              claude_code: false,
              github_cli: false,
              codex: false,
            });
          })
          .finally(() => setPrerequisitesLoading(false));
      } else {
        // Browser dev mode fallback
        setPrerequisites({
          claude_code: true,
          github_cli: true,
          codex: false,
        });
        setPrerequisitesLoading(false);
      }
    }
  }, [step, prerequisites, prerequisitesLoading]);

  async function handleFinish() {
    // Save model preference
    if (isTauriAvailable()) {
      await setPreference("default_model", selectedModel).catch(() => {});
      await setPreference("onboarding_complete", "true").catch(() => {});
    }
    localStorage.setItem("onboarding_complete", "true");
    localStorage.setItem("default_model", selectedModel);
    onComplete();
  }

  const animClass = isAnimating
    ? "onboarding-exit"
    : direction === "forward"
      ? "onboarding-enter-forward"
      : "onboarding-enter-backward";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0e0f13]">
      {/* Subtle radial glow behind the card */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[600px] w-[600px] rounded-full bg-amber-500/[0.03] blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div
          className={`rounded-2xl border border-[#1a1a1a] bg-[#0a0a0a] p-8 shadow-2xl ${animClass}`}
        >
          {/* ── Step 1: Welcome ─────────────────────────────────────── */}
          {step === "welcome" && (
            <div className="flex flex-col items-center text-center gap-6">
              <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                <span className="text-3xl text-amber-400">{"\u25C8"}</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-100">
                  CodeVetter
                </h1>
                <p className="mt-1 text-sm font-medium text-amber-400/80">
                  Your AI coding companion
                </p>
                <p className="mt-3 text-sm text-slate-400 leading-relaxed">
                  Monitor usage, review agent-generated code — all from your
                  desktop.
                </p>
              </div>
              <Button
                onClick={() => goToStep("prerequisites")}
                className="w-full bg-amber-500 text-white hover:bg-amber-600"
                size="lg"
              >
                Get Started
                <span className="ml-1">{"\u2192"}</span>
              </Button>
            </div>
          )}

          {/* ── Step 2: Prerequisites Check ─────────────────────────── */}
          {step === "prerequisites" && (
            <div className="flex flex-col items-center text-center gap-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  Let's make sure everything works
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Checking for required CLI tools
                </p>
              </div>

              <div className="w-full space-y-3">
                {prerequisitesLoading || !prerequisites ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                  </div>
                ) : (
                  <>
                    <PrereqRow
                      label="Claude Code CLI"
                      installed={prerequisites.claude_code}
                      detail={
                        prerequisites.claude_code ? "installed" : "not found"
                      }
                      required
                    />
                    <PrereqRow
                      label="GitHub CLI (gh)"
                      installed={prerequisites.github_cli}
                      detail={
                        prerequisites.github_cli
                          ? "authenticated"
                          : "not found"
                      }
                    />
                    <PrereqRow
                      label="Codex CLI"
                      installed={prerequisites.codex}
                      detail={
                        prerequisites.codex ? "installed" : "not found"
                      }
                    />

                    <p className="pt-2 text-xs text-slate-500 leading-relaxed">
                      Claude Code is required. GitHub CLI and Codex are
                      optional but unlock more features.
                    </p>
                  </>
                )}
              </div>

              <Button
                onClick={() => goToStep("model")}
                disabled={prerequisitesLoading}
                className="w-full bg-amber-500 text-white hover:bg-amber-600"
                size="lg"
              >
                Continue
                <span className="ml-1">{"\u2192"}</span>
              </Button>
            </div>
          )}

          {/* ── Step 3: Choose Default Model ────────────────────────── */}
          {step === "model" && (
            <div className="flex flex-col items-center text-center gap-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  Pick your default model
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  You can change this anytime in settings
                </p>
              </div>

              <div className="w-full space-y-2">
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedModel(opt.value)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition-all ${
                      selectedModel === opt.value
                        ? "border-amber-500/50 bg-amber-500/[0.08]"
                        : "border-[#1a1a1a] bg-[#0f1117] hover:border-[#2e3040]"
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
                        selectedModel === opt.value
                          ? "border-amber-400"
                          : "border-slate-600"
                      }`}
                    >
                      {selectedModel === opt.value && (
                        <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-200">
                        {opt.label}
                      </p>
                      <p className="text-xs text-slate-500">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              <Button
                onClick={() => goToStep("tour")}
                className="w-full bg-amber-500 text-white hover:bg-amber-600"
                size="lg"
              >
                Continue
                <span className="ml-1">{"\u2192"}</span>
              </Button>
            </div>
          )}

          {/* ── Step 4: Quick Tour ──────────────────────────────────── */}
          {step === "tour" && (
            <div className="flex flex-col items-center text-center gap-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  Quick tour
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Here's what you'll find in the sidebar
                </p>
              </div>

              <div className="w-full space-y-2">
                {TOUR_ITEMS.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3 rounded-lg border border-[#1a1a1a] bg-[#0f1117] p-3"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-400">
                      <span className="text-sm">{item.icon}</span>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-slate-200">
                        {item.label}
                      </p>
                      <p className="text-xs text-slate-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="w-full rounded-lg border border-[#1a1a1a] bg-[#0f1117] px-4 py-3">
                <p className="text-xs text-slate-400">
                  <span className="font-medium text-slate-300">Tip:</span>{" "}
                  Press{" "}
                  <Badge
                    variant="outline"
                    className="mx-0.5 border-slate-700 px-1.5 py-0 text-[10px] text-slate-400"
                  >
                    {"\u2318"}K
                  </Badge>{" "}
                  for the command palette from anywhere.
                </p>
              </div>

              <Button
                onClick={handleFinish}
                className="w-full bg-amber-500 text-white hover:bg-amber-600"
                size="lg"
              >
                Start Using CodeVetter
                <span className="ml-1">{"\u2192"}</span>
              </Button>
            </div>
          )}
        </div>

        {/* ── Step Indicator Dots ────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-2 w-2 rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? "bg-amber-400 scale-110"
                  : i < currentIndex
                    ? "bg-amber-400/40"
                    : "bg-slate-700"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Prerequisite Row ────────────────────────────────────────────────────────

function PrereqRow({
  label,
  installed,
  detail,
  required,
}: {
  label: string;
  installed: boolean;
  detail: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#1a1a1a] bg-[#0f1117] px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={`text-sm ${installed ? "text-emerald-400" : "text-slate-600"}`}
        >
          {installed ? "\u2713" : "\u2717"}
        </span>
        <span className="text-sm text-slate-200">{label}</span>
        {required && (
          <Badge
            variant="outline"
            className="border-amber-500/30 px-1.5 py-0 text-[10px] text-amber-400"
          >
            required
          </Badge>
        )}
      </div>
      <span
        className={`text-xs ${installed ? "text-emerald-400/70" : "text-slate-600"}`}
      >
        {detail}
      </span>
    </div>
  );
}

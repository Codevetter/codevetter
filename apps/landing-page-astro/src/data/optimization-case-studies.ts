import anime from '../../../../benchmarks/performance-lab/autonomous-browser-loop-anime-proof-2026-08-14.json';
import freeAi from '../../../../benchmarks/performance-lab/free-ai-selection-one-pass-proof-2026-08-14.json';
import starboard from '../../../../benchmarks/performance-lab/starboard-token-scan-rejection-2026-08-14.json';

export interface OptimizationCaseStudy {
  slug: string;
  project: string;
  decision: 'confirmed' | 'retained' | 'rejected';
  date: string;
  revision: string;
  summary: string;
  availability: string;
  testedFlow: string;
  source: string;
  primaryMetric: { label: string; value: string; note: string };
  protectedMetrics: Array<{ label: string; value: string; decision: string }>;
  changeCost: {
    files: number;
    added: number;
    removed: number;
    gross: number;
    net: number;
    dependencies: number;
  };
  correctness: string;
  process: Array<{ decision: string; title: string; evidence: string }>;
  limitations: string[];
}

const animeRetained = anime.retained_experiment;
const animeTransfer = animeRetained.promotion.browser_completed_response_transfer_bytes;
const freeAiLargest = freeAi.paired_verification.scale_points.at(-1)!;

export const optimizationCaseStudies: OptimizationCaseStudy[] = [
  {
    slug: 'anime-list',
    project: 'Anime List',
    decision: 'retained',
    date: anime.recorded_at,
    revision: anime.subject.repository_revision,
    summary:
      'A two-file import-boundary change materially reduced one local Vite navigation, while a separate production build showed almost no shipped-bundle movement.',
    availability:
      'Historical research receipt. The experimental browser harness is not part of the compact current release.',
    testedFlow: 'One mobile home-page navigation in an isolated local Vite checkout',
    source: animeRetained.changed_files.join(', '),
    primaryMetric: {
      label: 'Local response bytes',
      value: `${Math.abs(animeTransfer.delta_percent).toFixed(1)}% fewer`,
      note: `${animeTransfer.baseline_median.toLocaleString()} → ${animeTransfer.candidate_median.toLocaleString()} bytes`,
    },
    protectedMetrics: [
      {
        label: 'Production JS gzip',
        value: `${Math.abs(anime.production_build_check.delta.gzip_percent).toFixed(1)}% smaller`,
        decision: 'not material',
      },
      {
        label: 'Peak process-tree RSS',
        value: `${Math.abs(animeRetained.promotion.process_tree_peak_rss_bytes.delta_percent).toFixed(1)}% lower`,
        decision: 'non-regression only',
      },
    ],
    changeCost: {
      files: animeRetained.complexity.files_changed,
      added: animeRetained.complexity.added_lines,
      removed: animeRetained.complexity.deleted_lines,
      gross: animeRetained.complexity.gross_lines_changed,
      net: animeRetained.complexity.net_lines_changed,
      dependencies: animeRetained.complexity.production_dependencies_added.length,
    },
    correctness: 'One exact repository-owned Vitest test and the selected Playwright flow passed.',
    process: [
      {
        decision: 'rejected',
        title: 'Radix package subpaths',
        evidence: `${Math.abs(anime.rejected_experiments[0].delta_percent).toFixed(1)}% fewer bytes did not clear the 10% materiality floor.`,
      },
      {
        decision: 'retained',
        title: 'Lucide removed from the initial flow boundary',
        evidence: `${animeRetained.promotion.samples_per_side} samples per side plus warmups confirmed the local transfer reduction.`,
      },
      {
        decision: 'qualified',
        title: 'Local developer-flow result only',
        evidence: 'The production gzip change was 0.3%, so no consumer speed claim is made.',
      },
    ],
    limitations: anime.limitations,
  },
  {
    slug: 'free-ai',
    project: 'Free AI',
    decision: 'confirmed',
    date: freeAi.observation_date,
    revision: freeAi.subject.repository_revision,
    summary:
      'A one-pass model-selection loop removed an intermediate array and improved every tested registry size without growing the patch.',
    availability: 'Uses the current local Vitest performance path.',
    testedFlow: `${freeAi.flow.target} — ${freeAi.flow.name}`,
    source: freeAi.diagnosis.source,
    primaryMetric: {
      label: 'Largest tested registry',
      value: `${Math.abs(freeAiLargest.delta_percent).toFixed(1)}% faster`,
      note: `${freeAiLargest.baseline_ms_per_operation} → ${freeAiLargest.candidate_ms_per_operation} ms/op at ${freeAiLargest.input} models`,
    },
    protectedMetrics: [
      {
        label: 'Sampled source bytes',
        value: `${Math.abs(freeAi.paired_verification.sampled_source_bytes.delta_percent).toFixed(1)}% lower`,
        decision: 'source and total agree',
      },
      {
        label: 'Peak process-tree RSS',
        value: `${Math.abs(freeAi.paired_verification.peak_process_tree_rss_bytes.delta_percent).toFixed(1)}% lower`,
        decision: 'not material; no regression',
      },
    ],
    changeCost: {
      files: freeAi.change_cost.files_changed,
      added: freeAi.change_cost.lines_added,
      removed: freeAi.change_cost.lines_removed,
      gross: freeAi.change_cost.gross_lines_changed,
      net: freeAi.change_cost.net_lines_changed,
      dependencies: freeAi.change_cost.production_dependencies_added.length,
    },
    correctness: `${freeAi.correctness.full_tests_passed} tests in ${freeAi.correctness.full_test_files_passed} files passed, plus typecheck and changed-file lint.`,
    process: [
      {
        decision: 'observed',
        title: 'Allocation hotspot in selectCandidates',
        evidence: `${(freeAi.diagnosis.initial_sampled_allocation_share * 100).toFixed(1)}% of initial sampled allocation bytes pointed at the source.`,
      },
      {
        decision: 'tested',
        title: 'Build the ranked list directly',
        evidence: `${freeAi.paired_verification.samples_per_side} interleaved samples per side covered three registry sizes.`,
      },
      {
        decision: 'confirmed',
        title: 'Faster with less code',
        evidence:
          'The candidate removed seven net lines, added no dependency, and passed the bounded change-cost policy.',
      },
    ],
    limitations: freeAi.limitations,
  },
  {
    slug: 'starboard',
    project: 'Starboard',
    decision: 'rejected',
    date: starboard.recorded_at,
    revision: starboard.repository_revision,
    summary:
      'A plausible incremental token scanner passed focused correctness but ran slower, so CodeVetter rejected it and restored the original code.',
    availability: 'Uses the current local Vitest performance path.',
    testedFlow: `${starboard.flow.target} — ${starboard.flow.name}`,
    source: starboard.diagnosis.source,
    primaryMetric: {
      label: 'Largest tested catalog',
      value: `${starboard.paired_verification.delta_percent.toFixed(1)}% slower`,
      note: `${starboard.paired_verification.baseline_ms_per_operation} → ${starboard.paired_verification.candidate_ms_per_operation} ms/op`,
    },
    protectedMetrics: [
      {
        label: 'Peak RSS',
        value: `${Math.abs(starboard.paired_verification.peak_rss_delta_percent).toFixed(1)}% lower`,
        decision: 'did not offset the speed regression',
      },
      {
        label: 'Allocation evidence',
        value: 'Incomplete',
        decision: 'collection bound exceeded',
      },
    ],
    changeCost: {
      files: starboard.experiment.change_cost.files_changed,
      added: starboard.experiment.change_cost.lines_added,
      removed: starboard.experiment.change_cost.lines_removed,
      gross: starboard.experiment.change_cost.gross_lines_changed,
      net:
        starboard.experiment.change_cost.lines_added -
        starboard.experiment.change_cost.lines_removed,
      dependencies: starboard.experiment.change_cost.production_dependencies_added.length,
    },
    correctness: `${starboard.experiment.focused_correctness.tests_passed} focused tests passed before performance rejected the candidate.`,
    process: [
      {
        decision: 'observed',
        title: 'Tokenization appeared in the CPU profile',
        evidence: `${(starboard.diagnosis.cpu_sample_share * 100).toFixed(1)}% of CPU samples pointed at meaningfulTokens.`,
      },
      {
        decision: 'tested',
        title: 'Incremental regular-expression scan',
        evidence:
          'The one-file experiment stayed within the change-cost budget and passed focused correctness.',
      },
      {
        decision: 'rejected',
        title: 'Slower and too noisy to trust',
        evidence:
          'The candidate was slower, sample spread was high, allocation evidence was incomplete, and the source was restored.',
      },
    ],
    limitations: starboard.limitations,
  },
];

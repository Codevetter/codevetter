export type AgentTeamProvider = 'codex' | 'claude';

export type AgentTeamRole =
  | 'implementation'
  | 'investigation'
  | 'product-ux'
  | 'review'
  | 'verification';

export interface AgentRoleRecommendation {
  role: AgentTeamRole;
  label: string;
  reason: string;
  instructions: string;
  defaultProvider: AgentTeamProvider;
  required: boolean;
  matchedSignal: string | null;
  phase: 'now' | 'after-implementation';
  sandbox: 'workspace-write' | 'read-only';
}

const MAX_OUTCOME_CHARS = 4000;
const MAX_RECOMMENDED_ROLES = 3;

const OPTIONAL_ROLES: ReadonlyArray<{
  role: Exclude<AgentTeamRole, 'implementation'>;
  label: string;
  defaultProvider: AgentTeamProvider;
  pattern: RegExp;
  signal: string;
  reason: string;
  responsibility: string;
  phase: 'now' | 'after-implementation';
}> = [
  {
    role: 'verification',
    label: 'Assurance',
    defaultProvider: 'codex',
    pattern:
      /\b(test(?:ing|s|ed)?|playwright|browser|regression|release|proof|verify|verification|confidence|reliab(?:le|ility)|safe(?:ty)?|working|review|audit|second opinion|critique|security|correctness|risk|quality)\b/i,
    signal: 'independent assurance',
    reason:
      'The outcome asks for independent review, proof, testing, reliability, or release confidence.',
    responsibility:
      'Review and exercise the finished result, run the smallest relevant checks, and report exact risks, failures, and evidence without editing files.',
    phase: 'after-implementation',
  },
  {
    role: 'investigation',
    label: 'Investigator',
    defaultProvider: 'claude',
    pattern:
      /\b(investigat(?:e|ion)|root cause|diagnos(?:e|is)|unknown cause|trace|reproduc(?:e|tion)|why (?:is|does|did))\b/i,
    signal: 'independent investigation',
    reason: 'The outcome asks for investigation or root-cause evidence before implementation.',
    responsibility:
      'Reproduce and isolate the problem, report evidence and likely root cause, and avoid editing files.',
    phase: 'now',
  },
  {
    role: 'product-ux',
    label: 'Product UX',
    defaultProvider: 'claude',
    pattern:
      /\b(ui|ux|user experience|interface|sidebar|navigation|layout|visual|accessib(?:ility|le)|responsive|onboarding|empty state|agent island)\b/i,
    signal: 'user-interface work',
    reason:
      'The outcome explicitly changes an interface or user experience, so an independent UX pass can clarify the interaction before it ships.',
    responsibility:
      'Inspect the affected experience, identify interaction and accessibility risks, and give the implementation agent concrete recommendations without editing files.',
    phase: 'now',
  },
];

export function recommendAgentTeam(outcome: string): AgentRoleRecommendation[] {
  const boundedOutcome = boundOutcome(outcome);
  const optional = OPTIONAL_ROLES.filter((candidate) =>
    candidate.pattern.test(boundedOutcome)
  ).slice(0, MAX_RECOMMENDED_ROLES - 1);
  const implementationReason =
    optional.length === 0
      ? 'One implementation agent is sufficient because the outcome does not explicitly ask for independent investigation, interface review, or verification.'
      : 'Every requested outcome needs one implementation owner; the optional agents stay read-only so responsibility remains clear.';

  return [
    {
      role: 'implementation',
      label: 'Implementation',
      reason: implementationReason,
      instructions: rolePrompt(
        'Implementation',
        'Own the requested change end to end. Inspect repository guidance first, preserve unrelated work, make the smallest coherent implementation, and report exact checks and residual risks.',
        boundedOutcome
      ),
      defaultProvider: 'codex',
      required: true,
      matchedSignal: null,
      phase: 'now',
      sandbox: 'workspace-write',
    },
    ...optional.map((candidate) => ({
      role: candidate.role,
      label: candidate.label,
      reason: candidate.reason,
      instructions: rolePrompt(candidate.label, candidate.responsibility, boundedOutcome),
      defaultProvider: candidate.defaultProvider,
      required: false,
      matchedSignal: candidate.signal,
      phase: candidate.phase,
      sandbox: 'read-only' as const,
    })),
  ];
}

function boundOutcome(outcome: string): string {
  return outcome.trim().replace(/\s+/g, ' ').slice(0, MAX_OUTCOME_CHARS);
}

function rolePrompt(role: string, responsibility: string, outcome: string): string {
  return [
    `You are the ${role} agent in a user-confirmed CodeVetter team.`,
    responsibility,
    'Do not coordinate through hidden context or assume another agent completed work; report what you directly observe.',
    '',
    `Shared outcome: ${outcome}`,
  ].join('\n');
}

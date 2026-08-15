export interface VerificationRequest {
  protocolVersion: 1;
  runId: string;
  scenarioId: string;
  stateName: string;
  frozenTime: string;
  flags: Readonly<Record<string, string | number | boolean>>;
}

export interface VerificationStatus {
  protocolVersion: 1;
  runId: string;
  scenarioId: string;
  status: 'requested' | 'ready' | 'error';
  message?: string;
}

export interface VerificationWindow {
  __CODEVETTER_VERIFY__?: VerificationRequest;
  __CODEVETTER_VERIFY_STATE__?: VerificationStatus;
  __CODEVETTER_VERIFY_RUNTIME_ERRORS__?: string[];
  __CODEVETTER_VERIFY_REPORT__?: {
    stateName: string;
    reviewId: string;
    runtimeErrorCount: number;
    horizontalOverflow: boolean;
    activeElementText: string;
    reducedMotionForced: boolean;
  };
}

type StateInstaller = (request: VerificationRequest) => void | Promise<void>;

export type ReviewQualificationStateName =
  | 'review-partial-ready'
  | 'review-completed-ready'
  | 'review-keyboard-focused'
  | 'review-reduced-motion';

export interface ReviewQualificationRequest extends VerificationRequest {
  stateName: ReviewQualificationStateName;
  reviewId: string;
}

interface PendingReviewState {
  resolve: () => void;
  reject: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

const pendingReviewStates = new Map<string, PendingReviewState>();

const reviewQualificationStates = new Set<ReviewQualificationStateName>([
  'review-partial-ready',
  'review-completed-ready',
  'review-keyboard-focused',
  'review-reduced-motion',
]);

function requestKey(request: Pick<VerificationRequest, 'runId' | 'scenarioId'>): string {
  return `${request.runId}:${request.scenarioId}`;
}

function waitForReviewState(request: VerificationRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const key = requestKey(request);
    const previous = pendingReviewStates.get(key);
    if (previous) {
      clearTimeout(previous.timeout);
      previous.reject();
    }
    const timeout = setTimeout(() => {
      pendingReviewStates.delete(key);
      reject(new Error('Review qualification state timed out'));
    }, 20_000);
    pendingReviewStates.set(key, { resolve, reject, timeout });
  });
}

const codevetterStates: Readonly<Record<string, StateInstaller>> = Object.freeze({
  'shell-navigation-ready': () => undefined,
  'shell-crash-recovery': () => undefined,
  'review-partial-ready': waitForReviewState,
  'review-completed-ready': waitForReviewState,
  'review-keyboard-focused': waitForReviewState,
  'review-reduced-motion': waitForReviewState,
  'performance-empty': () => undefined,
  'performance-blocked': () => undefined,
  'performance-planned': () => undefined,
  'performance-running': () => undefined,
  'performance-failed': () => undefined,
  'performance-no-confidence': () => undefined,
  'performance-diagnosed': () => undefined,
  'performance-paired-proof': () => undefined,
});

export function getReviewQualificationRequest(
  host: VerificationWindow = window as unknown as VerificationWindow
): ReviewQualificationRequest | null {
  const request = host.__CODEVETTER_VERIFY__;
  if (
    !request ||
    !reviewQualificationStates.has(request.stateName as ReviewQualificationStateName)
  ) {
    return null;
  }
  const reviewId = request.flags.reviewId;
  if (typeof reviewId !== 'string' || !stableId(reviewId)) return null;
  return {
    ...request,
    stateName: request.stateName as ReviewQualificationStateName,
    reviewId,
  };
}

export function completeReviewQualificationState(request: ReviewQualificationRequest): boolean {
  const pending = pendingReviewStates.get(requestKey(request));
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingReviewStates.delete(requestKey(request));
  pending.resolve();
  return true;
}

export function failReviewQualificationState(request: ReviewQualificationRequest): boolean {
  const pending = pendingReviewStates.get(requestKey(request));
  if (!pending) return false;
  clearTimeout(pending.timeout);
  pendingReviewStates.delete(requestKey(request));
  pending.reject();
  return true;
}

export async function initializeVerificationStateBridge(
  host: VerificationWindow = window as unknown as VerificationWindow,
  installers: Readonly<Record<string, StateInstaller>> = codevetterStates
): Promise<boolean> {
  const request = host.__CODEVETTER_VERIFY__;
  if (!request) return false;

  const base: Omit<VerificationStatus, 'status'> = {
    protocolVersion: 1,
    runId: request.runId,
    scenarioId: request.scenarioId,
  };
  if (!validRequest(request)) {
    host.__CODEVETTER_VERIFY_STATE__ = {
      ...base,
      status: 'error',
      message: 'Verification request is invalid',
    };
    return true;
  }

  const install = installers[request.stateName];
  if (!install) {
    host.__CODEVETTER_VERIFY_STATE__ = {
      ...base,
      status: 'error',
      message: `Unsupported CodeVetter verification state: ${request.stateName}`,
    };
    return true;
  }

  try {
    await install(request);
    host.__CODEVETTER_VERIFY_STATE__ = { ...base, status: 'ready' };
  } catch {
    host.__CODEVETTER_VERIFY_STATE__ = {
      ...base,
      status: 'error',
      message: `Could not install CodeVetter verification state: ${request.stateName}`,
    };
  }
  return true;
}

function validRequest(request: VerificationRequest): boolean {
  return (
    request.protocolVersion === 1 &&
    stableId(request.runId) &&
    stableId(request.scenarioId) &&
    stableId(request.stateName) &&
    !Number.isNaN(Date.parse(request.frozenTime)) &&
    typeof request.flags === 'object' &&
    request.flags !== null
  );
}

function stableId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

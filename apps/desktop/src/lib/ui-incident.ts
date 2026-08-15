export type UiIncidentScope = 'application' | 'route';

export interface UiIncident {
  schema_version: 1;
  incident_id: string;
  occurred_at: string;
  scope: UiIncidentScope;
  route: string;
  error_name: string;
}

interface CreateUiIncidentOptions {
  error: Error;
  scope: UiIncidentScope;
  route?: string;
  now?: () => Date;
  randomUuid?: () => string;
}

const STORAGE_KEY = 'codevetter:last-ui-incident';
const MAX_MESSAGE_LENGTH = 4_096;
const MAX_STACK_LENGTH = 24_000;
const MAX_COMPONENT_STACK_LENGTH = 8_000;

export function createUiIncident({
  error,
  scope,
  route = '/',
  now = () => new Date(),
  randomUuid = runtimeUuid,
}: CreateUiIncidentOptions): UiIncident {
  return {
    schema_version: 1,
    incident_id: `ui-${safeUuid(randomUuid())}`,
    occurred_at: now().toISOString(),
    scope,
    route: safeRoute(route),
    error_name: safeErrorName(error.name),
  };
}

export function recordUiIncident(
  incident: UiIncident,
  storage: Pick<Storage, 'setItem'> | null = typeof sessionStorage === 'undefined'
    ? null
    : sessionStorage
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(incident));
  } catch {
    // Recovery UI must still render when storage is unavailable.
  }
}

export function formatUiIncidentDiagnostic(
  incident: UiIncident,
  error: Error,
  componentStack?: string | null
): string {
  return [
    'CodeVetter UI incident',
    `Incident: ${incident.incident_id}`,
    `Occurred: ${incident.occurred_at}`,
    `Scope: ${incident.scope}`,
    `Route: ${incident.route}`,
    `Error: ${safeErrorName(error.name)}: ${error.message.slice(0, MAX_MESSAGE_LENGTH)}`,
    error.stack ? `Stack:\n${error.stack.slice(0, MAX_STACK_LENGTH)}` : null,
    componentStack
      ? `Component stack:\n${componentStack.trim().slice(0, MAX_COMPONENT_STACK_LENGTH)}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function safeRoute(route: string): string {
  const pathname = route.split(/[?#]/u, 1)[0];
  return pathname.startsWith('/') ? pathname.slice(0, 256) : '/';
}

function safeErrorName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_.-]/gu, '').slice(0, 80);
  return normalized || 'Error';
}

function runtimeUuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function safeUuid(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9-]/gu, '').slice(0, 64);
  return normalized || 'unavailable';
}

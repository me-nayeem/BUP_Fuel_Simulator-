export type SimulatorErrorKind =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'CIRCUIT_OPEN'
  | 'FAULT_INJECTED'
  | 'DOMAIN'
  | 'VALIDATION'
  | 'INVALID_RESPONSE'
  | 'HTTP';

export class SimulatorError extends Error {
  constructor(
    readonly kind: SimulatorErrorKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SimulatorError';
  }

  /** Transient failures worth retrying. Domain 4xx rejections are never retried. */
  get retryable(): boolean {
    return (
      this.kind === 'TIMEOUT' ||
      this.kind === 'NETWORK' ||
      this.kind === 'FAULT_INJECTED' ||
      (this.kind === 'HTTP' && this.status !== undefined && this.status >= 500)
    );
  }
}

/**
 * The simulator uses three error shapes:
 *   domain 4xx     {"detail": {"code": "ROUTE_DISRUPTED", "message": "..."}}
 *   injected fault {"error":  {"code": "FAULT_INJECTED",  "message": "..."}}   (stream fault uses "detail")
 *   validation 422 {"detail": [ ...pydantic errors... ]}
 */
export function toSimulatorError(status: number, body: unknown): SimulatorError {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const nested = (record.error ?? record.detail) as unknown;

  if (Array.isArray(nested)) {
    return new SimulatorError(
      'VALIDATION',
      'Simulator rejected the request payload',
      status,
      'VALIDATION_ERROR',
    );
  }

  const info = (nested && typeof nested === 'object' ? nested : {}) as Record<string, unknown>;
  const code = typeof info.code === 'string' ? info.code : undefined;
  const message = typeof info.message === 'string' ? info.message : `Simulator responded ${status}`;

  if (code === 'FAULT_INJECTED') return new SimulatorError('FAULT_INJECTED', message, status, code);
  if (status >= 400 && status < 500)
    return new SimulatorError('DOMAIN', message, status, code ?? `HTTP_${status}`);
  return new SimulatorError('HTTP', message, status, code ?? `HTTP_${status}`);
}

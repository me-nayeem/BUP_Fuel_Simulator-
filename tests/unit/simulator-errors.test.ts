import { describe, expect, it } from 'vitest';
import { toSimulatorError } from '@/lib/simulator/errors';

describe('toSimulatorError', () => {
  it('parses domain rejections from detail.code and does not retry them', () => {
    const error = toSimulatorError(409, {
      detail: { code: 'ROUTE_DISRUPTED', message: 'Route is disrupted' },
    });
    expect(error.kind).toBe('DOMAIN');
    expect(error.code).toBe('ROUTE_DISRUPTED');
    expect(error.retryable).toBe(false);
  });

  it('parses injected faults from error.code and retries them', () => {
    const error = toSimulatorError(503, {
      error: { code: 'FAULT_INJECTED', message: 'Simulator API temporarily unavailable.' },
    });
    expect(error.kind).toBe('FAULT_INJECTED');
    expect(error.retryable).toBe(true);
  });

  it('parses the stream fault shape nested under detail', () => {
    const error = toSimulatorError(503, { detail: { code: 'FAULT_INJECTED' } });
    expect(error.kind).toBe('FAULT_INJECTED');
  });

  it('parses pydantic validation arrays', () => {
    const error = toSimulatorError(422, { detail: [{ loc: ['body', 'quantity'], msg: 'bad' }] });
    expect(error.kind).toBe('VALIDATION');
    expect(error.retryable).toBe(false);
  });

  it('treats unknown 5xx as retryable', () => {
    expect(toSimulatorError(502, null).retryable).toBe(true);
  });
});

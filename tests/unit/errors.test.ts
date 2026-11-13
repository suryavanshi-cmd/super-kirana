import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/api';

describe('AppError reason', () => {
  it('names the step, the HTTP status and what the server said', () => {
    const e = new AppError('SERVER_ERROR', 'server', 'database svc_demo_bootstrap: 23505 duplicate key', 'demo-login/svc_demo_bootstrap', 500);
    expect(e.reason).toBe('demo-login/svc_demo_bootstrap · HTTP 500 · database svc_demo_bootstrap: 23505 duplicate key');
    expect(e.ref).toMatch(/^[A-Z2-9]{6}$/);
    expect(e.message).toBe('SERVER_ERROR');
  });
  it('does not repeat the code as the reason', () => {
    expect(new AppError('DEMO_LIMIT', 'app', 'DEMO_LIMIT').reason).toBe('');
  });
});

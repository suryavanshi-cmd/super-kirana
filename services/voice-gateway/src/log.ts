// Structured JSON logs → Cloud Logging (severity is picked up automatically). 5xx errors are written in
// Error Reporting's format, so they appear grouped in Error Reporting with their stack, with no setup.
// Never logged: audio, tokens, keys, phone numbers.
const MOBILE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;
const scrub = (v: unknown): unknown => (typeof v === 'string' ? v.replace(MOBILE, '[mobile]') : v);

function write(severity: string, message: string, fields: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = { severity, message: scrub(message), time: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) out[k] = scrub(v);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => write('INFO', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('WARNING', message, fields),
  error: (err: unknown, fields: Record<string, unknown> = {}) => {
    const e = err instanceof Error ? err : new Error(String(err));
    write('ERROR', e.stack ?? e.message, {
      ...fields,
      '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
      serviceContext: { service: 'voice-gateway', version: process.env.K_REVISION ?? 'dev' },
    });
  },
};

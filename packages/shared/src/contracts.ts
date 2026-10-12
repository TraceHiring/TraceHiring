// M0a wire contracts (spec §9.4). Every schema is strict: an unknown key fails.
import { z } from 'zod';

export const Version = z.string().regex(/^[0-9a-f]{7,40}$|^dev$/);

export const HealthResponse = z
  .object({
    status: z.literal('ok'),
    service: z.enum(['edge', 'jobs', 'api']),
    version: Version,
    time: z.iso.datetime(),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponse>;

/** apps/{candidate,recruiter}/dist/version.json */
export const AppVersionFile = z
  .object({
    app: z.enum(['candidate', 'recruiter']),
    version: Version,
  })
  .strict();
export type AppVersionFile = z.infer<typeof AppVersionFile>;

/** One JSON line per log call. `data` is always post-redaction. */
export const LogLine = z
  .object({
    ts: z.iso.datetime(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    service: z.string().min(1),
    version: Version,
    event: z.string().regex(/^[a-z0-9_.]+$/),
    requestId: z.uuid().optional(),
    orgId: z.uuid().optional(),
    data: z.unknown().optional(),
  })
  .strict();
export type LogLine = z.infer<typeof LogLine>;

export * from './contracts-tenancy.js';

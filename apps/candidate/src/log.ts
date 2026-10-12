// The candidate app logs to the console through the redacting logger only (spec §9.1, §9.2).
// It has no third-party telemetry of any kind. The logger comes from @trace/shared/log, never from
// the package root, which would pull the zod contracts into the bundle (spec D3).
import { createLogger } from '@trace/shared/log';
import { APP_VERSION } from './version';

export const log = createLogger({ service: 'candidate', version: APP_VERSION });

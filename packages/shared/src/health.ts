// Health contract helpers (spec §9.3). GET /health returns this body with cache-control: no-store.
import { HealthResponse } from './contracts.js';

export { HealthResponse };

export const healthBody = (
  service: HealthResponse['service'],
  version: string,
  now: Date = new Date(),
): HealthResponse =>
  HealthResponse.parse({ status: 'ok', service, version, time: now.toISOString() });

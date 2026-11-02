import { describe, expect, it } from 'vitest';
import { runCryptoChecks } from '../src/crypto-checks.ts';

describe('DC-D4 ES256 + HMAC in workerd', () => {
  it('runs the shared crypto checks', async () => {
    const report = await runCryptoChecks('workerd (@cloudflare/vitest-pool-workers)');
    console.log(`DC-D4 workerd: ${JSON.stringify(report)}`);
    expect(report.allPass).toBe(true);
    expect(report.results['jwt_sig_bytes']).toBe(64);
  });
});

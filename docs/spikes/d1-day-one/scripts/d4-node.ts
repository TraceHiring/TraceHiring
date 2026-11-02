import { runCryptoChecks } from '../src/crypto-checks.ts';

const report = await runCryptoChecks(`node ${process.version}`);
console.log(JSON.stringify(report));
console.log(report.allPass ? `DC-D4 node: PASS (${report.runtime})` : 'DC-D4 node: FAIL');
process.exit(report.allPass ? 0 : 1);

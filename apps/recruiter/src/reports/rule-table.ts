// The rule tables bundled with this build (specs/d1-demo-slice.md §6.1, ADR-026). "How the band is set" shows
// the table whose version equals the card's `ruleTableVersion`, or nothing at all: never a different table.
// The table is the band engine's own file, parsed by the engine's own validator; this module computes nothing.
import { parseRuleTable, type RuleTable } from '@trace/band-engine';
import d1v1 from '@trace/band-engine/rules/d1-v1.json';

const BUNDLED: readonly RuleTable[] = [parseRuleTable(d1v1)];

/** The bundled table with exactly this version, else null. */
export function bundledRuleTable(version: string): RuleTable | null {
  return BUNDLED.find((table) => table.version === version) ?? null;
}

/** A permille value (1..1000) as a percentage string, e.g. 700 -> "70%", 755 -> "75.5%". */
export function permilleAsPercent(permille: number): string {
  return `${permille / 10}%`;
}

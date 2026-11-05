import type { Citation } from './provenance';
import type { Readiness, RequirementResult, Severity } from './graph';

/**
 * Risk = severity × probability → level → who must accept it.
 * Severity categories and assessment levels follow the Navy risk-management
 * framework summarized in the NWC Maritime Staff Reference Guide (pp. 36–37).
 * Probability bands and the authority table are configurable assumptions that a
 * mission owner must set; the defaults are labelled as such.
 */
export type Probability = 'A' | 'B' | 'C' | 'D' | 'E';
export type RiskLevel = 'EH' | 'H' | 'M' | 'L';

export const PROBABILITY_NAMES: Record<Probability, string> = {
  A: 'Frequent',
  B: 'Likely',
  C: 'Occasional',
  D: 'Seldom',
  E: 'Unlikely',
};

export const SEVERITY_NAMES: Record<Severity, string> = {
  I: 'Catastrophic',
  II: 'Critical',
  III: 'Marginal',
  IV: 'Negligible',
};

export const RISK_NAMES: Record<RiskLevel, string> = { EH: 'Extremely High', H: 'High', M: 'Moderate', L: 'Low' };

export const RISK_CITATIONS: Citation[] = [
  {
    title: 'NWC Maritime Staff Reference Guide (Dec 2025), operational risk, pp. 36–37',
    url: 'https://usnwc.edu/college-of-maritime-operational-warfare/_documents/Maritime-Staff-Reference-Guide_Electronic_Dec-2025_Final.pdf',
    status: 'sourced',
    note: 'Severity I–IV, probability Frequent→Unlikely, levels EH/H/M/L.',
  },
  {
    title: 'Matrix cell values',
    status: 'assumption',
    note: 'Standard Navy risk-assessment matrix layout (OPNAVINST 3500.39 family); verify against the governing instruction before use.',
  },
  {
    title: 'Probability bands and authority table',
    status: 'assumption',
    note: 'Numeric bands for Monte Carlo failure probability and the level→authority mapping are placeholders for the mission owner to set.',
  },
];

export const MATRIX: Record<Severity, Record<Probability, RiskLevel>> = {
  I: { A: 'EH', B: 'EH', C: 'H', D: 'H', E: 'M' },
  II: { A: 'EH', B: 'H', C: 'H', D: 'M', E: 'L' },
  III: { A: 'H', B: 'M', C: 'M', D: 'L', E: 'L' },
  IV: { A: 'M', B: 'L', C: 'L', D: 'L', E: 'L' },
};

export interface ProbabilityBands {
  A: number;
  B: number;
  C: number;
  D: number;
}

/** Lower bounds of P(fail) for each band (assumption). */
export const DEFAULT_BANDS: ProbabilityBands = { A: 0.5, B: 0.2, C: 0.05, D: 0.01 };

export function probabilityFromP(p: number, b: ProbabilityBands = DEFAULT_BANDS): Probability {
  if (p >= b.A) return 'A';
  if (p >= b.B) return 'B';
  if (p >= b.C) return 'C';
  if (p >= b.D) return 'D';
  return 'E';
}

/** Without a Monte Carlo run: a planned N will happen; UNK cannot be ruled out. */
export function probabilityFromStatus(s: Readiness): Probability {
  return s === 'N' ? 'A' : s === 'UNK' ? 'B' : s === 'Q' ? 'C' : 'E';
}

export type AuthorityTable = Record<RiskLevel, string>;

export const DEFAULT_AUTHORITY: AuthorityTable = {
  L: 'Commanding Officer',
  M: 'Warfare commander / DESRON',
  H: 'Strike group commander (CWC)',
  EH: 'Numbered fleet commander',
};

export interface RiskAssessment {
  severity: Severity;
  probability: Probability;
  level: RiskLevel;
  authority: string;
  basis: 'monte-carlo' | 'deterministic' | 'declared';
  pFail?: number;
  text: string;
}

export function assess(severity: Severity, probability: Probability, authority: AuthorityTable, basis: RiskAssessment['basis'], pFail?: number): RiskAssessment {
  const level = MATRIX[severity][probability];
  const pTxt = pFail !== undefined ? ` (P(fail) ≈ ${(pFail * 100).toFixed(1)}%)` : '';
  return {
    severity, probability, level, authority: authority[level], basis, pFail,
    text: `${SEVERITY_NAMES[severity]} × ${PROBABILITY_NAMES[probability]}${pTxt} → ${RISK_NAMES[level]}; acceptance: ${authority[level]}`,
  };
}

export function assessRequirement(rr: RequirementResult, severity: Severity, authority: AuthorityTable, pFail?: number, bands?: ProbabilityBands): RiskAssessment {
  if (pFail !== undefined) return assess(severity, probabilityFromP(pFail, bands), authority, 'monte-carlo', pFail);
  return assess(severity, probabilityFromStatus(rr.status), authority, 'deterministic');
}

const ORDER: RiskLevel[] = ['L', 'M', 'H', 'EH'];
export function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

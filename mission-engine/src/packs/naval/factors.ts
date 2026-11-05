import type { Citation, FactorTable } from '../../core/provenance';

/**
 * Naval planning factors with their sources. Status per table:
 *   sourced   – numbers taken from the cited public document
 *   derived   – computed from a sourced table (stated how)
 *   synthetic – invented for the hackathon scenario; replace with governed data
 *   assumption– a structural rule we chose; confirm with the mission owner
 */
export const C = {
  GAO98: {
    title: 'GAO/NSIAD-98-1, Navy Aircraft Carriers: Cost-Effectiveness of Conventionally and Nuclear-Powered Carriers, App. III (1997)',
    url: 'https://www.globalsecurity.org/military/library/report/gao/nsiad98001/a3.htm',
    status: 'sourced',
  } as Citation,
  BROWN_CARLYLE: {
    title: 'Brown & Carlyle, "Optimizing the US Navy\'s Combat Logistics Force," Naval Research Logistics 55 (2008)',
    url: 'https://faculty.nps.edu/gbrown/docs/BrownCarlyle2008NRL.pdf',
    status: 'sourced',
  } as Citation,
  TAKE_FACT: {
    title: 'U.S. Navy fact file, Dry Cargo/Ammunition Ships (T-AKE)',
    url: 'https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2211797/dry-cargoammunition-ships-t-ake',
    status: 'sourced',
  } as Citation,
  NWP_4_01_4: {
    title: 'NWP 4-01.4 Underway Replenishment (Change 1, Mar 2001), Ch. 1',
    url: 'https://www.maritime.dot.gov/sites/marad.dot.gov/files/2023-01/unrep-nwp04-01.pdf',
    status: 'sourced',
  } as Citation,
  ROC_POE: {
    title: 'OPNAVINST 3501.160C ROC/POE for CG-47 class (Sep 2012)',
    url: 'https://webarchive.library.unt.edu/web/20130214013851/http://doni.daps.dla.mil/Directives/03000%20Naval%20Operations%20and%20Readiness/03-500%20Training%20and%20Readiness%20Services/3501.160C.pdf',
    status: 'sourced',
  } as Citation,
  DODIG: {
    title: 'DODIG-2020-056, Navy destroyer readiness (Jan 2020), pp. 8–9',
    url: 'https://media.defense.gov/2020/Feb/04/2002243739/-1/-1/1/DODIG-2020-056.PDF',
    status: 'sourced',
  } as Citation,
  MCO_3000: {
    title: 'MCO 3000.13A (DRRS Y/Q/N definitions), p. 4-3',
    url: 'https://www.hqmc.marines.mil/Portals/138/MCO_3000.13A_18_JUL_2017.pdf',
    status: 'sourced',
  } as Citation,
  UMMIPS: {
    title: 'UMMIPS F/AD × UND → priority designator (NAVSUP P-485, via NAVEDTRA summary)',
    url: 'https://navyadvancement.tpub.com/14504/css/Uniform-Material-Movement-And-Issue-Priority-System-132.htm',
    status: 'derived',
    note: 'Source confirms F/AD II + UND C → PD 12 and the 01–15 range; other cells follow the standard table and should be verified against NAVSUP P-485.',
  } as Citation,
  CASREP: {
    title: 'CASREP categories (NWP 1-03.1 Operational Reports)',
    url: 'https://www.tpub.com/gunners/276.htm',
    status: 'assumption',
    note: 'Public summaries confirm categories reflect urgency and are not readiness ratings; the C-2/3/4 meanings used here are the common reading and must be verified in NWP 1-03.1.',
  } as Citation,
  TRAM: {
    title: 'USNI News, "Navy Conducts First Successful Tests Reloading Missiles and Rearming Warships At Sea" (Oct 2024)',
    url: 'https://news.usni.org/2024/10/15/navy-conducts-first-successful-tests-reloading-missiles-and-rearming-warships-at-sea',
    status: 'sourced',
  } as Citation,
  BAHRAIN: {
    title: 'Military Times, "Navy not returning to damaged Bahrain base anytime soon" (Sep 2026)',
    url: 'https://militarytimes.com/news/your-navy/2026/09/01/navy-not-returning-to-damaged-bahrain-base-anytime-soon-top-officer-says',
    status: 'sourced',
  } as Citation,
  MSRG: {
    title: 'NWC Maritime Staff Reference Guide (Dec 2025)',
    url: 'https://usnwc.edu/college-of-maritime-operational-warfare/_documents/Maritime-Staff-Reference-Guide_Electronic_Dec-2025_Final.pdf',
    status: 'sourced',
  } as Citation,
  EMCON: {
    title: 'USNI Proceedings, "Get Used to EMCON" (Jul 2017)',
    url: 'https://www.usni.org/magazines/proceedings/2017/july/professional-notes-get-used-emcon',
    status: 'sourced',
  } as Citation,
  SYNTH: { title: 'Synthetic hackathon value', status: 'synthetic', note: 'Invented for the scenario; replace with Fleet-provided data.' } as Citation,
};

export interface EnduranceRow {
  [k: string]: unknown;
  cls: string;
  kt: number;
  pctPerDay: number;
}

/** Daily fuel use as % of total load, by speed (GAO/NSIAD-98-1 Table III.3). */
export const ENDURANCE: FactorTable<EnduranceRow> = {
  id: 'naval.endurance',
  title: 'Daily fuel use as % of load by speed',
  units: { kt: 'kt', pctPerDay: '%/day' },
  rows: [
    ...[[18, 5], [22, 7], [26, 10], [30, 14]].map(([kt, p]) => ({ cls: 'CV', kt, pctPerDay: p })),
    ...[[18, 7], [22, 9], [26, 14], [30, 22]].map(([kt, p]) => ({ cls: 'CG-47', kt, pctPerDay: p })),
    ...[[18, 8], [22, 11], [26, 15], [30, 22]].map(([kt, p]) => ({ cls: 'DD-963', kt, pctPerDay: p })),
    ...[[18, 10], [22, 13], [26, 18], [30, 26]].map(([kt, p]) => ({ cls: 'DDG-51', kt, pctPerDay: p })),
  ],
  citations: [{ ...C.GAO98, locator: 'Table III.3', note: '1997 data. Speeds below 18 kt are clamped to the 18 kt value (conservative) and flagged.' }],
  status: 'sourced',
};

/** Daily consumption in barrels (GAO/NSIAD-98-1 Table III.2). */
export const DAILY_CONSUMPTION: FactorTable = {
  id: 'naval.daily_consumption',
  title: 'Daily consumption, battle group units',
  units: { dfmBbl: 'bbl/day', jp5Bbl: 'bbl/day', ordnanceTons: 't/day' },
  rows: [
    { cls: 'CV', dfmBbl: 2700, jp5Bbl: 6500, ordnanceTons: '70–150' },
    { cls: 'CVN', dfmBbl: 0, jp5Bbl: 6500, ordnanceTons: '70–150' },
    { cls: 'CG-47', dfmBbl: 725 },
    { cls: 'DD-963', dfmBbl: 710 },
    { cls: 'DDG-51', dfmBbl: 710 },
  ],
  citations: [{ ...C.GAO98, locator: 'Table III.2' }],
  status: 'sourced',
};

export const REPLENISHMENT_POLICY: FactorTable = {
  id: 'naval.replenishment_policy',
  title: 'Replenishment planning rules',
  units: { triggerPct: '%', fillPct: '%', reserveDays: 'days' },
  rows: [
    { rule: 'replenish trigger', triggerPct: 30, source: 'GAO-98-1 Tables III.4–III.5' },
    { rule: 'refuel to', fillPct: 100, source: 'GAO-98-1 Tables III.4–III.5' },
    { rule: 'transit success', triggerPct: 30, source: 'group arrives with ≥30% collectively (GAO-98-1 Table III.5)' },
    { rule: 'commander reserve preference', reserveDays: '10–12', source: 'Brown & Carlyle 2008, p. 806' },
    { rule: 'extremis floor', triggerPct: 15, source: 'synthetic: below this a ship cannot sustain its tasking' },
  ],
  citations: [C.GAO98, { ...C.BROWN_CARLYLE, locator: 'p. 806' }, C.SYNTH],
  status: 'derived',
};

export interface ClfRow {
  [k: string]: unknown;
  cls: string;
  fuelBbl: number;
  nmPerDay: number;
  note: string;
}

export const CLF: FactorTable<ClfRow> = {
  id: 'naval.clf',
  title: 'Combat Logistics Force capacities and transit speeds',
  units: { fuelBbl: 'bbl', nmPerDay: 'nm/day' },
  rows: [
    { cls: 'T-AO', fuelBbl: 180000, nmPerDay: 384, note: 'about 20 kt max; limited dry and refrigerated stores' },
    { cls: 'T-AOE', fuelBbl: 156000, nmPerDay: 600, note: '1,800 t ordnance, 250 t dry, 400 t refrigerated' },
    { cls: 'T-AKE', fuelBbl: 18000, nmPerDay: 308, note: '6,675 t dry cargo incl. ammunition; 1,716 t refrigerated' },
  ],
  citations: [{ ...C.BROWN_CARLYLE, locator: 'pp. 801–803' }, C.TAKE_FACT],
  status: 'sourced',
};

export const UNREP: FactorTable = {
  id: 'naval.unrep',
  title: 'UNREP planning factors',
  units: { alongsideH: 'h', oneHoseFactor: '×' },
  rows: [
    { cls: 'DDG-51', alongsideH: 2.0, note: 'synthetic topoff time alongside (rig to unrig)' },
    { cls: 'CG-47', alongsideH: 2.5, note: 'synthetic' },
    { cls: 'CVN', alongsideH: 3.0, note: 'synthetic (JP-5)' },
    { rule: 'one-hose UNREP', oneHoseFactor: 1.5, note: '"may increase time alongside by as much as 50 percent for small escorts" (NWP 4-01.4 §1.6.1)' },
    { rule: 'order alongside change', note: 'efficiency "may be reduced by as much as 50 percent" (NWP 4-01.4 §1.2.4)' },
  ],
  citations: [C.NWP_4_01_4, C.SYNTH],
  status: 'derived',
};

export const READINESS_RULES: FactorTable = {
  id: 'naval.readiness_rules',
  title: 'Readiness reporting and crew endurance rules',
  units: { hours: 'h' },
  rows: [
    { rule: 'DRRS-N update interval', hours: 720, source: '30 days (DODIG-2020-056 p. 9)' },
    { rule: 'DRRS-N significant change', hours: 24, source: 'within 24 h (DODIG-2020-056 p. 9)' },
    { rule: 'Condition I crew endurance', hours: 24, source: 'OPNAVINST 3501.160C' },
    { rule: 'Condition II duration', hours: 240, source: 'OPNAVINST 3501.160C (10 days)' },
    { rule: 'Condition III crew endurance', hours: 1440, source: 'OPNAVINST 3501.160C (60 days)' },
    { rule: 'MET Y/Q/N meaning', source: 'MCO 3000.13A p. 4-3' },
  ],
  citations: [C.DODIG, C.ROC_POE, C.MCO_3000],
  status: 'sourced',
};

export const UMMIPS_PD: FactorTable = {
  id: 'naval.ummips',
  title: 'UMMIPS priority designator by F/AD and urgency of need',
  units: { pd: '01 (highest) – 15' },
  rows: [
    { fad: 'I', A: 1, B: 4, C: 11 },
    { fad: 'II', A: 2, B: 5, C: 12 },
    { fad: 'III', A: 3, B: 6, C: 13 },
    { fad: 'IV', A: 7, B: 9, C: 14 },
    { fad: 'V', A: 8, B: 10, C: 15 },
  ],
  citations: [C.UMMIPS],
  status: 'derived',
};

export const CASREP_MAP: FactorTable = {
  id: 'naval.casrep_effect',
  title: 'How a CASREP category affects system availability in the engine',
  units: {},
  rows: [
    { category: 'C-2', meaning: 'deficiency; primary missions not degraded', effect: 'system stays available (noted)' },
    { category: 'C-3', meaning: 'major degradation of a primary mission', effect: 'system unavailable until repaired' },
    { category: 'C-4', meaning: 'loss of at least one primary mission', effect: 'system unavailable until repaired' },
  ],
  citations: [C.CASREP],
  status: 'assumption',
};

export const VLS_RELOAD: FactorTable = {
  id: 'naval.vls_reload',
  title: 'VLS reload constraints',
  units: {},
  rows: [
    { rule: 'routine reload', where: 'in port', note: 'ships that fire VLS missiles must return to port to reload' },
    { rule: 'TRAM at-sea reload', where: 'alongside T-AKE', note: 'demonstrated Oct 2024 in sea states 1–3 (brief sea state 4)' },
  ],
  citations: [C.TRAM],
  status: 'sourced',
};

/**
 * Which systems, teams and stocks each mission-essential task needs, by class.
 * Mission-area codes come from ROC/POE (AW, STW, MOB, CCC); the system mapping
 * is a synthetic, unclassified stand-in for the real ROC/POE and MET lists.
 */
export interface MetRule {
  [k: string]: unknown;
  cls: string;
  code: string;
  label: string;
  systems: { kind: string; k?: number }[];
  team?: { qual: string; k: number; label: string };
  stocks?: ('fuel-extremis' | 'sm-reserve' | 'tlam-salvo')[];
  c2?: boolean;
}

export const MET_MAP: FactorTable<MetRule> = {
  id: 'naval.met_map',
  title: 'Mission-essential task → required systems (synthetic)',
  units: {},
  rows: [
    { cls: 'DDG-51', code: 'MOB', label: 'Mobility', systems: [{ kind: 'gtm', k: 3 }, { kind: 'ssgtg', k: 2 }, { kind: 'steering' }], stocks: ['fuel-extremis'] },
    { cls: 'DDG-51', code: 'AW', label: 'Air & missile defense', systems: [{ kind: 'spy' }, { kind: 'aegis' }, { kind: 'vls' }], team: { qual: 'AMD', k: 2, label: 'AMD watch team' }, stocks: ['sm-reserve'] },
    { cls: 'DDG-51', code: 'STW', label: 'Strike warfare (TLAM)', systems: [{ kind: 'vls' }, { kind: 'ttwcs' }], team: { qual: 'STRIKE', k: 2, label: 'Strike team' }, stocks: ['tlam-salvo'], c2: true },
    { cls: 'DDG-51', code: 'CCC', label: 'Command, control & communications', systems: [{ kind: 'satcom' }, { kind: 'link16' }] },
    { cls: 'CG-47', code: 'MOB', label: 'Mobility', systems: [{ kind: 'gtm', k: 3 }, { kind: 'ssgtg', k: 2 }, { kind: 'steering' }], stocks: ['fuel-extremis'] },
    { cls: 'CG-47', code: 'AW', label: 'Air & missile defense', systems: [{ kind: 'spy' }, { kind: 'aegis' }, { kind: 'vls' }], team: { qual: 'AMD', k: 2, label: 'AMD watch team' }, stocks: ['sm-reserve'] },
    { cls: 'CG-47', code: 'STW', label: 'Strike warfare (TLAM)', systems: [{ kind: 'vls' }, { kind: 'ttwcs' }], team: { qual: 'STRIKE', k: 2, label: 'Strike team' }, stocks: ['tlam-salvo'], c2: true },
    { cls: 'CG-47', code: 'CCC', label: 'Command, control & communications', systems: [{ kind: 'satcom' }, { kind: 'link16' }] },
    { cls: 'CVN', code: 'CCC', label: 'Command, control & communications', systems: [{ kind: 'satcom' }, { kind: 'link16' }] },
    { cls: 'CVN', code: 'COD', label: 'Carrier onboard delivery', systems: [{ kind: 'flightdeck' }, { kind: 'cmv22', k: 1 }] },
  ],
  citations: [{ ...C.ROC_POE, note: 'Mission-area codes only.' }, C.SYNTH],
  status: 'synthetic',
};

export const NAVAL_TABLES: FactorTable[] = [
  ENDURANCE, DAILY_CONSUMPTION, REPLENISHMENT_POLICY, CLF, UNREP, READINESS_RULES, UMMIPS_PD, CASREP_MAP, VLS_RELOAD, MET_MAP,
] as unknown as FactorTable[];

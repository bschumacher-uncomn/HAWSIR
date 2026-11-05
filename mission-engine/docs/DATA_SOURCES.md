# Data sources and status

Status: **sourced** = numbers from the cited public document; **derived** = computed from sourced numbers (method stated); **synthetic** = invented for the hackathon, replace with Fleet data; **assumption** = a rule we chose, confirm with the mission owner.

## Naval pack factor tables

| Table | Status | Source | Notes |
|---|---|---|---|
| `naval.endurance` | sourced | GAO/NSIAD-98-1 App. III, Table III.3 (1997) | % of load per day at 18/22/26/30 kt for CV, CG-47, DD-963, DDG-51. Below 18 kt is clamped to the 18 kt value and flagged `extrapolated` |
| `naval.daily_consumption` | sourced | GAO/NSIAD-98-1 Table III.2 | bbl/day: CV 2,700 DFM + 6,500 JP-5; CVN 6,500 JP-5; CG-47 725; DDG-51 710; carrier ordnance 70–150 t/day |
| `naval.replenishment_policy` | derived | GAO Tables III.4–III.5; Brown & Carlyle 2008 p. 806 | Replenish at 30%, fill to 100%, arrive ≥30%; commander reserve 10–12 days. **Extremis floor 15% is synthetic** |
| `naval.clf` | sourced | Brown & Carlyle 2008 pp. 801–803; Navy T-AKE fact file | T-AO ~180,000 bbl, 384 nm/day; T-AOE ~156,000 bbl, 600 nm/day; T-AKE 18,000 bbl, 6,675 t dry, 1,716 t refrigerated, 308 nm/day |
| `naval.unrep` | derived | NWP 4-01.4 §1.2.4, §1.6.1 | One-hose up to +50% time alongside; order-alongside change up to −50% efficiency. **Per-class time alongside is synthetic** (Figure 1-2 rates not extracted) |
| `naval.readiness_rules` | sourced | DODIG-2020-056 p. 9; OPNAVINST 3501.160C; MCO 3000.13A p. 4-3 | DRRS-N 30-day update / 24 h significant change; Condition I 24 h, II 10 d, III 60 d; Y/Q/N meanings |
| `naval.ummips` | derived | NAVEDTRA summary of NAVSUP P-485 | F/AD II + UND C → PD 12 confirmed; **other cells follow the standard table, verify** |
| `naval.casrep_effect` | assumption | NWP 1-03.1 (summaries) | C-2 stays available; C-3/C-4 unavailable until repaired. **Verify category meanings in NWP 1-03.1** |
| `naval.vls_reload` | sourced | USNI News, Oct 2024 (TRAM test) | Routine reload in port; TRAM demonstrated sea states 1–3 |
| `naval.met_map` | synthetic | Mission-area codes from OPNAVINST 3501.160C | Which systems, teams and stocks each MET needs is an unclassified stand-in for ROC/POE and MET lists |

## Airlift pack

| Table | Status | Source | Notes |
|---|---|---|---|
| `airlift.aircraft` CMV-22B | sourced (range, payload) / synthetic (cruise) | USNI News Jan 2020 citing NAVAIR | 1,150 nm, 6,000 lb; 240 kt cruise is synthetic |
| `airlift.aircraft` C-17A | synthetic | Shaped like AFPAM 10-1403 factors | Replace with the governed AFPAM 10-1403 values AMPLIFI already ingests |

## Policy defaults (overridable by scoped facts)

| Attribute | Default | Status |
|---|---|---|
| `replenish_trigger_pct` | 30% | sourced (GAO-98-1) |
| `extremis_fuel_pct` | 15% | synthetic |
| `sm_reserve_rounds` | 8 | synthetic |

## Risk

Severity I–IV, probability Frequent→Unlikely and levels EH/H/M/L follow the NWC Maritime Staff Reference Guide (Dec 2025) pp. 36–37. **Matrix cells** follow the standard Navy layout (OPNAVINST 3500.39 family) and should be verified. **Probability bands** (A ≥ 50%, B ≥ 20%, C ≥ 5%, D ≥ 1%) and the **authority table** are assumptions.

## Scenario: Operation STEEL TIDE

Every hull, name, place and number is fictional. The structure mirrors the public cases in the research doc:

- SATCOM casualty before a strike, under EMCON, with a Link-16 relay and command-by-negation options (USNI Proceedings 2017 on EMCON; NWC MSRG);
- forward hub lost and logistics re-routed to a distant atoll (Military Times, Sep 2026, NSA Bahrain → Diego Garcia; the scenario's 2,000 nm is synthetic);
- VLS inventory that cannot be reloaded at sea (USNI 2024);
- CLF oiler transit at the Brown & Carlyle T-AO speed of advance;
- burn rates from GAO Table III.3.

## To verify before any Fleet use

1. CASREP C-2/C-3/C-4 definitions (NWP 1-03.1).
2. UMMIPS priority table cells (NAVSUP P-485).
3. Risk matrix cells and authority mapping (OPNAVINST 3500.39 / mission owner).
4. MET → system mapping (ROC/POE and NMETL for each class).
5. UNREP transfer rates (NWP 4-01.4 Figure 1-2, current UNREP summaries).
6. DRRS-N reporting rules (NTRP 1-03.5, OPNAVINST 3501.360A; public fetch was blocked).

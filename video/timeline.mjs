// Edit decision list shared by the picture (hype.js) and the score (score.mjs).
// 120 BPM: one beat = 0.5 s, one bar = 2 s. Every cut and hit lands on the grid.
export const FPS = 30;
export const BPM = 120;
export const DURATION = 84;

/** Frame counts of the captured clips (video/footage/clips/<name>/0000.jpg …). */
export const CLIP_FRAMES = { boot: 210, run_thread: 420, reports_land: 450, approve: 210, thread_switch: 300, watch_feed: 390, emcon: 210, tamper: 270 };

export const CRITERIA = [
  {
    n: '01', name: 'Warfighting & Deckplate Impact', short: 'Deckplate impact', weight: 30, card: 8, end: 24, color: '#22d3ee',
    punch: ['Executable', 'mission', 'readiness.'],
    attack: 'Turn operational architecture into an executable mission-readiness engine that identifies critical constraints, simulates responses, and reduces Sailor cognitive burden.',
  },
  {
    n: '02', name: 'Speed to Fleet', short: 'Speed to fleet', weight: 20, card: 24, end: 38, color: '#34d399',
    punch: ['The', 'link', 'drops.', 'NAVIFI', "doesn't."],
    attack: 'Deliver a containerized, DDIL-capable application through existing Navy and DoD PaaS and DevSecOps infrastructure without requiring a new technology stack.',
  },
  {
    n: '03', name: 'Fleet Scalability', short: 'Scalability', weight: 20, card: 38, end: 50, color: '#60a5fa',
    punch: ['One', 'engine.', 'Every', 'mission', 'thread.'],
    attack: 'Use a platform-independent architecture with configurable mission threads, SoS interfaces, and deployment profiles to support multiple ship classes, missions, and operating environments.',
  },
  {
    n: '04', name: 'Barrier Removal', short: 'Barriers', weight: 15, card: 50, end: 62, color: '#fbbf24',
    punch: ['The', 'Sailor', 'is', 'not', 'the', 'integration', 'layer.'],
    attack: 'Eliminate manual data reconciliation, duplicate entry, and cross-system coordination by automatically integrating legacy data and executing operational workflows.',
  },
  {
    n: '05', name: "Judges' Discretion", short: 'Discretion', weight: 15, card: 62, end: 76, color: '#c084fc',
    punch: ['The', 'AI', 'explains.', 'The', 'human', 'commands.'],
    attack: 'Demonstrate a visually compelling, Sailor-first interface where live operational events propagate through an executable mission graph to produce explainable, evidence-backed, human-controlled decisions.',
  },
];
export const CARD_SECS = 3;

/** Hard cuts get a flash, a glitch and a whoosh. */
export const CUTS = [6, 8, 11, 15.5, 20, 24, 27, 30.5, 34, 38, 41, 42, 43, 44, 45, 50, 53, 57.5, 62, 65, 69, 73, 76, 80];
/** Heavy hits: boom + camera shake. */
export const IMPACTS = [4, 6, 8, 24, 38, 50, 62, 76, 80];
/** Noise risers end on these times (one bar long). */
export const RISERS = [8, 24, 38, 50, 62, 76, 80];
/** UI blips (status pills, stack layers, counters). */
export const BLIPS = [1.5, 2, 2.5, 3, 3.5, 34, 34.5, 35, 35.5, 36, 45.5, 46, 46.5, 47, 76.5, 77, 77.5, 78, 78.5];
/** Drums drop out for the bar before each card so the riser can breathe. */
export const DRUMS = { from: 8, to: 80, breaks: [[22, 24], [36, 38], [48, 50], [60, 62], [74, 76]] };

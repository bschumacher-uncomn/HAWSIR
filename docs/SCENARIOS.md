# The two missions

Both missions are synthetic and unclassified. Each one is a list of reports that arrive during a watch. The engine recomputes the picture every time a report lands. Pick a mission in the header dropdown.

| | ATLAS SHIELD | STEEL TIDE |
|---|---|---|
| Header label | DDG readiness · 21d | CSG strike · STEEL TIDE |
| Ships | One destroyer: USS GRACE HOPPER (DDG-170) | A carrier strike group: four escorts plus an oiler; own ship USS KITTREDGE (DDG-181) |
| Clock | Days: D-21 to D+8 (labels like `D-14 1400`) | Hours around H-hour: `H-12:00` to `H+2:00` |
| Question | Will each warfare capability be ready when the ship reaches station? | Will the TLAM strike launch at H, and what does the group do when Kittredge loses its radio? |
| Engine pack | Authored thread: a hand-written dependency graph, every value bound to a report | Naval pack: the graph is compiled from a domain model (ships, systems, people, fuel, magazines, networks, strikes) |
| Best screens | Watch Floor, Mission Thread, Graph | Theater (all ships moving), Watch Floor, Decision Log (ship ⇄ shore) |

---

## ATLAS SHIELD: 21 days to tasking

**Setting.** USS GRACE HOPPER is in Norfolk. It sails D-12, picks up its helicopter detachment off the Virginia Capes, transits the Atlantic, makes a logistics stop at Rota, passes Gibraltar, and takes a ballistic-missile-defense (BMD) patrol station in the Eastern Med at D-0 0800. Phase II (D+6) is escorting a high-value unit.

**Capabilities tracked.** These are the cards on the left of the Watch Floor:

- **AMD**: air and missile defense. Needs all four SPY-1D radar arrays, Aegis, VLS, the ordnance load-out and a 3-of-4 BMD watch team. Needed D-0 0800.
- **MOB**: mobility. Needs 3 of 4 propulsion turbines, 2 of 3 generators, steering and nav radar. Needed at sail, D-12 0700.
- **ASW** and **SUW**: anti-submarine and surface warfare. ASW also needs the MH-60R helicopter to embark. Needed at Gibraltar.
- **C5I**: communications. Needs crypto keys (KEYMAT) delivered and loaded. **EW**: electronic warfare. Needs the EW mission data file.

**The story, report by report.** The watch starts D-21 0800, before any report has arrived.

| When | Report | What the engine says |
|---|---|---|
| D-20 1030 | **CASREP: SPY-1D Array B transmitter.** The crossed-field amplifier (CFA) failed. No ETA for the part yet. | AMD goes down now. A repair chain appears: the part is delivered, two qualified techs replace it (6 h), then verification (4 h). With no ETA, the engine plans on a conservative assumed date and flags it **ASSUMED**. |
| D-20 1400 | R-Supply: CFA ETA Norfolk D-15 1200. | AMD recovers to a real date. It arrives before sail, so the Norfolk pier delivery works. |
| D-19 0900 | FC1 Martinez gets TAD orders to Aegis school. He rejoins at Rota. | **No mission consequence.** The other two techs can do the repair in Norfolk. This shows upstream slack absorbing a change. |
| D-18 1100 | CASREP: generator #2 vibration. Electrical plant 2 of 3. | MOB stays Y but is flagged **no redundancy**: one more casualty becomes a mission problem. |
| D-17 1600 | **R-Supply: CFA ETA slips 2d 3h**, to D-12 1500. That is 8 h after the ship sails. | **Nonlinear.** The part misses the Norfolk pier window, so the next delivery is the Rota stop at D-5. A 2-day slip costs about 9 days of AMD margin. The thread shows "missed Norfolk pier". |
| D-16 0800 | FC2 Okafor goes on emergency leave, rejoins at Rota D-4. | Now the repair at Rota needs two techs, and only Martinez (back D-5) is there. **Control shifts to FC1 Martinez.** AMD is ready D-5 2200, Q, with 4d 10h of margin. |
| D-15 1100 | DLA tracking disagrees with R-Supply on the CFA ETA. | Flagged **CONTRADICTORY**. The engine plans on the more conservative date and says so. |
| D-15 1500 | Helo detachment ready D-11 1500; the fly-on window closes 1700. | ASW still shows days of margin, but the helicopter is now 2 hours from missing its fly-on window. That is a **hidden cliff**: two more hours of slip and the next chance to embark is Rota, days later. The Graph's consequence curve shows the step. |
| D-14 0900 | NAVSEA withdraws the repair-time estimate. | Duration flagged **MISSING**. The engine uses an assumed 6 h and tells you to verify before acting. |
| D-14 1300 | An NSIPS record for LTJG Diaz has an invalid date. | Rejected as **MALFORMED** and quarantined. The last good value stands. No consequence. |

**Where the replay stops (D-14 1400).** AMD is **Q**. It will be ready D-5 2200 against a D-0 0800 need, with 4 days 10 hours of margin. FC1 Martinez controls it.

**Options.** These are on the Watch Floor under 05:

- **Expedite alone recovers nothing.** Getting the part to Norfolk faster doesn't help, because there aren't enough techs aboard to install it before sail.
- **Expedite plus the MARMC fly-away tech team** recovers about a week. That fixes both binding constraints at once.
- **Accept degraded AMD.** Sail with 3 of 4 arrays. This is capped at Q, and the engine labels it as a risk acceptance.

Each option shows who must approve it and its act-by time. Most act-by times fall around D-13, so approve while the watch is still at D-14.

**Things to point at.**

- The 3D ship lights Array B red with "ETR D-5 2200".
- The Theater map draws the CFA's path from Susquehanna to Rota, marked "missed Norfolk pier", next to Martinez and Okafor's rejoin legs.
- In the Graph, click FC1 Martinez to see "0 slack". Drag the what-if slider to see the margin curve.

---

## STEEL TIDE: the radio goes down six hours before the strike

**Setting.** A carrier strike group (CSG-X) is on Station Delta in the Arabian Sea (all synthetic):

- the cruiser **Port Harmon**;
- destroyers **Kittredge** (own ship), **Marlowe** and **Okafor**;
- the oiler **Ada Brooks**.

At **H-hour** (60 h into the scenario), Kittredge and Marlowe fire a 24-TLAM strike. Launch authority reaches them by SATCOM, or by a Link-16 relay through Port Harmon. The group goes into **strike EMCON** (emissions control) from H-4. After the strike they form the air-defense screen, then replenish from Ada Brooks (CONSOL 1).

**Requirements tracked.**

- **STW**: strike warfare, per shooter and for the strike as a whole.
- **AW**: air warfare. The group needs 3 of 4 escorts.
- **MOB**: mobility, which includes fuel staying above the extremis floor.
- **CCC**: command and control.

The strike requirement needs each shooter to have:

- enough TLAMs for its salvo;
- a launch-authority path (SATCOM up, or the Link-16 relay outside EMCON);
- mobility.

**The story.** The watch starts at H-12.

| When | Report | What the engine says |
|---|---|---|
| H-36 / H-12 | Routine fuel reports. **Marlowe's reads 142%.** | The 142% report is quarantined as **MALFORMED**; the last good value stands. Kittredge is close to its 30% replenish trigger before CONSOL 1. Port Harmon's TLAM count was never reported, so anything that depends on it is **UNK**, not green. |
| H-6 | **CASREP: Kittredge SATCOM modem** fails. | Kittredge loses its SATCOM launch-authority path. The only other path is the Link-16 relay, and strike EMCON closes it at H-4. **The strike goes N.** |
| H-6 | NSIPS: ET2 Park sick in quarters until H+6. | The modem repair needs two ETs, so even with the part aboard the repair waits. |
| H-6 | **Kittredge's data link drops** (DDIL). | In the two-node stack, the ship stops syncing with shore. The ship keeps computing on what it holds. Shore stops hearing from it. |
| H-5:30 | R-Supply: modem staged at Alpha Airfield, ETA H-2 by COD then helo cross-deck. | Repair is projected, but too late for H. |
| H-5 | DLA tracking says the part reaches Alpha Airfield five hours later. | **CONTRADICTORY**. The engine plans on the later time. |
| H-2 | **Fleet SITREP: Port Alpha and Alpha Airfield closed** after an attack. | No COD from Alpha, and the oiler can't sail from Port Alpha. That hits CONSOL 1 and the escorts' fuel (MOB, AW). |
| H-1:30 | R-Supply: modem re-routed to Atoll Bravo, ETA H+10. | Bravo is 2,000 nm away, outside CMV-22B range. The modem is effectively gone for this strike. |

**Options.** The best one depends on *when* you act:

- **Before H-4: pre-brief launch authority to Kittredge before EMCON.** This recovers the strike to Y. Its act-by time is H-4, so in the replay you must pause at the H-6 CASREP to use it. Approve it with a note, for example "approved by CSG-X over HF voice".
- **After H-4:** the remaining choices are bounded and imperfect:
  - request an EMCON modification so the Link-16 relay through Port Harmon works (strike N → Q);
  - recommend slipping H-hour 6 or 12 h;
  - ask Ada Brooks to increase speed.

  The engine shows which of these actually help and which recover nothing.

**The ship ⇄ shore story.** This needs the two-node Docker stack (`mission-deploy`). Open the ship UI (:8080) and the shore UI (:8081) side by side.

1. **At H-6 the ship knows; the shore does not.** Kittredge's node shows the strike N. The shore still shows Y and lists Kittredge as silent since the link dropped.
2. **Each side hears only its own reports.** The ship approves the pre-brief on its own picture. Meanwhile the shore hears the port closure and the re-route, which the ship cannot hear.
3. **Restore the link with the SATCOM button in the header.** One exchange each way. The shore learns of the casualty and shows the ship's approval as the ship's own decision; it does not apply it as its own. The ship learns of the closures.
4. **Personnel records stay with their own ship.** The shore's sharing policy withholds other ships' personnel records from Kittredge.
5. **Time travel shows what each node knew then.** Scrub back on the shore to H-3: it still shows Y, because that is what it knew at the time.

**Things to point at.**

- On the Theater, all seven tracks move at once. Each ship is colored by its worst requirement.
- The modem's path changes from Alpha Airfield to Atoll Bravo.
- In the Decision Log, the ship's decisions arrive ashore as a separate, verified chain.

---

## Shared vocabulary

| Term | Meaning on screen |
|---|---|
| **Y / Q / N / UNK** | Ready / ready but thin or carrying a data-quality flag / will miss / can't tell because required information is missing (never shown as green) |
| **Margin** | How much later the capability could come up and still meet its need. `≥ 8d 0h` means nothing inside the planning horizon limits it; that is a floor, not a measurement. `NEVER` means there is no path inside the horizon. `UNKNOWN` means data is missing. |
| **Controlling constraint** | The one input, person, delivery window, task or stock that sets the time. Fixing anything else changes nothing. |
| **Upstream slack** | How far an input can slip with zero effect on the mission. It is different from margin: a part with 2 days of slack can slip 2 days for free. |
| **Cliff** | A point where one more hour of slip costs far more than an hour, usually a missed window. |
| **Planning assumption** | An approved option. It changes the picture in the engine only. It is never an order and never written to a source system. |
| **STOP** | Halts all advisory output on the node and records the STOP on the decision chain. Resuming requires a reason. |

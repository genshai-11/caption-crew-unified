# Captain Crew Unified Context

This context defines the Chunks-specific scoring language for the Captain/Crew and THC speaking-game apps. It exists so product, UI, and database fields use Chunks Theory terms consistently instead of drifting between OHM, meaning score, and generic gameplay score.

## Language

**CVR — Conscious Variable Resistance**:
The RED metric for semantic and structural resistance in the Captain prompt; displayed and stored with unit `Ω`.
_Avoid_: OHM analysis, Semantic Ohm, total Ohm as user-facing language

**Raw CVR units**:
The backward-compatible numeric resistance units currently produced by the OHM/CVR analysis pipeline.
_Avoid_: Treating raw units as the whole CVR concept

**TC — Term Chunk count**:
The counted semantic-resource load behind CVR, split into confirmed resources and candidate resources.
_Avoid_: Hiding confirmed and candidate resources inside one unexplained score

**LC — Linguistic Complexity**:
The multiplier for sentence length and linguistic difficulty in CVR.
_Avoid_: Treating length as the whole CVR concept

**TL — Tension Load**:
The multiplier for the cognitive/semantic load carried by the Captain prompt.
_Avoid_: Mixing TL into TC or LC

**Response Time Coefficient**:
The learner-response-speed multiplier applied explicitly in CVR.
_Avoid_: Hiding response time inside TC, LC, or TL

**Repeat Coefficient**:
The repetition/habituation multiplier applied explicitly in CVR; v1 defaults to 1 until the product has repeat input.
_Avoid_: Dropping RC from the formula because the current UI cannot measure it yet

**CCI card**:
The selectable scoring basis that contributes the base Ample for a round, for example `1-on-1 = 10A`, `RPD free = 15A`, or `n Chunks = 30A`.
_Avoid_: Treating the card as a UI-only theme toggle

**CCI — Conscious Current Intensity**:
The GREEN current calculated as **CCI card** base Ample × **MSE** × meaning decimal; displayed and stored with unit `A`.
_Avoid_: Treating CCI as the raw percentage number

**MSE — Motion, Sound, Emotion coefficient**:
The evaluator-entered embodied-performance multiplier applied to the selected **CCI card** when calculating CCI.
_Avoid_: Grammar score, pronunciation-only score

**CPD — Conscious Potential Difference**:
The BLUE unified metric produced by multiplying CCI by CVR; displayed and stored with unit `V`.
_Avoid_: Generic total score, winner points

## CCI formula (team faceoff)

The updated **CCI (A)** formula used for team-faceoff round scoring:

```
CCI_A = cciCards × (MSE + SemanticsDecimal)
```

- `SemanticsDecimal` = LLM meaning match score divided by 100 (for example, 75% → `0.75`)
- `MSE` = evaluator-entered Motion/Sound/Emotion coefficient (default 1)
- `cciCards` = selected CCI card factor or semantic chunk card count (minimum 1 as fallback)

Stored as `metrics.cci.current`; canonical `metrics.cpd.raw` remains `CCI × CVR`.

## Team faceoff round-end rules (layered, most specific first)

1. **CVR out-of-range** (`endReason: 'cvr_out_of_range'`): If Captain's CVR raw voltage is outside admin-configured `[cvrMinVolt, cvrMaxVolt]` window → **Crew (Team B) auto-wins**. The prompt was too easy or too hard to be valid.
2. **Perfect crew** (`endReason: 'perfect_crew'`): If Crew scores 100% semantic AND `MSE ≥ 1` (with `enablePerfectCrewBonus` on) → **Crew auto-wins unconditionally**.
3. **Normal** (`endReason: 'meaning'`): `%semantic ≥ crewWinThreshold` → Crew wins, else Captain wins.

## Team roster structure

- `teamMode: boolean` — enables team roster; players rotate slots each round.
- `teamA` / `teamB` — dynamic arrays of player UIDs (any size, admin-configurable `maxTeamSize`).
- `teamAIndex` / `teamBIndex` — pointer to the currently active player in each team; auto-incremented after each round.
- `swapAfterRound` — when true, Team A ↔ Team B swap Captain/Crew roles after each round instead of just rotating within team.

## Relationships

- **CVR** replaces user-facing “OHM analysis” language.
- **Raw CVR units** may still be stored in legacy-compatible technical fields such as `ohmResult` while the app migrates to canonical metric fields.
- **CCI** equals **CCI card/card-count factor** × (**MSE** + **SemanticsDecimal**), where SemanticsDecimal is the LLM meaning match score divided by 100.
- **MSE** is part of **CCI**, not a separate replacement for meaning evaluation.
- The chosen **CCI card** is selected on the round page and locks when Captain starts.
- **MSE** is entered by the evaluator on the summary page and persisted only when they explicitly save the round evaluation.
- **CVR** equals **estimatedTC** × **LC** × **TL** × **Response Time Coefficient** × **Repeat Coefficient**.
- In v1, **Repeat Coefficient** is stored/displayed as `1` because repeat input is not available yet.
- **CPD** equals **CCI** × **CVR** using CCI as a decimal current, not as a 0–100 percentage.
- Store both raw **CPD** for Chunks formula fidelity and normalized **CPD score** for UI comparison.
- Electrical units are canonical in the UI/data model: **CVR** uses `Ω`, **CCI** uses `A`, and **CPD** uses `V`.
- **CPD** is the canonical outcome metric for charts that compare conscious potential / responsiveness over time.
- CVR cards should show the formula breakdown, not only the final score: confirmed/candidate **TC**, **LC**, **TL**, **Response Time Coefficient**, **Repeat Coefficient**, then final **CVR**.

## Example dialogue

> **Dev:** “Should this result card say Semantic Ohm or CVR analysis?”
> **Domain expert:** “Use **CVR analysis**. If needed, show the old value as **raw CVR units**, but don’t teach users that OHM is the canonical metric.”
>
> **Dev:** “Is CCI just the LLM meaning score?”
> **Domain expert:** “No. **CCI = CCI cards × (MSE + SemanticsDecimal)**. The selected card/card-count supplies the CCI factor, MSE is the evaluator coefficient, and SemanticsDecimal converts preserved meaning percentage into decimal form.”
>
> **Dev:** “Should CPD be only a normalized leaderboard number?”
> **Domain expert:** “No. **CPD = CCI × CVR**. Store the raw multiplication for theory fidelity and a normalized score for comparison.”

## Dashboard role analysis

**Captain = Improvisation & Adaptation (via CVR)**:
The dashboard reads Captain skill through CVR and its components. Higher CVR means the Captain can construct harder, more complex prompts.
- CVR component profile (TC, TL, LC) reveals the Captain's tendency — whether they challenge through topic breadth (TC), tension/cognitive load (TL), or linguistic difficulty (LC).
- CVR components are displayed as **percentile-normalized** values relative to all rounds, so different scales (TC is a count, TL/LC are multipliers) are visually comparable.
- CVR difficulty bands: **0–15Ω** (Dễ), **15–35Ω** (Vừa), **35–60Ω** (Khó), **60Ω+** (Extreme).

**Crew = Static Composure (via CCI + CPD)**:
The dashboard reads Crew skill through CCI stability under varying CVR pressure. A strong Crew maintains consistent CCI regardless of Captain's CVR level.
- **Static stability** = consistency of CCI and reaction-delay across rounds.
- **CPD coverage ceiling** = the highest CVR at which Crew still passed the meaning threshold. This shows how far Crew's composure extends.
- The Crew pass/fail threshold is **dynamic** — sourced from the admin-configured `crewWinThreshold` in Firestore `game_settings/scoring`, not hardcoded.

**Flexible charts**:
Dashboard charts are configurable: admin can switch chart type (bar, scatter, line, heatmap), change X/Y axes to any available metric, or select from preset views. Presets provide sensible defaults but do not lock the visualization.

## Flagged ambiguities

- “OHM” was used as both a product proxy for resistance and the visible metric name — resolved: user-facing language should be **CVR**, with OHM retained only as backward-compatible implementation language during migration.
- “CCI” was almost reduced to LLM meaning alone — resolved: **CCI = CCI cards × (MSE + SemanticsDecimal)**.
- “MSE” could be treated as a local-only display knob — resolved: the evaluator enters **MSE** on the summary page, then explicitly saves it into round metrics for History/Profile/chart reuse.
- “CPD score” could be confused with gameplay winner points — resolved: **CPD raw** preserves `CCI × CVR`, while **CPD score** is normalized for UI comparison.
- **Repeat Coefficient** currently has no app input — resolved: keep it explicit in the CVR formula and default it to `1` in v1 instead of removing it.
- “CPU” was used while discussing charts — resolved: this product should use **CPD**, not CPU, to stay aligned with Chunks Law.
- “SUCCESS_THRESHOLD” was hardcoded at 50 in the dashboard — resolved: use the live `crewWinThreshold` from admin scoring config so dashboard and gameplay agree on what “Crew passed” means.

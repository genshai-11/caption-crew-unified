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

**CCI — Conscious Current Intensity**:
The GREEN current calculated as meaning decimal multiplied by MSE, e.g. 96% meaning becomes `0.96 × MSE`; displayed and stored with unit `A`.
_Avoid_: Treating CCI as the raw percentage number

**MSE — Motion, Sound, Emotion coefficient**:
The embodied-performance multiplier applied to LLM meaning when calculating CCI; v1 stores it as `coefficient: 1`, `source: "manual-default"`, and `measured: false` until the app can measure Motion, Sound, and Emotion directly.
_Avoid_: Grammar score, pronunciation-only score

**CPD — Conscious Potential Difference**:
The BLUE unified metric produced by multiplying CCI by CVR; displayed and stored with unit `V`.
_Avoid_: Generic total score, winner points

## Relationships

- **CVR** replaces user-facing “OHM analysis” language.
- **Raw CVR units** may still be stored in legacy-compatible technical fields such as `ohmResult` while the app migrates to canonical metric fields.
- **CCI** equals meaning decimal × **MSE**; convert 96% to `0.96` before multiplying.
- **MSE** is part of **CCI**, not a separate replacement for meaning evaluation.
- In v1, **MSE** defaults to 1 and is explicitly marked as not measured.
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
> **Domain expert:** “No. **CCI = LLM meaning percentage × MSE**. The current app already has the LLM meaning percentage; MSE is the embodied multiplier.”
>
> **Dev:** “Should CPD be only a normalized leaderboard number?”
> **Domain expert:** “No. **CPD = CCI × CVR**. Store the raw multiplication for theory fidelity and a normalized score for comparison.”

## Flagged ambiguities

- “OHM” was used as both a product proxy for resistance and the visible metric name — resolved: user-facing language should be **CVR**, with OHM retained only as backward-compatible implementation language during migration.
- “CCI” was almost reduced to LLM meaning alone — resolved: **CCI = current LLM meaning percentage × MSE**.
- “CPD score” could be confused with gameplay winner points — resolved: **CPD raw** preserves `CCI × CVR`, while **CPD score** is normalized for UI comparison.
- **Repeat Coefficient** currently has no app input — resolved: keep it explicit in the CVR formula and default it to `1` in v1 instead of removing it.
- “CPU” was used while discussing charts — resolved: this product should use **CPD**, not CPU, to stay aligned with Chunks Law.

# Runbook: Production Deploy & Runtime Config Operations (THC Caption Crew 2026)

**Version:** `v2.0-ohm-router9-single-engine`  
**Last updated:** 2026-04-21 (GMT+7)  
**System:** THC Caption Crew 2026  
**Environment:** Production (`thc-caption-crew-2026`)  
**Hosting:** https://thc-caption-crew-2026.web.app  
**Risk level:** **Medium**  
**Expected duration:** 30–60 minutes (excluding post-deploy observation)

This runbook chuẩn hóa mọi thay đổi production: deploy frontend/functions, cập nhật admin runtime config, vận hành STT, và **OHM analysis mới theo single-engine Router9**.

---

## 1) Overview

### Purpose
- Đảm bảo thay đổi production có kiểm soát, rollback nhanh.
- Chuẩn hóa deploy + config write + validation + communication.
- Cố định kiến trúc OHM mới: **Router9 only**.

### Scope (included / excluded)
**Included:**
- Deploy Firebase Hosting + Functions (`codebase: ccfaceoff`)
- Runtime config cloud (`admin-runtime/shared.json`)
- STT provider (Deepgram / Google Speech-to-Text V2)
- OHM analysis endpoint (`analyzeTranscriptOhm`) dùng Router9 single-engine

**Excluded:**
- Org-level IAM policy changes
- Large DB migration outside approved release
- SEV-1 multi-system incident command

### Key architecture decision (OHM v2)
- **Single OHM engine = Router9**
- Không dùng google/thirdparty provider path cho OHM runtime
- Response schema OHM giữ ổn định: `transcriptRaw`, `transcriptNormalized`, `chunks`, `formula`, `totalOhm`, `modelUsed`
- Mở rộng metadata (non-breaking): `baseOhm`, `lengthBucket`, `lengthCoefficient`, `sentenceCount`, `wordCount`

### OHM formula (v2)
- Base weights (dynamic default):
  - GREEN = 5
  - BLUE = 7
  - RED = 9
  - PINK = 3
- Length coefficients (dynamic allowed set): `1, 1.5, 2, 2.5`
- `overLong = 2.5` (same as LONG)

Final CVR score:

`totalOhm = baseOhm * lengthCoefficient`

Trong đó `baseOhm` lấy theo rule sum/multiply từ nhóm label.

### CCI formula (v3 — team faceoff)

```
CCI_A = cciCards × (MSE + SemanticsDecimal)
```

`SemanticsDecimal` converts LLM meaning percent into decimal form (75% → `0.75`). Stored in `metrics.cci.current`. Canonical `CPD = CCI × CVR` remains in `metrics.cpd.raw`.

### Team faceoff round-end rules (layered)

| Priority | Condition | Winner | endReason |
|---|---|---|---|
| 1 | CVR outside `[cvrMinVolt, cvrMaxVolt]` | Crew | `cvr_out_of_range` |
| 2 | 100% semantic + MSE ≥ 1 + bonus enabled | Crew | `perfect_crew` |
| 3 | %semantic ≥ crewWinThreshold | Crew | `meaning` |
| 3 | %semantic < crewWinThreshold | Captain | `meaning` |

### New admin scoring settings (v3)

| Field | Default | Description |
|---|---|---|
| `teamMode` | false | Enable team roster mode (dynamic size) |
| `cvrMinVolt` | 1 | Min valid CVR Ω — below = too easy → crew wins |
| `cvrMaxVolt` | 50 | Max valid CVR Ω — above = out of range → crew wins |
| `enablePerfectCrewBonus` | true | 100% semantic + MSE ≥ 1 → crew auto-wins |
| `swapAfterRound` | false | Swap Team A↔Team B roles after each round |
| `maxTeamSize` | 10 | Max players per team slot |

Stored in Firestore `game_settings/scoring`.

---

## 2) Preconditions & access

### Required permissions / roles
- Firebase Admin/Editor project `thc-caption-crew-2026`
- Cloud Functions + Hosting deploy permission
- GitHub write/tag permission

### Required tools / versions
- Node.js 20+
- npm
- Firebase CLI
- gcloud CLI
- Git

### Backups / snapshots confirmed
- [ ] Commit + tag trước deploy đã push
- [ ] Ghi nhận config admin hiện tại (screenshot/export JSON)
- [ ] Xác nhận rollback tag/revision gần nhất

### Secrets handling
- **Không lưu API key trong runbook/repo**
- Router9 credentials nhập qua Admin Runtime Config hoặc secret manager

---

## 3) Runtime config contract (OHM v2)

Required/important fields:

```json
{
  "router9ApiKey": "<secret>",
  "router9BaseUrl": "http://34.87.121.108:20128/v1",
  "ohmModel": "gpt",
  "ohmFallbackModel": "gpt",

  "ohmWeights": { "GREEN": 5, "BLUE": 7, "RED": 9, "PINK": 3 },
  "ohmLengthConstraints": {
    "veryShort": { "maxSentences": 1, "maxWords": 25 },
    "short": { "maxSentences": 2, "maxWords": 35 },
    "medium": { "maxSentences": 3, "maxWords": 60 },
    "long": { "maxSentences": 5, "maxWords": 110 }
  },
  "ohmLengthCoefficients": {
    "veryShort": 1,
    "short": 1.5,
    "medium": 2,
    "long": 2.5,
    "overLong": 2.5
  }
}
```

---

## 4) Execution steps

1. **Sync + install**
```bash
git pull --rebase
npm install
cd functions && npm install && cd ..
```

2. **Build + syntax checks**
```bash
npm run build
cd functions && node --check src/index.js && cd ..
```

3. **Version checkpoint (mandatory)**
```bash
git add <intended-files>
git commit -m "<release message>"
git tag -a <prod-tag> -m "<release note>"
git push origin master
git push origin <prod-tag>
```

3.1 **Human approval gate (mandatory)**
- Sau khi có commit + tag, **không publish production ngay**.
- Phải gửi release summary + rủi ro + rollback tag và đợi xác nhận “approved for production”.
- Chỉ deploy khi có xác nhận explicit.

4. **Deploy functions**
```bash
firebase deploy --only functions:ccfaceoff --project thc-caption-crew-2026
```

5. **Deploy hosting**
```bash
firebase deploy --only hosting --project thc-caption-crew-2026
```

6. **Admin runtime config save**
- Login `/admin`
- Set Router9 OHM fields (`router9ApiKey`, `router9BaseUrl`, `ohmModel`, `ohmFallbackModel`)
- Verify OHM dynamic settings (weights/length constraints/coefficients)
- Save and confirm cloud sync loaded/saved

7. **Validation tests**
- STT Vietnamese / English
- OHM analyze preview in Admin (check model used)
- Confirm score math with known transcript samples

8. **Gameplay smoke test**
- Deepgram mode behavior
- Google STT mode behavior
- End-to-end round with OHM result visible and non-zero when expected

---

## 5) Validation checklist

### Functional checks
- `/admin` login works
- Cloud config load/save works
- `analyzeTranscriptOhm` returns stable schema fields
- `modelUsed` reflects Router9 model
- `totalOhm == baseOhm * lengthCoefficient`

### Technical checks
- No repeated 500 for `analyzeTranscriptOhm`
- No auth/CORS errors for runtime config file
- No malformed JSON errors from model output parsing

### Observation window
- 15–30 minutes post release

---

## 6) Rollback / abort plan

### Rollback triggers
- OHM analysis error rate > 5% in 10 minutes
- Admin save/config load broken
- Critical gameplay scoring regression

### Rollback steps
1. Hosting rollback via Firebase Hosting releases
2. Functions rollback to last stable tag:
```bash
git checkout <LAST_STABLE_TAG>
firebase deploy --only functions:ccfaceoff --project thc-caption-crew-2026
```
3. Restore known-good `admin-runtime/shared.json` values via Admin save

---

## 7) Monitoring during change

Watch:
- Functions logs: `analyzeTranscriptOhm`, `transcribeRoundAudio`, `evaluateCaptionCrewMeaning`
- Hosting release status
- Browser console on `/admin`

Look for:
- `Router9 error (...)`
- `ROUTER9_API_KEY not configured`
- `No Router9 model configured`
- `AI response did not contain a JSON object`

---

## 8) Communication templates

### Pre-change
**Subject:** Planned change — THC Caption Crew 2026 — `<date/time>`

Scope: deploy functions/hosting + OHM Router9 single-engine update.  
Risk: Medium.  
Rollback: Hosting rollback + functions redeploy from stable tag.

### Post-change
**Subject:** Change complete — THC Caption Crew 2026

Result: `<success/partial/rollback>`  
Deployed tag: `<tag>`  
Production URL: https://thc-caption-crew-2026.web.app

---

## 9) Post-change write-back (2026-04-21)

- Migrated OHM to **single Router9 engine**.
- Added dedicated OHM model settings:
  - `ohmModel`
  - `ohmFallbackModel`
- Added dynamic OHM config fields:
  - `ohmWeights`
  - `ohmLengthConstraints`
  - `ohmLengthCoefficients`
- Enforced coefficient set: `1, 1.5, 2, 2.5` with `overLong=2.5`.
- Kept response schema backward-compatible.

### Deployment evidence (2026-04-21 GMT+7)
- Release commit: `3ff7ea7`
- Release tag: `prod-2026-04-21-ohm-router9-v2`
- Functions deployed (explicit list) to avoid legacy deletion conflict:
  - `getDeepgramAccessToken`
  - `transcribeRoundAudio`
  - `analyzeTranscriptOhm`
  - `fetchGoogleSttModels`
  - `testGoogleSttModels`
  - `fetchRouterModels`
  - `testRouterCompletion`
  - `evaluateCaptionCrewMeaning`
- Hosting deployed: `https://thc-caption-crew-2026.web.app`

---

## Go / No-Go checklist

- [ ] Owner + reviewer online
- [ ] Build/syntax checks pass
- [ ] Commit + tag pushed
- [ ] Runtime config snapshot taken
- [ ] Smoke tests passed
- [ ] Monitoring window completed

---

## Quick command appendix

```bash
# Build + checks
npm run build
cd functions && node --check src/index.js && cd ..

# Deploy functions
firebase deploy --only functions:ccfaceoff --project thc-caption-crew-2026

# Deploy hosting
firebase deploy --only hosting --project thc-caption-crew-2026
```

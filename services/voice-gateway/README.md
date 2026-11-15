# Voice gateway — Super Kirana voice entry

The shop owner holds the mic and says **one** entry; this service turns it into a **draft** khata entry.
It never writes to the khata — the app shows a confirm card and saves with its existing logic.

```
Phone (PWA) ── audio (webm/ogg opus, mp4, wav ≤ 300 KB, ≤ 10 s) + Supabase user JWT ──▶ Cloud Run  asia-south1
                                                                                         │
   1. verify JWT (Supabase JWKS, ES256, cached)            user id comes ONLY from the token
   2. audio checks: size, real duration, silence ─────────▶ refused here, Sarvam is never paid for it
   3. shop context (memory, 10 min) ── miss ──▶ Supabase RPC svc_voice_context(user, shop)
         re-checks membership; returns customer ids+names (recent first) and item names only
   4. per-shop rate limit 20/min, 500/day
   5. Sarvam STT saaras:v4 + ≤50 keyterms ── error ──▶ one retry saaras:v3 mode=codemix   (6 s timeout, keep-alive)
   6. deterministic parser (< 10 ms): amount · action · fuzzy customer (top 3) · items
   7. JSON draft ◀───────────────────────────────────────────────────────────────────────────┘
```

| Route | Auth | What |
|---|---|---|
| `GET /healthz` | none (optional user token) | Warm-up, never calls Sarvam STT: opens the Sarvam connection, loads token keys, and with the user's token (+ optional `?shop_id=`) pre-loads that shop's customers and keyterms. Call it when the khata screen opens. |
| `POST /v1/voice-entry` | `Authorization: Bearer <Supabase access token>` | multipart field `audio` (+ optional `shop_id` if the user has several shops) |
| `POST /v1/cache/invalidate` | `x-gateway-token: <GATEWAY_TOKEN>` **or** the member's own JWT | body `{ "shop_id": "…" }` — refresh after adding a customer. Unknown names also trigger one automatic refresh if the cache is older than 1 minute. |
| `GET /try` | demo code | Phone test page (demo shop only). Set `TRY_PAGE=0` to remove it. |

### Response (200)

```json
{
  "transcript": "रमेश पाटील २५० रुपये साखर घेतले",
  "customer": { "id": "…", "name": "Ramesh Patil", "confidence": 1, "needs_choice": false,
                "alternatives": [{ "id": "…", "name": "Ramesh Patil", "score": 1 }] },
  "amount": 250, "items": ["sakhar"], "type": "credit",
  "overall_confidence": 0.993, "needs_confirmation": true, "missing": [],
  "model": "saaras:v4",
  "timings_ms": { "checks": 2, "context": 0, "stt": 900, "parse": 0.4, "total": 905 },
  "request_id": "…"
}
```
`customer.id` is `null` when the best match is below 0.80 or less than 0.08 ahead of the second — then show
`alternatives` as chips. `type`: `credit` (udhaar: ghetle, nele, udhaar, baki) or `payment` (dile, jama, bharle).

### Errors — always the real cause, in English and Marathi, plus `request_id`

```json
{ "error": { "code": "AUDIO_TOO_LONG", "message": "Audio too long (12s > 10s)",
             "message_mr": "आवाज खूप लांब आहे (12 सेकंद > 10 सेकंद). एका वेळी एकच नोंद बोला.", "detail": null },
  "request_id": "…" }
```
Codes: `NO_AUTH` `BAD_TOKEN` 401 · `FORBIDDEN` 403 · `SHOP_REQUIRED` `BAD_SHOP_ID` `NO_AUDIO` `AUDIO_TOO_SHORT` `AUDIO_SILENT` 400 ·
`AUDIO_TOO_LARGE` `AUDIO_TOO_LONG` 413 · `AUDIO_FORMAT` 415 · `RATE_LIMIT_MINUTE` `RATE_LIMIT_DAY` 429 ·
`CONTEXT_FAILED` `SARVAM_ERROR` `SARVAM_AUTH` `SARVAM_LIMIT` 502 · `SARVAM_TIMEOUT` 504 · `NOT_CONFIGURED` 503.
5xx errors are logged with their stack in Error Reporting format → they show up in **Cloud Console → Error Reporting**
automatically. Every request writes one JSON log line: request_id, shop_id, duration, timings, transcript, parse
result. Never logged: audio, tokens, keys, phone numbers (masked if spoken).

## Parser (src/parser) — no AI on the hot path

1. Normalise: NFC, ०-९ → 0-9, lower-case, punctuation/hyphens → spaces, fillers removed.
2. Devanagari → Latin with a small table (inherent vowel kept inside words, dropped at the end) so
   "रमेश पाटील" and "Ramesh Patil" compare.
3. Amount: digits, or words — Marathi 1-99 (Devanagari and Latin), Hindi 1-99, English; she/shambhar/sau
   = 100, hajar = 1000, lakh; did/dide 1.5, adich 2.5, saade +½, paune −¼, sava +¼
   ("सव्वा दोन हजार" = 2,250; alone "sava she" = 125). *Note:* the brief said "sava ×1.25"; that is only
   right for sava alone — "sava don" means 2¼, so it is implemented as +¼.
4. Action words → `credit` / `payment` (config).
5. Customer = words before the amount, honorifics (tai, bhau, kaka, sheth…) ignored, Jaro-Winkler on a
   phonetic key (v/w, sh/s, aa/a, ee/i, aspirates, doubled letters, final schwa). Top 3 returned.
6. Items = dictionary words (Marathi/Hindi/English synonyms, inflections like "साखरेचे") + the shop's own
   product names for other words after the amount.

**Add words without code:** edit `config/lexicon.json` (`actions`, `fillers`, `amount_markers`,
`honorifics`, `items`) and push — the workflow tests and redeploys.

## Settings

See `.env.example`. On Cloud Run: `SARVAM_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GATEWAY_TOKEN` come from
Secret Manager; `SUPABASE_URL`, `ALLOWED_ORIGINS`, `SUPABASE_PUBLISHABLE_KEY` (public) are env vars.
Cloud Run: min 0 (set the GitHub variable `VOICE_MIN_INSTANCES=1` to remove cold starts; ≈ ₹400–700/month) / max 2 instances, concurrency 40, 1 vCPU, 256 MiB, 15 s timeout, CPU only during requests,
startup CPU boost, gen1. The service-role key is used for exactly one call: `svc_voice_context` (read-only).

## Deploy

One-time (you): in Google Cloud Console create/choose a project and **link a billing account**, then in
Cloud Shell run `bash setup-gcp.sh <PROJECT_ID>` and add the two GitHub secrets it prints
(`GCP_PROJECT_ID`, `GCP_WIF_PROVIDER`). After that every push to `services/voice-gateway/**` runs:
typecheck → 187 tests → parse benchmark → bundle → Docker (distroless) → Artifact Registry → Cloud Run →
smoke check, and posts the URL as the commit status `voice-gateway`. Secrets are copied from Supabase
(Vault `sarvam_api_key`, project service key) into Secret Manager without ever being printed.

Budget alert (₹100/month, emails at 50/90/100 %; a budget alerts, it does not stop spending):
```bash
gcloud billing accounts list                              # copy your ACCOUNT_ID (currency must be INR)
gcloud billing budgets create --billing-account=ACCOUNT_ID --display-name="voice-gateway ₹100" \
  --budget-amount=100INR --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 \
  --filter-projects=projects/PROJECT_ID
```

## Tests and benchmarks

```bash
npm test               # 120 realistic transcripts + 45 amount rules + 8 parser/number behaviour + 14 HTTP tests (Sarvam/Supabase mocked)
SARVAM_LIVE=1 SARVAM_API_KEY=… npm test     # + one real Sarvam call (≈ ₹0.03)
npm run bench:parse    # parser p50/p95 with 2,000 customers
GATEWAY_URL=https://… USER_JWT=… CLIPS=./my-clips npm run bench    # 20 real clips → server p50/p95, STT separately
```
Measured here: parser p50 3.0 ms / p95 5.6 ms with 2,000+ customers (well under 1 ms for a normal shop);
the bundled server is ready ~200 ms after the process starts.

## Cost

| Item | Free allowance | This service | Cost |
|---|---|---|---|
| **Sarvam STT** (only paid part) | — | ₹30 per audio hour, per second | **≈ ₹25–35 per 1,000 entries** (3–4 s each). A v4 failure + v3 retry bills that clip twice (rare). |
| Cloud Run requests | 2 M/month | 1 per entry (+ warm-ups) | ₹0 |
| Cloud Run CPU | 180,000 vCPU-s | ≤ ~1.2 vCPU-s per entry (CPU only while a request runs) | ₹0 up to ≈ 150,000 entries/month (~5,000/day) |
| Cloud Run memory | 360,000 GiB-s | 0.25 GiB × ~1.2 s | ₹0 up to ≈ 1.2 M entries |
| Internet egress | 1 GiB/month free only inside North America | ~40 KB audio to Sarvam + 1 KB reply per entry | ≈ ₹0.4 per 1,000 entries (paid from the first byte, tiny) |
| Secret Manager | 6 active versions, 10,000 reads/month | 3 secrets, 1 version each; 3 reads per cold start | ₹0 below ~3,300 cold starts/month; then ≈ ₹2.5 per 10,000 reads |
| Artifact Registry | 0.5 GB | 2 images kept (~50 MB each) | ₹0 |
| Logging / Error Reporting | 50 GiB/month | ~1 KB per entry | ₹0 |
| Builds | — | GitHub Actions (free for public repos), not Cloud Build | ₹0 |

**Region:** `asia-south1` (Mumbai) is a **Tier 1** Cloud Run region and the free tier is computed at Tier 1
prices, so Mumbai uses the free tier at exactly the same rate as `us-central1` (0 % faster) while being far
closer to your shops, Supabase (Mumbai) and Sarvam (India).

**Sarvam credit balance:** in the Sarvam dashboard (dashboard.sarvam.ai), under your account's billing /
credits section. When credits run out the service answers `SARVAM_LIMIT` with the reason — no silent failures.

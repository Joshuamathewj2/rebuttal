# Rebuttal

**AI dispute defense for small PayPal sellers.** Rebuttal reads each PayPal dispute, pulls the evidence out of the seller's own order records, estimates the chance of winning, compares fighting with settling in dollars, drafts a response where every claim is checked against an exhibit, and sends the whole thing to PayPal through the Disputes API after one click of approval.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Oct-Nov 2026).

---

## The problem

Disputes are a tax that falls hardest on small sellers.

- Industry estimates put the cost of a chargeback at around $74 once fees and handling are counted, and merchants often lose most of the disputes they contest. Published win rates for fraud-type chargebacks are as low as 17% ([chargeback.io statistics roundup](https://www.chargeback.io/blog/chargeback-statistics); vendor figures vary widely).
- Many of those losses aren't because the seller was wrong. They come from **missed deadlines, tracking that was never shared with PayPal, or evidence that didn't match what the reason code needs**. In our demo merchant's history, those three causes account for every lost dollar.
- A one-person shop doesn't know that a $1,200 order shipped without signature confirmation is outside PayPal Seller Protection, or that a "not as described" claim is decided on the listing and photos rather than tracking. They find out when they lose.
- Handling one dispute properly (find the order, screenshot tracking, dig up emails, write a response, upload files) takes an hour or more. For a $40 order, most sellers simply refund, and friendly fraud learns that it works.

## What exists today, and where it falls short

| Approach | What's wrong with it for a small PayPal seller |
|---|---|
| **Chargeback outsourcing** (Chargeflow, Justt, Chargebacks911, etc.) | Priced as a share of what they recover (Chargeflow is [reported at ~25% per recovered chargeback](https://chargeback.io/blog/best-chargeflow-alternatives)), or by contract. Other providers don't publish pricing; one competitor's comparison reports [a ~$1,000/month quote with a 12-month contract](https://chargeback.io/blog/best-chargeflow-alternatives). Built around card-network chargebacks on Stripe and Shopify, not PayPal's own inquiry stage where cases are cheapest to resolve. A black box: the seller learns nothing and changes nothing. |
| **Template generators / "AI writes your response"** | Generic letters that are not matched to the reason code. LLM-written letters can state things the seller can't prove, and a fabricated claim in a dispute response is a liability for the seller. |
| **Doing it by hand in the Resolution Center** | Slow, easy to miss the deadline, and no feedback on whether fighting is even worth it. |

None of these answers the seller's actual question: **"Should I fight this one, and if so, what exactly do I send?"**

## What Rebuttal does differently

1. **Decides, not just drafts.** Every dispute gets an expected-value comparison: fight, partial refund, refund on return, or accept. The math is shown (`34% x $1,240 recovered - 66% x $15 fee if lost - 4 min of your time`). A chipped mug in a two-mug order gets a $28 partial-refund offer, not a doomed fight.
2. **Explainable win estimate, calibrated to you.** The estimate starts from the seller's own won/lost history for that reason (Beta-Binomial prior) and every PayPal Seller Protection check moves it by a visible amount: tracking exists, delivered, delivered to the transaction address, shipped within 7 days, signature for orders of $750+, written admission of receipt, and so on.
3. **Grounded drafting.** Claude writes the response as sentences that each cite exhibits (`E1`, `E2`...). Before anything is sent, a grounding guard checks every date, amount, ID and quotation against the exhibits the sentence cites. A claim that isn't in the evidence blocks submission, even if the seller typed it in by hand. Quotes of the buyer's own messages are verified verbatim, so the model can't invent an admission.
4. **Does the work in PayPal.** On approval it calls the PayPal APIs directly: `provide-evidence` with structured evidence (tracking info, refund IDs) plus a generated PDF exhibit packet, `make-offer`, `accept-claim`, and `send-message` to the buyer.
5. **Prevents the next one.** It finds shipped orders whose tracking PayPal never received and pushes them through the Tracking API (`trackers-batch`), and flags high-value orders shipped without signature confirmation before a buyer complains.
6. **Triage by urgency.** The queue is ordered by money at stake against time left, and anything due within 24 hours goes to the top, because a missed deadline is an automatic loss.

## Demo

- Video: _see the Devpost submission_
- Run it locally in about a minute (below). No keys are needed: it starts in mock mode with a fictional ceramics shop and six realistic disputes, and the AI steps fall back to a deterministic rules engine.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Joshuamathewj2/rebuttal.git
cd rebuttal
npm install
npm start            # http://localhost:3000
npm test             # 8 tests: grounding, calibration, PayPal payloads
```

### Turn on Claude

```bash
cp .env.example .env
# set ANTHROPIC_API_KEY=...
npm start
```

The header shows `AI claude-opus-5-5` when it's active. Signal extraction and drafting then run on Claude; the rules engine stays as a fallback if a call fails.

### Connect a PayPal sandbox account

1. In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox), create a sandbox app and copy its client ID and secret into `.env`, with `PAYPAL_MODE=sandbox`.
2. Make a purchase from a sandbox personal account to your sandbox business account, then open a dispute from the personal account at `sandbox.paypal.com` (Resolution Center).
3. Add the order record for that transaction (`POST /api/orders`, same shape as `src/data/seed.js`). In a real deployment this comes from the store platform.
4. Rebuttal lists the dispute through `GET /v1/customer/disputes`. Approving a plan calls the real sandbox endpoints. The sandbox-only `adjudicate` endpoint is exposed at `POST /api/demo/:id/adjudicate` to settle a case for testing.

## How it works

```
PayPal Disputes API ──> dispute ─┐
                                 ├─> evidence.js   numbered exhibits from order records (E1..En)
Store order records ──> order  ──┘        │
                                          ├─> ai.js        Claude: buyer admissions, partial problem,
                                          │                disclosed traits (quotes verified verbatim)
                                          ├─> policy.js    Seller Protection checks + log-odds weights,
                                          │                prior calibrated on the seller's history
                                          ├─> economics.js EV of fight / partial offer / return / accept
                                          ├─> ai.js        Claude drafts cited response + buyer message
                                          ├─> grounding.js every date, amount, ID, quote checked vs exhibits
                                          └─> pipeline.js  seller approves ──> PayPal API calls + PDF packet
```

| File | Role |
|---|---|
| `src/paypal/client.js` | OAuth2 client-credentials, Disputes v1, Tracking v1, sandbox helpers |
| `src/paypal/mock.js` | Same interface in memory; validates enums and payloads so mock and sandbox send identical requests |
| `src/engine/evidence.js` | Builds exhibits from the order record and maps each to a PayPal `evidence_type` |
| `src/engine/policy.js` | Reason-specific checks, calibrated prior, win probability, Seller Protection status |
| `src/engine/economics.js` | Option comparison in dollars |
| `src/engine/ai.js` | Claude calls with JSON-schema structured output; rule-based fallback |
| `src/engine/grounding.js` | Citation and fact verification |
| `src/engine/packet.js` | PDF exhibit packet (pdfkit) |
| `src/engine/pipeline.js` | Orchestration, execution, prevention, audit trail |
| `public/` | Single-page UI, no build step |

### PayPal APIs used

- `POST /v1/oauth2/token`
- `GET /v1/customer/disputes`, `GET /v1/customer/disputes/{id}`
- `POST /v1/customer/disputes/{id}/provide-evidence` (multipart: JSON `input` + PDF file, with `tracking_info` / `refund_ids`)
- `POST /v1/customer/disputes/{id}/make-offer` (`REFUND`, `REFUND_WITH_RETURN`)
- `POST /v1/customer/disputes/{id}/accept-claim`
- `POST /v1/customer/disputes/{id}/send-message`
- `POST /v1/shipping/trackers-batch`
- Sandbox: `require-evidence`, `adjudicate`

### AI tools used

- **Claude Opus 5.5** (`claude-opus-5-5`, Anthropic API) does two jobs. It reads the buyer's dispute statement, the email history and the listing and returns structured signals (JSON schema output): written admissions of receipt, whether only part of the order is affected and by how much, and whether the complaint matches something the listing disclosed. It then drafts the response to PayPal as cited sentences plus a message to the buyer. Server-side refusal fallback is enabled.
- Model output is never trusted directly. Quotes must appear verbatim in a buyer message dated after delivery, and every drafted sentence must pass the grounding check before it can be sent.
- **Claude Code** was used as a coding assistant while building the project.

## Honest limitations

- The win estimate is a transparent heuristic model, not a trained classifier. Its weights are a starting point that the per-seller calibration adjusts; it should be validated on real outcome data.
- Seller Protection rules are simplified from PayPal's public policy and are not legal advice. Thresholds live in `src/engine/policy.js`.
- Order records come from a seed file or `POST /api/orders`. A production version would pull them from Shopify, WooCommerce or similar, and read carrier tracking directly.
- State is in memory. The demo has no authentication and is meant to run locally or as a single-tenant deployment.

## License

MIT, see [LICENSE](LICENSE).

## Re-recording the demo video

`scripts/video/` holds the narration text, a Windows TTS renderer, a Playwright recorder and an ffmpeg muxer, so the demo video is reproducible from the code: `tts.ps1` -> `record.mjs` (needs `npm i playwright`) -> `mux.py` (needs `pip install imageio-ffmpeg`).

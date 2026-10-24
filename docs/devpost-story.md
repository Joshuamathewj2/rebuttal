## Inspiration

Small online sellers lose most of the disputes they contest. Often they aren't wrong. They missed the 10-day deadline, never shared the tracking number with PayPal, or uploaded evidence that doesn't fit the dispute reason. A one-person shop doesn't know that a $1,200 order shipped without signature confirmation is outside PayPal Seller Protection, or that a "not as described" case turns on the listing and photos rather than on tracking.

The tools that exist don't fit them. Chargeback outsourcing firms charge around a quarter of what they recover, or sell contracts, and are built around Stripe and Shopify card chargebacks. Generic "AI writes your dispute letter" tools produce letters that may state things the seller can't prove. None of them answers the question a seller actually has: **should I fight this one, and if so, what exactly do I send?**

## What it does

Rebuttal is an AI dispute co-pilot that works directly with the PayPal Disputes API.

- **Triage queue.** Pulls open disputes from PayPal, matches each one to the seller's order record, and ranks them by money at stake against time left. Anything due within 24 hours goes to the top.
- **Explainable win estimate.** Starts from the seller's own won/lost history for that dispute reason (a Beta-Binomial prior), then each Seller Protection check moves it by a visible amount: tracking exists, carrier confirms delivery, delivered to the address on the transaction, shipped within 7 days, signature for orders of $750+, the buyer acknowledged receipt in writing, and so on.
- **Decides, not just drafts.** Compares fighting, a partial refund, refund on return and accepting, in dollars, and recommends the best one. A chipped mug in a two-mug order gets a $28 partial-refund offer, not a doomed fight.
- **Grounded drafting.** Claude reads the buyer's statement, the email history and the listing, then writes the response to PayPal as sentences that each cite a numbered exhibit from the seller's records. A grounding guard checks every date, amount, tracking number and quote against the cited exhibits. If anything is unsupported, even text the seller typed in by hand, submission is blocked and the exact claim is highlighted.
- **One-click execution in PayPal.** `provide-evidence` with structured evidence (tracking info, refund IDs) and a generated PDF exhibit packet, `make-offer`, `accept-claim`, and `send-message` to the buyer.
- **Prevention.** Finds shipped orders whose tracking PayPal never received and pushes them through the Tracking API, and flags high-value orders shipped without signature confirmation before a buyer complains.

## How we built it

- **Node.js + Express** backend, vanilla JS front end with no build step.
- **PayPal REST APIs:** OAuth2 client credentials; Disputes v1 (list, show, provide-evidence as multipart with a JSON `input` part plus a PDF, make-offer, accept-claim, send-message, and the sandbox-only require-evidence and adjudicate); Tracking v1 (`trackers-batch`).
- A **mock PayPal** with the same interface validates every payload against the Disputes v1 enums (`evidence_type`, `offer_type`), so mock mode and sandbox mode send identical requests and judges can run the full flow with no keys.
- **Claude Opus 5.5** via the Anthropic SDK with JSON-schema structured output for two steps: signal extraction (written admissions, partial problems, disclosed traits) and cited drafting. Server-side refusal fallback is on, and a deterministic rules engine takes over when no key is configured or a call fails.
- **pdfkit** for the exhibit packet. **node:test** for tests covering grounding, calibration and the exact PayPal payloads sent.
- **Claude Code** was used as a coding assistant during the build.

## Challenges we ran into

- **Making AI safe to put in front of a payment processor.** A dispute response with an invented fact is worse than none. We split the work: deterministic code builds the exhibits and the checks, the model only reasons and writes, and a verifier checks every concrete token and quote against the exhibits the sentence cites. The verifier caught a bug in our own fallback templates (a sentence citing the wrong exhibit for an invoice number), which is exactly what it is for.
- **Encoding policy without pretending to be a lawyer.** Seller Protection rules are simplified into one file of explicit checks and thresholds, so a seller can see and change them.
- **Making the decision honest.** The tool says when a case is weak. The $1,240 vase shipped without a signature is shown at 34%, outside Seller Protection, with the reason.

## Accomplishments that we're proud of

- The full loop works end to end: from a PayPal dispute to a submitted, verified evidence packet in one approval.
- Every number on screen can be explained. The win estimate is a sum of visible factors, and the recommendation is a dollar comparison.
- The grounding guard makes the AI's output auditable, which is what makes it usable for something with money on the line.

## What we learned

The biggest wins for small sellers aren't better letters. They're deciding correctly which cases to fight and not losing on process: deadlines, tracking shared with PayPal, and evidence that fits the reason code.

## What's next for Rebuttal

- Pull order records directly from Shopify and WooCommerce, and tracking events from carriers.
- Learn the factor weights from real outcomes across sellers, with per-seller calibration on top.
- Auto-push tracking on every shipment and alert before deadlines, so most disputes never need a response at all.

## Try it

```
git clone https://github.com/Joshuamathewj2/rebuttal.git
cd rebuttal && npm install && npm start   # http://localhost:3000
```

Runs with no keys in mock mode. Add `ANTHROPIC_API_KEY` to turn on Claude, and PayPal sandbox credentials with `PAYPAL_MODE=sandbox` to use real sandbox disputes.

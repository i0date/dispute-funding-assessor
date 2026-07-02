# Dispute Funding Assessor

**[→ Live demo](https://dispute-funding-assessor.vercel.app)**

A portfolio scoring tool that treats open chargeback claims as a financial asset class — scoring each claim for fundability and generating a portfolio-level advance recommendation.

Built from five years of fraud and risk operations experience at Canadian fintechs and banks.

## What it does

Paste in (or load) a portfolio of open dispute claims. The tool returns:

- **Fundability score (0–100)** per claim — weighted composite of recovery probability, time value, and amount efficiency
- **Win-probability estimate** based on Visa reason code base rates adjusted for evidence quality signals
- **Filing window time-decay** — claims approaching the 120-day standard window are discounted; claims inside 30 days are penalized materially
- **Portfolio grade (A–D)** — value-weighted average fundability with a concentration risk penalty applied when any single claim exceeds 35% of portfolio face value
- **Recommended advance** — the amount a funder could reasonably deploy against the expected recovery, at a rate calibrated to portfolio grade

## Why this exists

Dispute portfolios are an undervalued asset class. A bank with 500 open chargeback cases has a predictable expected recovery — but that value is locked up for 45–90 days while the dispute process runs. Third-party funders (think: litigation finance applied to payment disputes) could advance capital against those expected recoveries today, in exchange for a share of what comes in.

The reason this market doesn't exist yet is the same reason mortgage-backed securities didn't exist before FICO scores: you can't price what you can't underwrite. Systematic win-probability scoring across dispute portfolios hasn't been possible at scale — until AI-native dispute automation platforms start generating structured, machine-readable outcome signals for every claim.

This tool is a proof of concept for the financial layer that sits on top of that infrastructure.

## Scoring model

**Recovery probability (55% weight)**

Starts from Visa reason code base win rates (issuer perspective):

| Code | Description | Base rate |
|------|-------------|-----------|
| 10.1 | EMV liability shift | 85% |
| 10.2 | No cardholder auth (card present) | 48% |
| 10.4 | CNP fraud — other | 76% |
| 10.5 | Visa fraud monitoring program | 93% |
| 13.1 | Merchandise not received | 41% |
| 13.3 | Not as described | 30% |
| 13.5 | Misrepresentation | 57% |
| 13.6 | Credit not processed | 68% |

Adjusted for evidence quality signals:

| Signal | Effect |
|--------|--------|
| AVS mismatch on shipping (10.x codes) | +7% |
| No 3DS authentication (10.x codes) | +5% |
| Delivery confirmation on file | −22% |
| Merchant acknowledgement of credit | +18% |
| PIN-verified transaction | −28% |
| VFMP enrolled merchant | capped to min(p + 15%, 96%) |
| Strong documentary evidence | +12% |
| Prior claims on account | −7% per claim |
| Merchant CBR > 1.0% | +3% |

**Time value (25% weight)**

Days remaining in the Visa filing window (120-day standard for most codes; fraud codes extend further in some jurisdictions):

| Remaining | Score |
|-----------|-------|
| > 90 days | 100% |
| > 60 days | 90% |
| > 30 days | 78% |
| > 15 days | 60% |
| ≤ 15 days | 35% |

**Amount efficiency (20% weight)**

Funder overhead is roughly fixed per claim. Sub-$100 claims rarely justify processing cost. Amounts over $2,000 introduce concentration risk.

| Amount | Score |
|--------|-------|
| < $50 | 15% |
| $50–$100 | 40% |
| $100–$200 | 65% |
| $200–$2,000 | 100% |
| $2,000–$5,000 | 85% |
| > $5,000 | 70% |

**Portfolio advance rates by grade**

| Grade | Score | Advance rate |
|-------|-------|--------------|
| A | ≥ 75 | 65% of expected recovery |
| B | 60–74 | 55% |
| C | 45–59 | 44% |
| D | < 45 | 30% |

Concentration penalty: −4 points from portfolio score if the largest single claim exceeds 35% of total portfolio face value.

## Tech

- React 18
- Vite
- Tailwind CSS
- lucide-react icons

## Running locally

```bash
npm install
npm run dev
```

## Deploying to Vercel

```bash
npm run build
# then connect the repo to Vercel — zero config needed
```

## Relationship to Dispute Desk

[Dispute Desk](https://github.com/i0date/Dispute-Desk) operates downstream — it takes a raw customer complaint and produces a compliant Visa dispute summary ready for filing. This tool operates at the portfolio level, after claims have been filed, asking the question a funder (or a head of fraud operations) would ask: *across all these open claims, what is our expected recovery and what is that worth today?*

Together they cover two distinct layers of the dispute lifecycle: operational intake and financial portfolio valuation.

## About

Adeoti Fashokun. Fraud, risk, and compliance professional based in Toronto. Five years across Canadian fintechs and banks.

[LinkedIn](https://www.linkedin.com/in/adeoti-fashokun-284b66164/) · [Substack](https://adeoti.substack.com)

---

*Built July 2026. Open to feedback.*

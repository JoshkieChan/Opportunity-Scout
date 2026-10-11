# Scoring rules

Scoring is deterministic and implemented in `validator/scoring.py`. The response field `confidence` is retained as the API name for the 0–100 heuristic score. It is not a probability, financial advice, or an AI prediction.

## Input and extraction

Pydantic validates the product title, asking price, review count, description, and HTTP(S) URL before scoring. Source detection uses exact hostnames or subdomains of `flippa.com` and `gumroad.com`; other hosts receive the generic base score. The validator never fetches the URL.

Financial extraction searches the title and description for explicit monthly claims:

- `Monthly revenue: $1.97K`
- `$500 monthly sales`
- `Monthly profit: $300`
- `Profit: $200/mo` or `Revenue: $900/month`

Comma-separated amounts, decimals, and K/M suffixes are supported. Annual and ambiguous periods are not converted to monthly values. Missing or unsupported values produce zero; this means no usable evidence was extracted, not that the business has zero revenue. Conflicting claims are not reconciled; the first positive match in the supported format order is used.

## Rejection rules

A product is rejected with score zero when its price is below $100, its text identifies a filtered category (avatar, template, course, ebook, or 3D model), it lacks revenue/profit/sales wording, or it is a Gumroad listing with zero reviews.

## Score calculation

| Source | Base score and evidence bonuses |
| --- | --- |
| Flippa | 70; +20 for positive monthly revenue; +15 for positive monthly profit |
| Gumroad | 80; +10 for more than 10 reviews; +10 for positive monthly profit |
| Generic | 60 |

Keyword penalties: affiliate site −30, content site −30, authority site −20, easy to scale −10, starter −10. Prices below $200 receive an additional −40.

Keyword boosts: recurring revenue +15, white label +15, agency license +10, profit mentioned +10, SaaS +15, margins +10, conversion rate +10. Each phrase contributes once. These are text signals and do not verify the claims.

The result is clamped to 0–100. If no positive monthly revenue or profit was extracted, the score is capped at 70.

## Tiers and routing

- **A:** score at least 93 and either monthly revenue at least $500 or monthly profit at least $300.
- **B:** score at least 88 when A is not met.
- **C:** all other results; rejected.

The worker uses the validator's tier. With Discord enabled, A goes to the priority channel and B to the review channel. The top-three summary sorts approved results by score, then descending asking price. Dry-run mode prints tier/score decisions without sending Discord messages.

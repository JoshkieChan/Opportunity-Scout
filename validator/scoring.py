"""Deterministic heuristics; scores are not probabilities or verified financials."""
import re
from urllib.parse import urlsplit

from validator.models import Product, ValidationResult

AMOUNT = r"\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?[ \t]*[kKmM]?)(?![\w,]|\.\d)"


def detect_source(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    for source in ("flippa", "gumroad"):
        domain = source + ".com"
        if host == domain or host.endswith("." + domain):
            return source
    return "generic"


def parse_financial_value(text: str, pattern: str) -> float:
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return 0.0
    value = match.group(1).replace("$", "").replace(",", "").strip().lower()
    multiplier = 1_000 if value.endswith("k") else 1_000_000 if value.endswith("m") else 1
    try:
        result = float(value.rstrip("km").strip()) * multiplier
        return result if 0 <= result <= 1e12 else 0.0
    except ValueError:
        return 0.0


def extract_financials(product: Product) -> tuple[float, float]:
    # Require an explicit monthly period; never label annual/ambiguous claims monthly.
    text = product.title + "\n" + product.description
    values = []
    for metric in (r"(?:revenue|sales)", r"(?:profit|income|earnings)"):
        patterns = [
            rf"\bmonthly\s+{metric}\s*[:=]?\s*{AMOUNT}",
            rf"{AMOUNT}\s*(?:in\s+)?monthly\s+{metric}\b",
            rf"\b{metric}\s*[:=]?\s*{AMOUNT}\s*(?:/\s*(?:mo(?:nth)?))\b",
        ]
        values.append(next((v for p in patterns if (v := parse_financial_value(text, p)) > 0), 0.0))
    return values[0], values[1]


def analyze_resellability(product: Product) -> tuple[int, str | None]:
    text = (product.title + " " + product.description).lower()
    if product.price < 100:
        return 0, "Price below $100"
    for word in ("avatar", "template", "course", "ebook", "3d model"):
        if re.search(rf"\b{re.escape(word)}s?\b", text):
            return 0, f"Non-investable asset: {word}"
    if not re.search(r"\b(?:revenue|profit|sales)\b", text):
        return 0, "No revenue, profit or sales signal"
    if detect_source(str(product.url)) == "gumroad" and product.reviews == 0:
        return 0, "Gumroad listing has no review evidence"
    adjustments = {
        "affiliate site": -30, "content site": -30, "authority site": -20,
        "easy to scale": -10, "starter": -10, "recurring revenue": 15,
        "white label": 15, "agency license": 10, "profit mentioned": 10,
        "saas": 15, "margins": 10, "conversion rate": 10,
    }
    score = sum(value for word, value in adjustments.items() if word in text)
    return score - (40 if product.price < 200 else 0), None


def evaluate(product: Product) -> ValidationResult:
    source = detect_source(str(product.url))
    adjustment, reason = analyze_resellability(product)
    revenue, profit = extract_financials(product)
    if reason:
        confidence = 0
    else:
        base = {"flippa": 70 + 20 * (revenue > 0) + 15 * (profit > 0),
                "gumroad": 80 + 10 * (product.reviews > 10) + 10 * (profit > 0),
                "generic": 60}[source]
        confidence = max(0, min(100, base + adjustment))
        if revenue == 0 and profit == 0:
            confidence = min(confidence, 70)
    tier = "A" if confidence >= 93 and (revenue >= 500 or profit >= 300) else "B" if confidence >= 88 else "C"
    return ValidationResult(
        approved=tier != "C", confidence=confidence, tier=tier, source=source,
        monthly_revenue=revenue, monthly_profit=profit,
        reason=reason or ("Passed heuristic rules" if tier != "C" else "Score below approval threshold"),
    )

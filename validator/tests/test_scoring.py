import pytest

from validator.models import Product
from validator.scoring import AMOUNT, detect_source, evaluate, extract_financials, parse_financial_value


def product(**changes):
    return Product(**{
        "title": "Business", "price": 500, "reviews": 12,
        "description": "Monthly revenue: $500. Monthly profit: $300.",
        "url": "https://flippa.com/123", **changes,
    })


@pytest.mark.parametrize(("text", "expected"), [
    ("$1.97K", 1970), ("$1,234,567.89", 1234567.89), ("$2m", 2000000),
    ("$0", 0), ("$12,34", 0), ("none", 0), ("$1.2.3", 0),
])
def test_financial_value(text, expected):
    assert parse_financial_value(text, AMOUNT) == expected


@pytest.mark.parametrize(("description", "expected"), [
    ("Monthly revenue: $1.97K; monthly profit: $300", (1970, 300)),
    ("$500 monthly sales and $100 monthly earnings", (500, 100)),
    ("Revenue: $900/month. Profit: $200/mo", (900, 200)),
    ("Annual revenue: $12000. $1000 revenue", (0, 0)),
    ("Monthly revenue: -$500. Monthly profit: $-100", (0, 0)),
    ("Monthly revenue: $12,34", (0, 0)),
])
def test_monthly_extraction(description, expected):
    assert extract_financials(product(description=description)) == expected


@pytest.mark.parametrize(("url", "source"), [
    ("https://flippa.com/a", "flippa"), ("https://www.flippa.com/a", "flippa"),
    ("https://author.gumroad.com/l/a", "gumroad"),
    ("https://flippa.com.evil.example/a", "generic"),
    ("https://example.com/?q=gumroad.com", "generic"),
])
def test_source(url, source):
    assert detect_source(url) == source


@pytest.mark.parametrize("changes", [
    {"price": 99}, {"title": "SaaS course"}, {"description": "Great business"},
    {"url": "https://author.gumroad.com/l/a", "reviews": 0},
])
def test_hard_rejection(changes):
    result = evaluate(product(**changes))
    assert (result.approved, result.confidence, result.tier) == (False, 0, "C")


def test_a_requires_financial_threshold():
    assert evaluate(product()).tier == "A"
    below = evaluate(product(description="Monthly revenue: $499; monthly profit: $299"))
    assert below.confidence == 100
    assert below.tier == "B"


def test_tier_b_and_risk_penalty():
    result = evaluate(product(description="Monthly revenue: $100"))
    assert (result.tier, result.confidence) == ("B", 90)
    result = evaluate(product(description="Monthly revenue: $100; starter"))
    assert (result.tier, result.confidence, result.approved) == ("C", 80, False)


def test_low_price_penalty():
    assert evaluate(product(price=199)).confidence == 65
    assert evaluate(product(price=200)).confidence == 100


def test_no_metrics_caps_even_many_boosts():
    result = evaluate(product(description="SaaS recurring revenue white label margins conversion rate"))
    assert result.confidence == 70
    assert not result.approved


def test_gumroad_review_boundary():
    assert evaluate(product(url="https://gumroad.com/l/a", reviews=10,
                            description="Monthly revenue: $100")).confidence == 80
    assert evaluate(product(url="https://gumroad.com/l/a", reviews=11,
                            description="Monthly revenue: $100")).tier == "B"


def test_score_clamp():
    result = evaluate(product(description="SaaS monthly revenue: $1000; white label recurring revenue"))
    assert result.confidence == 100
    result = evaluate(product(price=100, description="sales affiliate site content site authority site starter"))
    assert result.confidence == 0

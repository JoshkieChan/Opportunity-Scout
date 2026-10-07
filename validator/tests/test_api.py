import pytest
from fastapi.testclient import TestClient

from validator.main import app

client = TestClient(app)
PAYLOAD = {
    "title": "Example SaaS", "price": 500, "reviews": 12,
    "description": "Monthly revenue: $1000", "url": "https://flippa.com/123",
}


def test_health_and_approval():
    assert client.get("/health").json() == {"status": "ok"}
    response = client.post("/validate", json=PAYLOAD)
    assert response.status_code == 200
    assert response.json()["tier"] == "A"
    assert response.json()["monthly_revenue"] == 1000


def test_rejection_has_same_contract():
    accepted = client.post("/validate", json=PAYLOAD).json()
    rejected = client.post("/validate", json={**PAYLOAD, "price": 50})
    assert rejected.status_code == 200
    assert rejected.json().keys() == accepted.keys()
    assert rejected.json()["approved"] is False


@pytest.mark.parametrize(("field", "value"), [
    ("title", ""), ("title", "  "), ("price", -1), ("price", 0), ("price", "500"),
    ("price", True), ("reviews", -1), ("reviews", 1.5), ("reviews", True),
    ("url", "not-a-url"), ("url", "file:///etc/passwd"),
    ("url", "https://user:password@flippa.com/a"), ("description", "a" * 50001),
    ("unexpected", "field"),
], ids=lambda value: str(value)[:40])
def test_invalid_input(field, value):
    assert client.post("/validate", json={**PAYLOAD, field: value}).status_code == 422


def test_missing_and_malformed_body():
    assert client.post("/validate", json={}).status_code == 422
    assert client.post("/validate", content="{", headers={"Content-Type": "application/json"}).status_code == 422


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_price(value):
    # Valid JSON cannot represent these values; reject strings as well.
    assert client.post("/validate", json={**PAYLOAD, "price": value}).status_code == 422


def test_raw_nan_rejected_without_server_error():
    import json

    body = json.dumps({**PAYLOAD, "price": float("nan")})
    assert client.post("/validate", content=body, headers={"Content-Type": "application/json"}).status_code == 422

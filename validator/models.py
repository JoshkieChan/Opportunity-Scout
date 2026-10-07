from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class Product(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=500)
    price: float = Field(gt=0, le=1e12, allow_inf_nan=False, strict=True)
    reviews: int = Field(ge=0, le=1_000_000_000, strict=True)
    description: str = Field(max_length=50_000)
    url: HttpUrl = Field(max_length=2048)

    @field_validator("url")
    @classmethod
    def no_credentials(cls, value: HttpUrl) -> HttpUrl:
        if value.username is not None or value.password is not None:
            raise ValueError("URL credentials are not supported")
        return value


class ValidationResult(BaseModel):
    approved: bool
    confidence: int = Field(ge=0, le=100)
    tier: Literal["A", "B", "C"]
    source: Literal["flippa", "gumroad", "generic"]
    monthly_revenue: float = Field(ge=0, allow_inf_nan=False)
    monthly_profit: float = Field(ge=0, allow_inf_nan=False)
    reason: str

"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class TransactionOut(BaseModel):
    id: int
    account_id: int
    date: date
    description: str
    normalized_payee: str
    amount: float
    running_balance: float | None
    category_id: str | None
    subcategory_id: str | None
    is_pending: bool

    model_config = {"from_attributes": True}


class TransactionUpdate(BaseModel):
    category_id: str
    subcategory_id: str | None = None
    create_vendor_rule: bool = True


class BulkCategorizeRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)
    category_id: str
    subcategory_id: str | None = None
    create_vendor_rule: bool = True


class BulkCategorizeResult(BaseModel):
    updated: int


class AccountOut(BaseModel):
    id: int
    name: str
    currency: str
    balance: float | None = None
    transaction_count: int = 0

    model_config = {"from_attributes": True}


class CategoryCreate(BaseModel):
    id: str = Field(..., pattern=r"^[a-z][a-z0-9_]*$")
    name: str
    parent_id: str | None = None
    type: Literal["inflow", "outflow"] = "outflow"
    keywords: list[str] = Field(default_factory=list)


class CategoryOut(BaseModel):
    id: str
    name: str
    type: str
    source: str
    parent_id: str | None = None
    subcategories: list[dict[str, str]] = Field(default_factory=list)


class CategoryUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)


class ImportResult(BaseModel):
    batch_id: int
    filename: str
    account_id: int
    rows_total: int
    rows_new: int
    rows_duplicate: int
    rows_categorized: int
    rows_uncategorized: int


class CategoryAdjustment(BaseModel):
    category_id: str
    subcategory_id: str | None = None
    mode: Literal["percent", "pad", "reduce"] = "percent"
    value: float = 0.0


class ProjectionScope(BaseModel):
    type: Literal["total", "category"] = "total"
    category_id: str | None = None
    subcategory_id: str | None = None


class ProjectionRequest(BaseModel):
    # Legacy fields (multi-slider API)
    income_delta: float = 0.0
    category_adjustments: list[CategoryAdjustment] = Field(default_factory=list)
    # Scope-based what-if sliders
    scope: ProjectionScope | None = None
    period: Literal["monthly", "quarterly", "yearly", "total"] = "monthly"
    slider_period: Literal["monthly", "quarterly", "yearly", "total"] | None = None
    stats_period: Literal["monthly", "quarterly", "yearly", "total"] | None = None
    increase_percent: float = Field(0.0, ge=0.0, le=100.0)
    decrease_percent: float = Field(0.0, ge=0.0, le=100.0)
    increase_dollars: float | None = Field(None, ge=0.0)
    decrease_dollars: float | None = Field(None, ge=0.0)
    dollar_mode: bool = False
    account_id: int | None = None
    months_forward: int = Field(default=12, ge=1, le=60)


class SimilarTransactionsOut(BaseModel):
    transaction: TransactionOut
    similar: list[TransactionOut]
    suggested_category: dict[str, str | None] | None = None

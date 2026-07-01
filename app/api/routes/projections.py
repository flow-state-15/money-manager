"""Projection / what-if endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas import ProjectionRequest
from app.services.projections import compute_projection

router = APIRouter(prefix="/projections", tags=["projections"])


def _resolve_scope(body: ProjectionRequest) -> str | dict:
    if body.scope is None or body.scope.type == "total":
        return "total"
    return {
        "category_id": body.scope.category_id or "",
        "subcategory_id": body.scope.subcategory_id,
    }


@router.post("")
def run_projection(body: ProjectionRequest, db: Session = Depends(get_db)):
    adjustments = [a.model_dump() for a in body.category_adjustments]
    return compute_projection(
        db,
        income_delta=body.income_delta,
        category_adjustments=adjustments,
        account_id=body.account_id,
        months_forward=body.months_forward,
        scope=_resolve_scope(body) if not adjustments else None,
        period=body.period,
        slider_period=body.slider_period,
        stats_period=body.stats_period,
        increase_percent=body.increase_percent,
        decrease_percent=body.decrease_percent,
        increase_dollars=body.increase_dollars,
        decrease_dollars=body.decrease_dollars,
        dollar_mode=body.dollar_mode,
    )

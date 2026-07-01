"""Analytics endpoints."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services.analytics import compute_summary, detect_recurring

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
def analytics_summary(
    period: str = Query("monthly", pattern="^(monthly|quarterly|yearly|total)$"),
    account_id: int | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
):
    return compute_summary(db, period, account_id, start_date, end_date)


@router.get("/recurring")
def analytics_recurring(
    account_id: int | None = Query(None),
    min_occurrences: int = Query(2, ge=2),
    db: Session = Depends(get_db),
):
    return detect_recurring(db, account_id, min_occurrences)


@router.get("/category-trend")
def analytics_category_trend(
    category_id: str = Query(...),
    subcategory_id: str | None = Query(None),
    period: str = Query("monthly", pattern="^(monthly|quarterly|yearly|total)$"),
    account_id: int | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
):
    from app.services.analytics import compute_category_trend

    return compute_category_trend(
        db,
        period=period,
        category_id=category_id,
        subcategory_id=subcategory_id,
        account_id=account_id,
        start_date=start_date,
        end_date=end_date,
    )

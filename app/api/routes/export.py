"""Export endpoints."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services.export_service import export_json

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/json")
def export_json_data(
    account_id: int | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: Session = Depends(get_db),
):
    data = export_json(db, account_id, start_date, end_date)
    return JSONResponse(content=data)

"""CSV import endpoints."""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas import ImportResult
from app.services.import_service import import_csv_content

router = APIRouter(prefix="/import", tags=["import"])


@router.post("", response_model=ImportResult)
async def import_csv(
    files: list[UploadFile] = File(...),
    account_id: int | None = Query(None),
    db: Session = Depends(get_db),
) -> ImportResult:
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    combined = {
        "batch_id": 0,
        "filename": "",
        "account_id": account_id or 0,
        "rows_total": 0,
        "rows_new": 0,
        "rows_duplicate": 0,
        "rows_categorized": 0,
        "rows_uncategorized": 0,
    }

    for upload in files:
        content = await upload.read()
        filename = upload.filename or "upload.csv"
        try:
            result = import_csv_content(db, content, filename, account_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        combined["batch_id"] = result["batch_id"]
        combined["filename"] = (
            f"{combined['filename']}, {filename}" if combined["filename"] else filename
        )
        combined["account_id"] = result["account_id"]
        combined["rows_total"] += result["rows_total"]
        combined["rows_new"] += result["rows_new"]
        combined["rows_duplicate"] += result["rows_duplicate"]
        combined["rows_categorized"] += result["rows_categorized"]
        combined["rows_uncategorized"] += result["rows_uncategorized"]

    return ImportResult(**combined)

"""Transaction endpoints."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Transaction
from app.schemas import (
    BulkCategorizeRequest,
    BulkCategorizeResult,
    SimilarTransactionsOut,
    TransactionOut,
    TransactionUpdate,
)
from app.services.import_service import (
    assign_category,
    bulk_assign_category,
    find_similar_transactions,
)

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _txn_to_out(txn: Transaction) -> TransactionOut:
    return TransactionOut.model_validate(txn)


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    account_id: int | None = Query(None),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    category_id: str | None = Query(None),
    subcategory_id: str | None = Query(None),
    uncategorized_only: bool = Query(False),
    payee: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[TransactionOut]:
    q = db.query(Transaction)
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    if start_date:
        q = q.filter(Transaction.date >= start_date)
    if end_date:
        q = q.filter(Transaction.date <= end_date)
    if category_id:
        q = q.filter(Transaction.category_id == category_id)
    if subcategory_id:
        q = q.filter(Transaction.subcategory_id == subcategory_id)
    if uncategorized_only:
        q = q.filter(Transaction.subcategory_id == "uncategorized")
    if payee:
        q = q.filter(Transaction.normalized_payee.ilike(f"%{payee.upper()}%"))

    txns = (
        q.order_by(Transaction.date.desc(), Transaction.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_txn_to_out(t) for t in txns]


@router.post("/bulk-categorize", response_model=BulkCategorizeResult)
def bulk_categorize_transactions(
    body: BulkCategorizeRequest,
    db: Session = Depends(get_db),
) -> BulkCategorizeResult:
    updated = bulk_assign_category(
        db,
        body.ids,
        body.category_id,
        body.subcategory_id,
        body.create_vendor_rule,
    )
    if updated == 0:
        raise HTTPException(status_code=404, detail="No matching transactions found")
    return BulkCategorizeResult(updated=updated)


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: int, db: Session = Depends(get_db)
) -> TransactionOut:
    txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return _txn_to_out(txn)


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int,
    body: TransactionUpdate,
    db: Session = Depends(get_db),
) -> TransactionOut:
    try:
        txn = assign_category(
            db,
            transaction_id,
            body.category_id,
            body.subcategory_id,
            body.create_vendor_rule,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return _txn_to_out(txn)


@router.get("/{transaction_id}/similar", response_model=SimilarTransactionsOut)
def similar_transactions(
    transaction_id: int,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
) -> SimilarTransactionsOut:
    txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    similar = find_similar_transactions(db, transaction_id, limit)

    suggested = None
    categorized = [
        s for s in similar if s.subcategory_id and s.subcategory_id != "uncategorized"
    ]
    if categorized:
        top = categorized[0]
        suggested = {
            "category_id": top.category_id,
            "subcategory_id": top.subcategory_id,
        }

    return SimilarTransactionsOut(
        transaction=_txn_to_out(txn),
        similar=[_txn_to_out(s) for s in similar],
        suggested_category=suggested,
    )

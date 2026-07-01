"""Account endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Account, Transaction
from app.schemas import AccountOut

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db)) -> list[AccountOut]:
    accounts = db.query(Account).all()
    result = []
    for acct in accounts:
        txns = db.query(Transaction).filter(Transaction.account_id == acct.id).all()
        balance = None
        if txns:
            latest = (
                db.query(Transaction)
                .filter(Transaction.account_id == acct.id)
                .order_by(Transaction.date.desc(), Transaction.id.desc())
                .first()
            )
            if latest and latest.running_balance is not None:
                balance = latest.running_balance
            else:
                balance = sum(t.amount for t in txns)
        result.append(
            AccountOut(
                id=acct.id,
                name=acct.name,
                currency=acct.currency,
                balance=round(balance, 2) if balance is not None else None,
                transaction_count=len(txns),
            )
        )
    return result

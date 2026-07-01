"""JSON export of categorized transactions and trends."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import Account, Transaction, VendorRule
from app.services.analytics import compute_summary, detect_recurring
from app.services.categorizer import get_registry


def export_json(
    db: Session,
    account_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    """Export categorized data + monthly trends as JSON-serializable dict."""
    registry = get_registry()

    q = db.query(Transaction)
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    if start_date:
        q = q.filter(Transaction.date >= start_date)
    if end_date:
        q = q.filter(Transaction.date <= end_date)
    txns = q.order_by(Transaction.date).all()

    accounts = db.query(Account).all()
    vendor_rules = [
        {
            "payee_pattern": r.payee_pattern,
            "category_id": r.category_id,
            "subcategory_id": r.subcategory_id,
        }
        for r in db.query(VendorRule).all()
    ]

    transactions = []
    for t in txns:
        transactions.append(
            {
                "id": t.id,
                "account_id": t.account_id,
                "date": t.date.isoformat(),
                "description": t.description,
                "normalized_payee": t.normalized_payee,
                "amount": t.amount,
                "running_balance": t.running_balance,
                "category_id": t.category_id,
                "subcategory_id": t.subcategory_id,
                "is_pending": t.is_pending,
            }
        )

    return {
        "export_version": 1,
        "categories": registry.list_all(),
        "accounts": [
            {"id": a.id, "name": a.name, "currency": a.currency} for a in accounts
        ],
        "vendor_rules": vendor_rules,
        "transactions": transactions,
        "trends": {
            "monthly": compute_summary(db, "monthly", account_id, start_date, end_date),
            "quarterly": compute_summary(
                db, "quarterly", account_id, start_date, end_date
            ),
            "yearly": compute_summary(db, "yearly", account_id, start_date, end_date),
            "total": compute_summary(db, "total", account_id, start_date, end_date),
        },
        "recurring": detect_recurring(db, account_id),
    }

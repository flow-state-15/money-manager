"""CSV import pipeline with deduplication and auto-categorization."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.config import DEFAULT_ACCOUNT_NAME
from app.db.models import Account, ImportBatch, Transaction, VendorRule
from app.parsers.bofa_csv import ParsedTransaction, parse_bofa_csv
from app.services.categorizer import get_registry


def get_or_create_default_account(db: Session) -> Account:
    account = db.query(Account).first()
    if account is None:
        account = Account(name=DEFAULT_ACCOUNT_NAME, currency="USD")
        db.add(account)
        db.commit()
        db.refresh(account)
    return account


def load_vendor_rules(db: Session) -> dict[str, tuple[str, str | None]]:
    """Map normalized payee pattern -> (category_id, subcategory_id)."""
    rules: dict[str, tuple[str, str | None]] = {}
    for rule in db.query(VendorRule).all():
        rules[rule.payee_pattern.upper()] = (rule.category_id, rule.subcategory_id)
    return rules


def import_csv_content(
    db: Session,
    content: str | bytes,
    filename: str,
    account_id: int | None = None,
) -> dict:
    """
    Import bank statement CSV content. Deduplicates on dedupe_hash.
    Returns import statistics.
    """
    parsed = parse_bofa_csv(content)
    if account_id is None:
        account = get_or_create_default_account(db)
        account_id = account.id
    else:
        account = db.query(Account).filter(Account.id == account_id).first()
        if account is None:
            raise ValueError(f"Account {account_id} not found")

    registry = get_registry()
    vendor_rules = load_vendor_rules(db)

    batch = ImportBatch(filename=filename, rows_total=len(parsed))
    db.add(batch)
    db.flush()

    existing_hashes = {
        row[0]
        for row in db.query(Transaction.dedupe_hash)
        .filter(Transaction.account_id == account_id)
        .all()
    }

    rows_new = 0
    rows_duplicate = 0
    categorized = 0
    uncategorized = 0

    for txn in parsed:
        if txn.dedupe_hash in existing_hashes:
            rows_duplicate += 1
            continue

        match = registry.categorize(txn.description, txn.normalized_payee, vendor_rules)

        if match.source == "uncategorized":
            uncategorized += 1
        else:
            categorized += 1

        db_txn = Transaction(
            account_id=account_id,
            date=txn.date,
            description=txn.description,
            normalized_payee=txn.normalized_payee,
            amount=txn.amount,
            running_balance=txn.running_balance,
            category_id=match.category_id,
            subcategory_id=match.subcategory_id,
            is_pending=txn.is_pending,
            dedupe_hash=txn.dedupe_hash,
            import_batch_id=batch.id,
        )
        db.add(db_txn)
        existing_hashes.add(txn.dedupe_hash)
        rows_new += 1

    batch.rows_new = rows_new
    batch.rows_duplicate = rows_duplicate
    db.commit()

    return {
        "batch_id": batch.id,
        "filename": filename,
        "account_id": account_id,
        "rows_total": len(parsed),
        "rows_new": rows_new,
        "rows_duplicate": rows_duplicate,
        "rows_categorized": categorized,
        "rows_uncategorized": uncategorized,
    }


def assign_category(
    db: Session,
    transaction_id: int,
    category_id: str,
    subcategory_id: str | None,
    create_vendor_rule: bool = True,
) -> Transaction:
    """Assign category to transaction; optionally create vendor rule."""
    txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if txn is None:
        raise ValueError(f"Transaction {transaction_id} not found")

    txn.category_id = category_id
    txn.subcategory_id = subcategory_id

    if create_vendor_rule and txn.normalized_payee:
        pattern = txn.normalized_payee.upper()
        existing = (
            db.query(VendorRule).filter(VendorRule.payee_pattern == pattern).first()
        )
        if existing:
            existing.category_id = category_id
            existing.subcategory_id = subcategory_id
        else:
            db.add(
                VendorRule(
                    payee_pattern=pattern,
                    category_id=category_id,
                    subcategory_id=subcategory_id,
                )
            )

    db.commit()
    db.refresh(txn)
    return txn


def bulk_assign_category(
    db: Session,
    transaction_ids: list[int],
    category_id: str,
    subcategory_id: str | None,
    create_vendor_rule: bool = True,
) -> int:
    """Assign category to multiple transactions; one vendor rule from first payee."""
    if not transaction_ids:
        return 0

    txns = (
        db.query(Transaction)
        .filter(Transaction.id.in_(transaction_ids))
        .order_by(Transaction.date, Transaction.id)
        .all()
    )
    if not txns:
        return 0

    payee_pattern: str | None = None
    for txn in txns:
        txn.category_id = category_id
        txn.subcategory_id = subcategory_id
        if payee_pattern is None and txn.normalized_payee:
            payee_pattern = txn.normalized_payee.upper()

    if create_vendor_rule and payee_pattern:
        existing = (
            db.query(VendorRule).filter(VendorRule.payee_pattern == payee_pattern).first()
        )
        if existing:
            existing.category_id = category_id
            existing.subcategory_id = subcategory_id
        else:
            db.add(
                VendorRule(
                    payee_pattern=payee_pattern,
                    category_id=category_id,
                    subcategory_id=subcategory_id,
                )
            )

    db.commit()
    return len(txns)


def find_similar_transactions(
    db: Session, transaction_id: int, limit: int = 10
) -> list[Transaction]:
    """Return siblings with same normalized payee."""
    txn = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if txn is None:
        return []

    return (
        db.query(Transaction)
        .filter(
            Transaction.normalized_payee == txn.normalized_payee,
            Transaction.id != transaction_id,
        )
        .order_by(Transaction.date.desc())
        .limit(limit)
        .all()
    )

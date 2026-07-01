"""Analytics period averages and bulk categorize."""

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.parsers.bofa_csv import compute_dedupe_hash
from app.db.models import Account, Base, Transaction
from app.services.analytics import compute_category_trend, compute_summary
from app.services.import_service import bulk_assign_category


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    acc = Account(name="Test", currency="USD")
    session.add(acc)
    session.commit()
    yield session
    session.close()


def _add_txn(db, acc_id, d, amount, payee, balance=None, cat=None, sub=None):
    txn = Transaction(
        account_id=acc_id,
        date=d,
        description=payee,
        normalized_payee=payee,
        amount=amount,
        running_balance=balance,
        category_id=cat,
        subcategory_id=sub or "uncategorized",
        is_pending=False,
        dedupe_hash=compute_dedupe_hash(d, payee, amount, balance),
    )
    db.add(txn)
    db.commit()
    return txn


def test_period_ending_balance_and_monthly_average(db):
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 15), -100, "A", balance=900)
    _add_txn(db, acc_id, date(2024, 1, 31), 500, "B", balance=1400)
    _add_txn(db, acc_id, date(2024, 2, 10), -50, "C", balance=1350)

    summary = compute_summary(db, period="monthly", account_id=acc_id)
    assert len(summary["periods"]) == 2

    jan, feb = summary["periods"]
    assert jan["key"] == "2024-01"
    assert jan["inflow"] == 500
    assert jan["outflow"] == 100
    assert jan["ending_balance"] == 1400

    assert feb["key"] == "2024-02"
    assert feb["ending_balance"] == 1350

    avg_inflow = sum(p["inflow"] for p in summary["periods"]) / len(summary["periods"])
    assert avg_inflow == 250


def test_category_totals_period_averages(db):
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 10), -100, "A", cat="dining", sub="coffee")
    _add_txn(db, acc_id, date(2024, 2, 10), -50, "B", cat="dining", sub="coffee")
    _add_txn(db, acc_id, date(2024, 1, 15), 860, "Pay", cat="income", sub="benefits")

    monthly = compute_summary(db, period="monthly", account_id=acc_id)
    assert monthly["category_totals"]["dining/coffee"] == -75.0
    assert monthly["category_totals"]["income/benefits"] == 430.0

    yearly = compute_summary(db, period="yearly", account_id=acc_id)
    assert yearly["category_totals"]["dining/coffee"] == -150.0

    total = compute_summary(db, period="total", account_id=acc_id)
    assert total["category_totals"]["dining/coffee"] == -150.0
    assert total["category_totals"]["income/benefits"] == 860.0
    assert total["totals"]["inflow"] == 860.0


def test_total_period_sums_exceed_yearly_average(db):
    """Total view sums all-time flows; yearly view averages per calendar year."""
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2023, 1, 10), 1200, "Pay23", cat="income", sub="benefits")
    _add_txn(db, acc_id, date(2023, 2, 10), 1200, "Pay23b", cat="income", sub="benefits")
    _add_txn(db, acc_id, date(2024, 1, 10), 1200, "Pay24", cat="income", sub="benefits")
    _add_txn(db, acc_id, date(2024, 2, 10), 1200, "Pay24b", cat="income", sub="benefits")

    yearly = compute_summary(db, period="yearly", account_id=acc_id)
    total = compute_summary(db, period="total", account_id=acc_id)

    yearly_income_avg = sum(p["inflow"] for p in yearly["periods"]) / len(yearly["periods"])
    assert yearly_income_avg == 2400.0
    assert total["totals"]["inflow"] == 4800.0
    assert total["totals"]["inflow"] > yearly_income_avg
    assert total["category_totals"]["income/benefits"] == 4800.0


def test_category_trend_total_uses_monthly_buckets(db):
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 10), 500, "A", cat="income", balance=500)
    _add_txn(db, acc_id, date(2024, 2, 10), 300, "B", cat="income", balance=800)

    trend = compute_category_trend(db, "total", "income", account_id=acc_id)
    assert len(trend["periods"]) == 2
    assert sum(p["inflow"] for p in trend["periods"]) == 800.0
    assert all("ending_balance" not in p for p in trend["periods"])

    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 10), -40, "A", cat="personal", sub="uncategorized")
    _add_txn(db, acc_id, date(2024, 2, 10), -20, "B", cat=None, sub="uncategorized")

    monthly = compute_summary(db, period="monthly", account_id=acc_id)
    # Frontend rolls all */uncategorized keys into the virtual Uncategorized card.
    assert monthly["category_totals"]["personal/uncategorized"] == -20.0
    assert monthly["category_totals"]["uncategorized/uncategorized"] == -10.0


def test_bulk_assign_category(db):
    acc_id = db.query(Account).first().id
    t1 = _add_txn(db, acc_id, date(2024, 3, 1), -10, "STARBUCKS")
    t2 = _add_txn(db, acc_id, date(2024, 3, 5), -12, "STARBUCKS")
    t3 = _add_txn(db, acc_id, date(2024, 3, 6), -8, "OTHER")

    updated = bulk_assign_category(
        db, [t1.id, t2.id], "dining", "coffee", create_vendor_rule=True
    )
    assert updated == 2

    db.refresh(t1)
    db.refresh(t2)
    db.refresh(t3)
    assert t1.category_id == "dining"
    assert t2.category_id == "dining"
    assert t3.category_id is None

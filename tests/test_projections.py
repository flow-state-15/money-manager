"""Projection net slider math and category trend."""

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.parsers.bofa_csv import compute_dedupe_hash
from app.db.models import Account, Base, Transaction
from app.services.analytics import compute_category_trend, compute_scope_averages
from app.services.projections import compute_scope_projection


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


def test_category_trend_period_buckets(db):
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 10), -100, "A", cat="dining")
    _add_txn(db, acc_id, date(2024, 2, 10), -50, "B", cat="dining")

    trend = compute_category_trend(db, "monthly", "dining", account_id=acc_id)
    assert len(trend["periods"]) == 2
    assert trend["periods"][0]["outflow"] == 100
    assert trend["periods"][1]["outflow"] == 50


def test_total_scope_independent_sliders(db):
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 15), 1000, "Pay", balance=1000, cat="income")
    _add_txn(db, acc_id, date(2024, 1, 20), -400, "Spend", balance=600, cat="dining")

    result = compute_scope_projection(
        db,
        scope="total",
        period="monthly",
        increase_percent=20,
        decrease_percent=10,
        account_id=acc_id,
    )
    baseline = result["baseline"]
    projected = result["projected"]

    expected_income = baseline["income"] * 1.2
    expected_burn = baseline["burn"] * 0.9
    assert projected["income"] == pytest.approx(expected_income, rel=0.01)
    assert projected["burn"] == pytest.approx(expected_burn, rel=0.01)
    assert projected["net"] == pytest.approx(expected_income - expected_burn, rel=0.01)


def test_category_scope_net_slider_reconciliation(db):
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 10), -200, "A", cat="dining")
    _add_txn(db, acc_id, date(2024, 2, 10), -200, "B", cat="dining")

    baseline = compute_scope_averages(
        db, {"category_id": "dining"}, period="monthly", account_id=acc_id
    )
    assert baseline["burn"] == 200

    result = compute_scope_projection(
        db,
        scope={"category_id": "dining"},
        period="monthly",
        increase_percent=20,
        decrease_percent=10,
        account_id=acc_id,
    )
    # Net +10% on category net (-200 avg net → -220 spend side)
    assert result["adjustment"]["net_percent"] == 10
    assert result["projected"]["net"] == pytest.approx(baseline["net"] * 1.1, rel=0.01)


def test_dollar_mode_net(db):
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 10), -100, "A", cat="dining")

    result = compute_scope_projection(
        db,
        scope={"category_id": "dining"},
        period="monthly",
        increase_dollars=50,
        decrease_dollars=20,
        dollar_mode=True,
        account_id=acc_id,
    )
    assert result["adjustment"]["net_dollars"] == 30
    assert result["projected"]["net"] == pytest.approx(result["baseline"]["net"] + 30, rel=0.01)


def test_period_scaling_monthly_slider_yearly_stats(db):
    """Monthly $50 burn decrease → yearly stats shows -$600 burn effect."""
    acc_id = db.query(Account).first().id
    _add_txn(db, acc_id, date(2024, 1, 15), 1000, "Pay", balance=1000, cat="income")
    _add_txn(db, acc_id, date(2024, 1, 20), -400, "Spend", balance=600, cat="dining")

    result = compute_scope_projection(
        db,
        scope="total",
        slider_period="monthly",
        stats_period="yearly",
        decrease_dollars=50,
        dollar_mode=True,
        account_id=acc_id,
    )
    assert result["effects"]["burn"] == pytest.approx(-600, rel=0.01)
    assert result["slider_period"] == "monthly"
    assert result["stats_period"] == "yearly"


def test_scale_period_delta():
    from app.services.projections import scale_period_delta

    assert scale_period_delta(50, "monthly", "yearly") == 600
    assert scale_period_delta(150, "quarterly", "monthly") == pytest.approx(50)
    assert scale_period_delta(10, "monthly", "monthly") == 10

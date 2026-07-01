"""Financial analytics: burn rate, savings rate, recurring detection."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Literal

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.db.models import Transaction

Period = Literal["monthly", "quarterly", "yearly", "total"]


def _period_key(d: date, period: Period) -> str:
    if period == "monthly":
        return f"{d.year}-{d.month:02d}"
    if period == "quarterly":
        q = (d.month - 1) // 3 + 1
        return f"{d.year}-Q{q}"
    if period == "yearly":
        return str(d.year)
    return "total"


def _filter_transactions(
    db: Session,
    account_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[Transaction]:
    q = db.query(Transaction)
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    if start_date:
        q = q.filter(Transaction.date >= start_date)
    if end_date:
        q = q.filter(Transaction.date <= end_date)
    return q.order_by(Transaction.date).all()


def compute_summary(
    db: Session,
    period: Period = "monthly",
    account_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    """Inflow/outflow by period, category totals, burn rate, savings rate."""
    txns = _filter_transactions(db, account_id, start_date, end_date)

    chart_period: Period = "monthly" if period == "total" else period
    period_flows: dict[str, dict[str, float]] = defaultdict(
        lambda: {"inflow": 0.0, "outflow": 0.0}
    )
    period_ending_balance: dict[str, float] = {}
    category_period_flows: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {"inflow": 0.0, "outflow": 0.0})
    )
    category_all_time: dict[str, dict[str, float]] = defaultdict(
        lambda: {"inflow": 0.0, "outflow": 0.0}
    )

    total_inflow = 0.0
    total_outflow = 0.0
    cumulative = 0.0

    for txn in txns:
        flow_key = _period_key(txn.date, chart_period)
        cumulative += txn.amount
        if txn.amount > 0:
            period_flows[flow_key]["inflow"] += txn.amount
            total_inflow += txn.amount
        else:
            period_flows[flow_key]["outflow"] += abs(txn.amount)
            total_outflow += abs(txn.amount)

        period_ending_balance[flow_key] = (
            txn.running_balance if txn.running_balance is not None else cumulative
        )

        cat_key = txn.category_id or "uncategorized"
        if txn.subcategory_id:
            cat_key = f"{cat_key}/{txn.subcategory_id}"
        cat_period_key = _period_key(txn.date, period if period != "total" else "monthly")
        if txn.amount > 0:
            category_period_flows[cat_key][cat_period_key]["inflow"] += txn.amount
            category_all_time[cat_key]["inflow"] += txn.amount
        else:
            amount_out = abs(txn.amount)
            category_period_flows[cat_key][cat_period_key]["outflow"] += amount_out
            category_all_time[cat_key]["outflow"] += amount_out

    category_period_keys = {
        _period_key(txn.date, period if period != "total" else "monthly") for txn in txns
    }
    n_category_periods = len(category_period_keys)

    category_totals: dict[str, float] = {}
    if period == "total":
        for cat_key, flows in category_all_time.items():
            category_totals[cat_key] = round(flows["inflow"] - flows["outflow"], 2)
    else:
        # Divisor matches stats-strip logic: all buckets at category granularity,
        # including zero-activity periods (not only periods with category txns).
        for cat_key, buckets in category_period_flows.items():
            if not n_category_periods:
                continue
            avg_in = sum(b["inflow"] for b in buckets.values()) / n_category_periods
            avg_out = sum(b["outflow"] for b in buckets.values()) / n_category_periods
            category_totals[cat_key] = round(avg_in - avg_out, 2)

    # Monthly burn: average monthly outflow
    monthly_outflows: dict[str, float] = defaultdict(float)
    for txn in txns:
        if txn.amount < 0:
            mk = f"{txn.date.year}-{txn.date.month:02d}"
            monthly_outflows[mk] += abs(txn.amount)

    burn_rate = (
        sum(monthly_outflows.values()) / len(monthly_outflows)
        if monthly_outflows
        else 0.0
    )

    savings_rate = (
        (total_inflow - total_outflow) / total_inflow * 100 if total_inflow > 0 else 0.0
    )

    periods = sorted(period_flows.keys())
    return {
        "period": period,
        "account_id": account_id,
        "periods": [
            {
                "key": k,
                "inflow": round(period_flows[k]["inflow"], 2),
                "outflow": round(period_flows[k]["outflow"], 2),
                "net": round(
                    period_flows[k]["inflow"] - period_flows[k]["outflow"], 2
                ),
                "ending_balance": round(period_ending_balance[k], 2),
            }
            for k in periods
        ],
        "totals": {
            "inflow": round(total_inflow, 2),
            "outflow": round(total_outflow, 2),
            "net": round(total_inflow - total_outflow, 2),
        },
        "category_totals": {k: round(v, 2) for k, v in sorted(category_totals.items())},
        "monthly_burn_rate": round(burn_rate, 2),
        "savings_rate_percent": round(savings_rate, 2),
    }


def detect_recurring(
    db: Session,
    account_id: int | None = None,
    min_occurrences: int = 2,
    amount_tolerance: float = 0.15,
) -> list[dict[str, Any]]:
    """
    Detect recurring/subscription charges: same payee, ~monthly, similar amount.
    """
    q = db.query(Transaction).filter(Transaction.amount < 0)
    if account_id is not None:
        q = q.filter(Transaction.account_id == account_id)
    txns = q.order_by(Transaction.date).all()

    by_payee: dict[str, list[Transaction]] = defaultdict(list)
    for txn in txns:
        by_payee[txn.normalized_payee].append(txn)

    results: list[dict[str, Any]] = []
    for payee, group in by_payee.items():
        if len(group) < min_occurrences:
            continue

        amounts = [abs(t.amount) for t in group]
        avg_amount = sum(amounts) / len(amounts)
        if avg_amount == 0:
            continue

        amount_variance = max(abs(a - avg_amount) / avg_amount for a in amounts)
        if amount_variance > amount_tolerance:
            continue

        # Check approximate monthly spacing
        dates = sorted(t.date for t in group)
        if len(dates) >= 2:
            gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
            avg_gap = sum(gaps) / len(gaps)
            if not (20 <= avg_gap <= 40):
                continue

        sample = group[-1]
        results.append(
            {
                "payee": payee,
                "occurrences": len(group),
                "average_amount": round(avg_amount, 2),
                "total_spent": round(sum(amounts), 2),
                "category_id": sample.category_id,
                "subcategory_id": sample.subcategory_id,
                "first_date": dates[0].isoformat(),
                "last_date": dates[-1].isoformat(),
                "transaction_ids": [t.id for t in group],
            }
        )

    results.sort(key=lambda r: r["total_spent"], reverse=True)
    return results


def _matches_category(
    txn: Transaction,
    category_id: str,
    subcategory_id: str | None = None,
) -> bool:
    cat = txn.category_id or "uncategorized"
    if cat != category_id:
        return False
    if subcategory_id is not None:
        return txn.subcategory_id == subcategory_id
    return True


def _periods_for_averages(
    db: Session,
    period: Period,
    account_id: int | None,
    category_id: str | None = None,
    subcategory_id: str | None = None,
) -> list[dict[str, Any]]:
    """Period buckets for scope averages (monthly/quarterly/yearly means)."""
    if category_id is None:
        summary = compute_summary(db, period=period, account_id=account_id)
        return summary["periods"]

    trend = compute_category_trend(
        db,
        period=period,
        category_id=category_id,
        subcategory_id=subcategory_id,
        account_id=account_id,
    )
    return trend["periods"]


def _mean_period_field(periods: list[dict[str, Any]], field: str) -> float:
    if not periods:
        return 0.0
    return sum(float(p.get(field) or 0) for p in periods) / len(periods)


def _ending_account_balance(db: Session, account_id: int | None) -> float:
    txns = _filter_transactions(db, account_id)
    if not txns:
        return 0.0
    latest = txns[-1]
    if latest.running_balance is not None:
        return round(latest.running_balance, 2)
    return round(sum(t.amount for t in txns), 2)


def compute_scope_averages(
    db: Session,
    scope: str | dict[str, Any],
    period: Period = "monthly",
    account_id: int | None = None,
) -> dict[str, float]:
    """
    Period-aware metrics for total or a single category scope.
    Monthly/quarterly/yearly use mean of period buckets; total uses full sums.
    """
    category_id: str | None = None
    subcategory_id: str | None = None
    if scope != "total":
        category_id = scope.get("category_id")
        subcategory_id = scope.get("subcategory_id")

    if period == "total":
        if scope == "total":
            summary = compute_summary(db, period="total", account_id=account_id)
            totals = summary["totals"]
            return {
                "income": totals["inflow"],
                "burn": totals["outflow"],
                "net": totals["net"],
                "balance": _ending_account_balance(db, account_id),
            }

        trend = compute_category_trend(
            db,
            period="total",
            category_id=category_id or "",
            subcategory_id=subcategory_id,
            account_id=account_id,
        )
        periods = trend["periods"]
        return {
            "income": round(sum(float(p.get("inflow") or 0) for p in periods), 2),
            "burn": round(sum(float(p.get("outflow") or 0) for p in periods), 2),
            "net": round(sum(float(p.get("net") or 0) for p in periods), 2),
            "balance": _ending_account_balance(db, account_id),
        }

    periods = _periods_for_averages(
        db, period, account_id, category_id, subcategory_id
    )

    result = {
        "income": round(_mean_period_field(periods, "inflow"), 2),
        "burn": round(_mean_period_field(periods, "outflow"), 2),
        "net": round(_mean_period_field(periods, "net"), 2),
        "balance": round(_mean_period_field(periods, "ending_balance"), 2),
    }

    if scope == "total" and not periods:
        result["balance"] = _ending_account_balance(db, account_id)

    return result


def compute_category_trend(
    db: Session,
    period: Period = "monthly",
    category_id: str = "",
    subcategory_id: str | None = None,
    account_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict[str, Any]:
    """Per-period inflow/outflow/net for a single category (trend chart data)."""
    txns = _filter_transactions(db, account_id, start_date, end_date)
    filtered = [t for t in txns if _matches_category(t, category_id, subcategory_id)]

    bucket_period: Period = "monthly" if period == "total" else period
    period_flows: dict[str, dict[str, float]] = defaultdict(
        lambda: {"inflow": 0.0, "outflow": 0.0}
    )

    for txn in filtered:
        key = _period_key(txn.date, bucket_period)
        if txn.amount > 0:
            period_flows[key]["inflow"] += txn.amount
        else:
            period_flows[key]["outflow"] += abs(txn.amount)

    all_keys = sorted(period_flows.keys())
    if period == "total" and not all_keys:
        all_keys = ["total"]

    periods = []
    for k in all_keys:
        flows = period_flows.get(k, {"inflow": 0.0, "outflow": 0.0})
        periods.append(
            {
                "key": k,
                "label": k,
                "inflow": round(flows["inflow"], 2),
                "outflow": round(flows["outflow"], 2),
                "net": round(flows["inflow"] - flows["outflow"], 2),
            }
        )

    return {
        "period": period,
        "account_id": account_id,
        "category_id": category_id,
        "subcategory_id": subcategory_id,
        "periods": periods,
    }

"""What-if scenario projections: scope-based increase/decrease adjustments."""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy.orm import Session

from app.services.analytics import Period, compute_scope_averages, compute_summary

PeriodType = Literal["monthly", "quarterly", "yearly", "total"]

# Months per bucket for scaling recurring slider deltas to banner stats period.
# monthly→yearly = ×12, monthly→quarterly = ×3, same period = ×1.
# "total" uses monthly-equivalent means (same as stats strip total view).
_PERIOD_MONTHS: dict[str, float] = {
    "monthly": 1.0,
    "quarterly": 3.0,
    "yearly": 12.0,
    "total": 1.0,
}


def scale_period_delta(
    delta: float,
    slider_period: PeriodType,
    stats_period: PeriodType,
) -> float:
    """Scale a recurring adjustment from slider_period units to stats_period units."""
    slider_m = _PERIOD_MONTHS[slider_period]
    stats_m = _PERIOD_MONTHS[stats_period]
    return delta * (stats_m / slider_m)


def _apply_net_adjustment(
    baseline: float,
    increase_percent: float,
    decrease_percent: float,
    increase_dollars: float | None,
    decrease_dollars: float | None,
    dollar_mode: bool,
) -> tuple[float, dict[str, float]]:
    """Net adjustment on a single metric (category scope). Sliders reconcile to net."""
    if dollar_mode:
        inc = increase_dollars or 0.0
        dec = decrease_dollars or 0.0
        net_dollars = inc - dec
        return baseline + net_dollars, {
            "net_dollars": round(net_dollars, 2),
            "net_percent": round((net_dollars / baseline * 100) if baseline else 0.0, 2),
        }
    net_percent = increase_percent - decrease_percent
    return baseline * (1 + net_percent / 100.0), {
        "net_percent": round(net_percent, 2),
        "net_dollars": round(baseline * net_percent / 100.0, 2),
    }


def compute_scope_projection(
    db: Session,
    scope: str | dict[str, Any] = "total",
    period: PeriodType = "monthly",
    slider_period: PeriodType | None = None,
    stats_period: PeriodType | None = None,
    increase_percent: float = 0.0,
    decrease_percent: float = 0.0,
    increase_dollars: float | None = None,
    decrease_dollars: float | None = None,
    dollar_mode: bool = False,
    account_id: int | None = None,
) -> dict[str, Any]:
    """
    What-if projection for total or category scope.

    Total scope: increase affects income, decrease reduces burn (independent sliders).
    Category scope: increase/decrease reconcile to net change on category net flow.
    Sliders apply at slider_period; banner effects scale to stats_period.
    """
    effective_slider = slider_period or period
    effective_stats = stats_period or period

    baseline = compute_scope_averages(
        db, scope, period=effective_slider, account_id=account_id
    )
    total_baseline = (
        baseline
        if scope == "total"
        else compute_scope_averages(
            db, "total", period=effective_slider, account_id=account_id
        )
    )

    adjustment_meta: dict[str, Any] = {}

    if scope == "total":
        if dollar_mode:
            inc_delta = increase_dollars or 0.0
            dec_delta = decrease_dollars or 0.0
        else:
            inc_delta = baseline["income"] * increase_percent / 100.0
            dec_delta = baseline["burn"] * decrease_percent / 100.0

        projected_income = baseline["income"] + inc_delta
        projected_burn = max(0.0, baseline["burn"] - dec_delta)
        projected_net = projected_income - projected_burn
        net_delta = projected_net - baseline["net"]
        adjustment_meta = {
            "increase_delta": round(inc_delta, 2),
            "decrease_delta": round(dec_delta, 2),
            "net_delta": round(net_delta, 2),
        }
    else:
        projected_net, adjustment_meta = _apply_net_adjustment(
            baseline["net"],
            increase_percent,
            decrease_percent,
            increase_dollars,
            decrease_dollars,
            dollar_mode,
        )
        net_delta = projected_net - baseline["net"]
        projected_income = baseline["income"]
        projected_burn = baseline["burn"]
        if baseline["net"] != 0:
            ratio = projected_net / baseline["net"] if baseline["net"] else 1.0
            projected_income = baseline["income"] * ratio if baseline["income"] else 0.0
            projected_burn = baseline["burn"] * ratio if baseline["burn"] else 0.0
        elif net_delta != 0:
            if net_delta > 0:
                projected_income = abs(net_delta)
            else:
                projected_burn = abs(net_delta)

    projected_balance = (total_baseline["balance"] or 0.0) + net_delta

    income_effect = scale_period_delta(
        projected_income - baseline["income"], effective_slider, effective_stats
    )
    burn_effect = scale_period_delta(
        projected_burn - baseline["burn"], effective_slider, effective_stats
    )
    net_effect = scale_period_delta(
        projected_net - baseline["net"], effective_slider, effective_stats
    )
    balance_effect = scale_period_delta(net_delta, effective_slider, effective_stats)

    return {
        "scope": scope if scope == "total" else dict(scope),
        "period": effective_stats,
        "slider_period": effective_slider,
        "stats_period": effective_stats,
        "adjustment": adjustment_meta,
        "baseline": {
            "income": baseline["income"],
            "burn": baseline["burn"],
            "net": baseline["net"],
            "balance": total_baseline["balance"],
        },
        "projected": {
            "income": round(projected_income, 2),
            "burn": round(projected_burn, 2),
            "net": round(projected_net, 2),
            "balance": round(projected_balance, 2),
        },
        "effects": {
            "income": round(income_effect, 2),
            "burn": round(burn_effect, 2),
            "net": round(net_effect, 2),
            "balance": round(balance_effect, 2),
        },
    }


def compute_projection(
    db: Session,
    income_delta: float = 0.0,
    category_adjustments: list[dict[str, Any]] | None = None,
    account_id: int | None = None,
    months_forward: int = 12,
    scope: str | dict[str, Any] | None = None,
    period: PeriodType = "monthly",
    increase_percent: float = 0.0,
    decrease_percent: float = 0.0,
    increase_dollars: float | None = None,
    decrease_dollars: float | None = None,
    dollar_mode: bool = False,
    slider_period: PeriodType | None = None,
    stats_period: PeriodType | None = None,
) -> dict[str, Any]:
    """
    Projection entry point. Legacy path when category_adjustments is non-empty;
    otherwise uses scope-based increase/decrease sliders.
    """
    if category_adjustments:
        return _legacy_projection(
            db,
            income_delta=income_delta,
            category_adjustments=category_adjustments,
            account_id=account_id,
            months_forward=months_forward,
        )

    effective_scope = scope if scope is not None else "total"
    result = compute_scope_projection(
        db,
        scope=effective_scope,
        period=period,
        slider_period=slider_period,
        stats_period=stats_period,
        increase_percent=increase_percent,
        decrease_percent=decrease_percent,
        increase_dollars=increase_dollars,
        decrease_dollars=decrease_dollars,
        dollar_mode=dollar_mode,
        account_id=account_id,
    )
    result["months_forward"] = months_forward
    return result


def _legacy_projection(
    db: Session,
    income_delta: float,
    category_adjustments: list[dict[str, Any]],
    account_id: int | None,
    months_forward: int,
) -> dict[str, Any]:
    """Legacy what-if: income_delta + per-category adjustments."""
    from app.db.models import Transaction

    category_adjustments = category_adjustments or []
    summary = compute_summary(db, period="monthly", account_id=account_id)

    baseline_inflow = summary["totals"]["inflow"]
    baseline_outflow = summary["totals"]["outflow"]
    monthly_burn = summary["monthly_burn_rate"]

    txns_q = db.query(Transaction).filter(Transaction.amount < 0)
    if account_id is not None:
        txns_q = txns_q.filter(Transaction.account_id == account_id)
    txns = txns_q.all()

    months_seen: set[str] = set()
    cat_monthly: dict[str, list[float]] = {}
    for txn in txns:
        mk = f"{txn.date.year}-{txn.date.month:02d}"
        months_seen.add(mk)
        key = txn.category_id or "uncategorized"
        if txn.subcategory_id:
            key = f"{key}/{txn.subcategory_id}"
        cat_monthly.setdefault(key, []).append(abs(txn.amount))

    num_months = max(len(months_seen), 1)
    cat_avg_monthly = {k: sum(v) / num_months for k, v in cat_monthly.items()}

    projected_outflow = baseline_outflow / num_months if num_months else monthly_burn
    adjustment_details: list[dict[str, Any]] = []

    for adj in category_adjustments:
        cat_key = adj.get("category_id", "")
        if adj.get("subcategory_id"):
            cat_key = f"{cat_key}/{adj['subcategory_id']}"

        base = cat_avg_monthly.get(cat_key, 0.0)
        mode = adj.get("mode", "percent")
        value = float(adj.get("value", 0))

        if mode == "percent":
            delta = base * (value / 100.0)
            new_monthly = base + delta
        elif mode == "pad":
            new_monthly = max(base, value)
            delta = new_monthly - base
        elif mode == "reduce":
            new_monthly = max(0, base - value)
            delta = new_monthly - base
        else:
            delta = 0.0
            new_monthly = base

        projected_outflow += delta
        adjustment_details.append(
            {
                "category_key": cat_key,
                "mode": mode,
                "value": value,
                "baseline_monthly": round(base, 2),
                "projected_monthly": round(new_monthly, 2),
                "monthly_delta": round(delta, 2),
            }
        )

    projected_inflow_monthly = (baseline_inflow / num_months if num_months else 0) + (
        income_delta / months_forward if months_forward else income_delta
    )
    projected_outflow_monthly = projected_outflow
    net_monthly = projected_inflow_monthly - projected_outflow_monthly

    balance_q = db.query(Transaction).order_by(
        Transaction.date.desc(), Transaction.id.desc()
    )
    if account_id is not None:
        balance_q = balance_q.filter(Transaction.account_id == account_id)
    latest = balance_q.first()

    latest_balance: float | None = None
    if latest and latest.running_balance is not None:
        latest_balance = latest.running_balance
    elif latest:
        all_q = db.query(Transaction)
        if account_id is not None:
            all_q = all_q.filter(Transaction.account_id == account_id)
        latest_balance = sum(t.amount for t in all_q.all())

    runway_months: float | None = None
    if latest_balance is not None and net_monthly < 0:
        runway_months = round(latest_balance / abs(net_monthly), 1)

    cashflow_projection = []
    balance = latest_balance or 0.0
    for m in range(1, months_forward + 1):
        balance += net_monthly
        cashflow_projection.append(
            {
                "month": m,
                "inflow": round(projected_inflow_monthly, 2),
                "outflow": round(projected_outflow_monthly, 2),
                "net": round(net_monthly, 2),
                "projected_balance": round(balance, 2),
            }
        )

    return {
        "baseline": {
            "monthly_inflow": round(baseline_inflow / num_months, 2) if num_months else 0,
            "monthly_outflow": round(baseline_outflow / num_months, 2) if num_months else 0,
            "monthly_burn_rate": monthly_burn,
            "current_balance": round(latest_balance, 2) if latest_balance else None,
        },
        "scenario": {
            "income_delta": income_delta,
            "category_adjustments": adjustment_details,
            "projected_monthly_inflow": round(projected_inflow_monthly, 2),
            "projected_monthly_outflow": round(projected_outflow_monthly, 2),
            "projected_monthly_net": round(net_monthly, 2),
            "runway_months": runway_months,
        },
        "cashflow_projection": cashflow_projection,
    }

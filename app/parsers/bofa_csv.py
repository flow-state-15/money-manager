"""Bank statement CSV parser (checking account export format)."""

from __future__ import annotations

import csv
import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime
from io import StringIO
from pathlib import Path


@dataclass
class ParsedTransaction:
    date: date
    description: str
    normalized_payee: str
    amount: float
    running_balance: float | None
    is_pending: bool
    dedupe_hash: str


# Summary / non-transaction row markers
_SKIP_DESCRIPTIONS = frozenset(
    {
        "beginning balance",
        "total credits",
        "total debits",
        "ending balance",
    }
)

_DATE_RE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{4})$")
_PURCHASE_TAIL_RE = re.compile(
    r"\s+\d{1,2}/\d{1,2}\s+PURCHASE\b.*$", re.IGNORECASE
)
_ACH_DES_RE = re.compile(r"\s+DES:", re.IGNORECASE)


def parse_date(value: str) -> date | None:
    """Parse MM/DD/YYYY date string."""
    value = value.strip()
    if not _DATE_RE.match(value):
        return None
    return datetime.strptime(value, "%m/%d/%Y").date()


def normalize_payee(description: str) -> str:
    """
    Extract a stable payee key from bank statement description.

    Card purchases: strip embedded purchase date + PURCHASE + location.
    ACH rows: take text before DES: field.
    """
    text = description.strip().strip('"')
    if _ACH_DES_RE.search(text):
        text = _ACH_DES_RE.split(text, maxsplit=1)[0].strip()
    else:
        text = _PURCHASE_TAIL_RE.sub("", text).strip()
    text = re.sub(r"\s+", " ", text).upper()
    return text


def compute_dedupe_hash(
    txn_date: date,
    description: str,
    amount: float,
    running_balance: float | None = None,
) -> str:
    """
    Stable hash for import deduplication.

    Includes running balance when present so identical same-day charges
    (e.g. duplicate same-day card charges) remain distinct.
    """
    balance_part = f"{running_balance:.2f}" if running_balance is not None else ""
    payload = f"{txn_date.isoformat()}|{description.strip()}|{amount:.2f}|{balance_part}"
    return hashlib.sha256(payload.encode()).hexdigest()


def is_pending(description: str) -> bool:
    """Detect pending indicator if the export adds a pending flag."""
    upper = description.upper()
    return "PENDING" in upper or upper.startswith("PEND ")


def is_skippable_row(description: str, amount_str: str) -> bool:
    """Skip summary rows and beginning-balance duplicates in transaction block."""
    desc_lower = description.strip().lower()
    if not desc_lower:
        return True
    if any(marker in desc_lower for marker in _SKIP_DESCRIPTIONS):
        return True
    if desc_lower.startswith("beginning balance"):
        return True
    if not amount_str.strip():
        return True
    return False


def parse_bofa_csv(content: str | bytes) -> list[ParsedTransaction]:
    """
    Parse a bank statement CSV export.

    Skips summary header rows 1-5 and blank row 6; parses transactions from row 7+.
    Columns: Date, Description, Amount, Running Bal.
    """
    if isinstance(content, bytes):
        content = content.decode("utf-8-sig")

    reader = csv.reader(StringIO(content))
    rows = list(reader)

    # Find transaction header row (Date, Description, Amount, Running Bal.)
    start_idx = 0
    for i, row in enumerate(rows):
        if not row:
            continue
        first = row[0].strip().lower()
        if first == "date" and len(row) >= 3:
            start_idx = i + 1
            break

    results: list[ParsedTransaction] = []
    for row in rows[start_idx:]:
        if len(row) < 3:
            continue
        date_str, description, amount_str = row[0], row[1], row[2]
        running_str = row[3].strip() if len(row) > 3 else ""

        description = description.strip().strip('"')
        if is_skippable_row(description, amount_str):
            continue

        txn_date = parse_date(date_str)
        if txn_date is None:
            continue

        try:
            amount = float(amount_str.replace(",", ""))
        except ValueError:
            continue

        running_balance: float | None = None
        if running_str:
            try:
                running_balance = float(running_str.replace(",", ""))
            except ValueError:
                pass

        payee = normalize_payee(description)
        dedupe = compute_dedupe_hash(txn_date, description, amount, running_balance)

        results.append(
            ParsedTransaction(
                date=txn_date,
                description=description,
                normalized_payee=payee,
                amount=amount,
                running_balance=running_balance,
                is_pending=is_pending(description),
                dedupe_hash=dedupe,
            )
        )

    return results


def parse_bofa_csv_file(path: Path | str) -> list[ParsedTransaction]:
    """Parse bank statement CSV from file path."""
    path = Path(path)
    return parse_bofa_csv(path.read_text(encoding="utf-8-sig"))

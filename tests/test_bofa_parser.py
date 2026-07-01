"""Tests for bank statement CSV parser and import pipeline."""

from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base
from app.parsers.bofa_csv import (
    compute_dedupe_hash,
    normalize_payee,
    parse_bofa_csv_file,
)
from app.services import categorizer
from app.services.categorizer import CategoryRegistry
from app.services.import_service import import_csv_content

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
SAMPLE_CSV = FIXTURES_DIR / "sample_bofa.csv"
CATEGORIES_YAML = Path(__file__).resolve().parent.parent / "data" / "categories.dist.yaml"


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


class TestBofaParser:
    def test_parses_sample_csv(self):
        txns = parse_bofa_csv_file(SAMPLE_CSV)
        assert len(txns) == 8

    def test_skips_summary_and_beginning_balance(self):
        txns = parse_bofa_csv_file(SAMPLE_CSV)
        descriptions = [t.description.lower() for t in txns]
        assert not any("beginning balance" in d for d in descriptions)
        assert not any("total credits" in d for d in descriptions)

    def test_date_parsing(self):
        txns = parse_bofa_csv_file(SAMPLE_CSV)
        assert txns[0].date == date(2024, 12, 2)

    def test_amount_signs(self):
        txns = parse_bofa_csv_file(SAMPLE_CSV)
        debits = [t for t in txns if t.amount < 0]
        credits = [t for t in txns if t.amount > 0]
        assert len(debits) == 6
        assert len(credits) == 2

    def test_normalize_card_purchase(self):
        payee = normalize_payee(
            "COFFEE SHOP 0 11/28 PURCHASE ANYTOWN ST"
        )
        assert payee == "COFFEE SHOP 0"

    def test_normalize_ach(self):
        payee = normalize_payee(
            "PAYROLL ACME DES:EDI PYMNTS ID:00000001 INDN:JANE DOE CO ID:0000000000 PPD"
        )
        assert payee == "PAYROLL ACME"

    def test_dedupe_hash_stable(self):
        h1 = compute_dedupe_hash(date(2024, 12, 2), "COFFEE SHOP", -8.75)
        h2 = compute_dedupe_hash(date(2024, 12, 2), "COFFEE SHOP", -8.75)
        assert h1 == h2

    def test_duplicate_same_day_charges_distinct(self):
        txns = parse_bofa_csv_file(SAMPLE_CSV)
        dupes = [
            t
            for t in txns
            if "ONLINE STORE" in t.description and t.date == date(2024, 12, 4)
        ]
        assert len(dupes) == 2
        assert dupes[0].dedupe_hash != dupes[1].dedupe_hash


class TestCategorization:
    def test_empty_keywords_fall_through_to_uncategorized(self):
        registry = CategoryRegistry(CATEGORIES_YAML)
        match = registry.categorize(
            "COFFEE SHOP 0 11/28 PURCHASE ANYTOWN ST",
            "COFFEE SHOP 0",
            {},
        )
        assert match.source == "uncategorized"
        assert match.category_id == "personal"
        assert match.subcategory_id == "uncategorized"

    def test_vendor_rule_priority(self):
        registry = CategoryRegistry(CATEGORIES_YAML)
        rules = {"COFFEE SHOP 0": ("personal", "gifts")}
        match = registry.categorize("COFFEE SHOP", "COFFEE SHOP 0", rules)
        assert match.source == "vendor_rule"
        assert match.category_id == "personal"


@pytest.fixture
def dist_registry():
    """Use shipped dist taxonomy (empty keywords), not local categories.yaml."""
    registry = CategoryRegistry(CATEGORIES_YAML)
    old = categorizer._registry
    categorizer._registry = registry
    yield registry
    categorizer._registry = old


class TestImport:
    def test_import_sample_csv(self, db_session, dist_registry):
        content = SAMPLE_CSV.read_text(encoding="utf-8-sig")
        result = import_csv_content(db_session, content, "sample_bofa.csv")
        assert result["rows_total"] == 8
        assert result["rows_new"] == 8
        assert result["rows_duplicate"] == 0
        assert result["rows_uncategorized"] == 8
        assert result["rows_categorized"] == 0

    def test_import_dedupes(self, db_session):
        content = SAMPLE_CSV.read_text(encoding="utf-8-sig")
        import_csv_content(db_session, content, "sample_bofa.csv")
        result2 = import_csv_content(db_session, content, "sample_bofa.csv")
        assert result2["rows_new"] == 0
        assert result2["rows_duplicate"] == 8

    def test_import_same_csv_different_accounts(self, db_session):
        from app.db.models import Account

        content = SAMPLE_CSV.read_text(encoding="utf-8-sig")
        import_csv_content(db_session, content, "sample_bofa.csv")

        second = Account(name="Second Checking", currency="USD")
        db_session.add(second)
        db_session.commit()

        result = import_csv_content(
            db_session, content, "sample_bofa.csv", account_id=second.id
        )
        assert result["rows_new"] == 8
        assert result["rows_duplicate"] == 0

"""Category taxonomy loader and matching engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from app.config import resolve_categories_path


@dataclass
class SubcategoryDef:
    id: str
    name: str
    keywords: list[str] = field(default_factory=list)


@dataclass
class CategoryDef:
    id: str
    name: str
    type: str
    subcategories: list[SubcategoryDef] = field(default_factory=list)


@dataclass
class CategoryMatch:
    category_id: str
    subcategory_id: str | None
    source: str  # "vendor_rule" | "keyword" | "uncategorized"


class CategoryRegistry:
    """Loads category taxonomy YAML and provides keyword + vendor-rule matching."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or resolve_categories_path()
        self.version: int = 1
        self.categories: list[CategoryDef] = []
        self._keyword_index: list[tuple[str, str, str]] = []
        self.reload()

    def reload(self) -> None:
        """Reload categories from YAML file."""
        with open(self.path, encoding="utf-8") as f:
            data: dict[str, Any] = yaml.safe_load(f)

        self.version = data.get("version", 1)
        self.categories = []
        self._keyword_index = []

        for cat in data.get("categories", []):
            subs: list[SubcategoryDef] = []
            for sub in cat.get("subcategories", []):
                sub_def = SubcategoryDef(
                    id=sub["id"],
                    name=sub["name"],
                    keywords=[k.lower() for k in sub.get("keywords", [])],
                )
                subs.append(sub_def)
                for kw in sub_def.keywords:
                    self._keyword_index.append((kw, cat["id"], sub["id"]))

            self.categories.append(
                CategoryDef(
                    id=cat["id"],
                    name=cat["name"],
                    type=cat.get("type", "outflow"),
                    subcategories=subs,
                )
            )

    def get_category(self, category_id: str) -> CategoryDef | None:
        for cat in self.categories:
            if cat.id == category_id:
                return cat
        return None

    def get_subcategory(
        self, category_id: str, subcategory_id: str
    ) -> SubcategoryDef | None:
        cat = self.get_category(category_id)
        if not cat:
            return None
        for sub in cat.subcategories:
            if sub.id == subcategory_id:
                return sub
        return None

    def match_by_keywords(
        self, description: str, normalized_payee: str
    ) -> CategoryMatch | None:
        """First keyword hit wins (YAML order)."""
        haystack = f"{description} {normalized_payee}".lower()
        for keyword, cat_id, sub_id in self._keyword_index:
            if keyword and keyword in haystack:
                return CategoryMatch(
                    category_id=cat_id, subcategory_id=sub_id, source="keyword"
                )
        return None

    def match_by_vendor_rule(
        self, normalized_payee: str, vendor_rules: dict[str, tuple[str, str | None]]
    ) -> CategoryMatch | None:
        """Match payee against user vendor rules (exact normalized payee key)."""
        payee_upper = normalized_payee.upper()
        if payee_upper in vendor_rules:
            cat_id, sub_id = vendor_rules[payee_upper]
            return CategoryMatch(
                category_id=cat_id, subcategory_id=sub_id, source="vendor_rule"
            )
        for pattern, (cat_id, sub_id) in vendor_rules.items():
            if pattern in payee_upper or payee_upper in pattern:
                return CategoryMatch(
                    category_id=cat_id, subcategory_id=sub_id, source="vendor_rule"
                )
        return None

    def categorize(
        self,
        description: str,
        normalized_payee: str,
        vendor_rules: dict[str, tuple[str, str | None]],
    ) -> CategoryMatch:
        """
        Priority: vendor rules > keyword match > uncategorized.
        """
        rule_match = self.match_by_vendor_rule(normalized_payee, vendor_rules)
        if rule_match:
            return rule_match

        kw_match = self.match_by_keywords(description, normalized_payee)
        if kw_match:
            return kw_match

        return CategoryMatch(
            category_id="personal",
            subcategory_id="uncategorized",
            source="uncategorized",
        )

    def list_all(self) -> list[dict[str, Any]]:
        """Serialize categories for API response."""
        result = []
        for cat in self.categories:
            result.append(
                {
                    "id": cat.id,
                    "name": cat.name,
                    "type": cat.type,
                    "source": "yaml",
                    "subcategories": [
                        {"id": s.id, "name": s.name} for s in cat.subcategories
                    ],
                }
            )
        return result


# Singleton registry loaded at startup
_registry: CategoryRegistry | None = None


def get_registry() -> CategoryRegistry:
    global _registry
    if _registry is None:
        _registry = CategoryRegistry()
    return _registry


def reload_registry() -> CategoryRegistry:
    global _registry
    if _registry is None:
        _registry = CategoryRegistry()
    else:
        _registry.path = resolve_categories_path()
        _registry.reload()
    return _registry

"""Category endpoints."""

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Category, CategoryDisplayOverride
from app.schemas import CategoryCreate, CategoryOut, CategoryUpdate
from app.services.categorizer import get_registry, reload_registry

router = APIRouter(prefix="/categories", tags=["categories"])

UNCATEGORIZED_ID = "uncategorized"


def _load_display_overrides(db: Session) -> dict[str, str]:
    rows = db.query(CategoryDisplayOverride).all()
    return {row.category_id: row.display_name for row in rows}


def _apply_display_overrides(categories: list[CategoryOut], overrides: dict[str, str]) -> list[CategoryOut]:
    if not overrides:
        return categories
    result: list[CategoryOut] = []
    for cat in categories:
        if cat.id in overrides:
            result.append(cat.model_copy(update={"name": overrides[cat.id]}))
        else:
            result.append(cat)
    return result


def _category_out_from_custom(cat: Category) -> CategoryOut:
    return CategoryOut(
        id=cat.id,
        name=cat.name,
        type=cat.type,
        source="custom",
        parent_id=cat.parent_id,
        subcategories=[],
    )


def _resolve_category_meta(category_id: str, db: Session) -> tuple[str, str, str]:
    """Return (type, source, yaml_name) for a category id."""
    custom = db.query(Category).filter(Category.id == category_id).first()
    if custom:
        return custom.type, "custom", custom.name

    if category_id == UNCATEGORIZED_ID:
        return "outflow", "virtual", "Uncategorized"

    registry = get_registry()
    yaml_cat = registry.get_category(category_id)
    if yaml_cat:
        return yaml_cat.type, "yaml", yaml_cat.name

    raise HTTPException(status_code=404, detail="Category not found")


@router.get("/overrides")
def list_display_overrides(db: Session = Depends(get_db)) -> dict[str, str]:
    return _load_display_overrides(db)


@router.get("", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)) -> list[CategoryOut]:
    registry = get_registry()
    yaml_cats = registry.list_all()
    overrides = _load_display_overrides(db)

    custom = db.query(Category).all()
    custom_by_parent: dict[str | None, list[Category]] = {}
    for c in custom:
        custom_by_parent.setdefault(c.parent_id, []).append(c)

    result = [CategoryOut(**c) for c in yaml_cats]

    for c in custom:
        if c.parent_id is None:
            result.append(_category_out_from_custom(c))

    return _apply_display_overrides(result, overrides)


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryCreate, db: Session = Depends(get_db)) -> CategoryOut:
    registry = get_registry()
    if registry.get_category(body.id) or registry.get_subcategory(body.id, body.id):
        raise HTTPException(status_code=409, detail="Category id already exists in YAML")

    existing = db.query(Category).filter(Category.id == body.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Category id already exists")

    cat = Category(
        id=body.id,
        name=body.name,
        parent_id=body.parent_id,
        type=body.type,
        keywords=json.dumps(body.keywords),
    )
    db.add(cat)
    db.commit()
    return _category_out_from_custom(cat)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: str,
    body: CategoryUpdate,
    db: Session = Depends(get_db),
) -> CategoryOut:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")

    custom = db.query(Category).filter(Category.id == category_id).first()
    if custom:
        custom.name = name
        db.commit()
        db.refresh(custom)
        return _category_out_from_custom(custom)

    cat_type, source, yaml_name = _resolve_category_meta(category_id, db)

    override = (
        db.query(CategoryDisplayOverride)
        .filter(CategoryDisplayOverride.category_id == category_id)
        .first()
    )
    if override:
        override.display_name = name
        override.updated_at = datetime.utcnow()
    else:
        db.add(CategoryDisplayOverride(category_id=category_id, display_name=name))
    db.commit()

    return CategoryOut(
        id=category_id,
        name=name,
        type=cat_type,
        source=source,
        parent_id=None,
        subcategories=[],
    )


@router.post("/reload")
def reload_categories() -> dict:
    """Reload active category taxonomy from disk (local or dist)."""
    registry = reload_registry()
    return {"status": "ok", "version": registry.version, "count": len(registry.categories)}

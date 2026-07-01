"""Tests for category rename API."""

from fastapi.testclient import TestClient

from app.db.database import SessionLocal, init_db
from app.db.models import Category, CategoryDisplayOverride
from app.main import app

client = TestClient(app)


def setup_function() -> None:
    init_db()
    db = SessionLocal()
    try:
        db.query(CategoryDisplayOverride).delete()
        db.query(Category).delete()
        db.commit()
    finally:
        db.close()


def test_patch_yaml_category_stores_display_override() -> None:
    res = client.patch("/api/categories/restaurants", json={"name": "Dining Out"})
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "restaurants"
    assert body["name"] == "Dining Out"

    listed = client.get("/api/categories").json()
    food = next(c for c in listed if c["id"] == "restaurants")
    assert food["name"] == "Dining Out"

    overrides = client.get("/api/categories/overrides").json()
    assert overrides["restaurants"] == "Dining Out"


def test_patch_custom_category_updates_name() -> None:
    create = client.post(
        "/api/categories",
        json={"id": "pet_care", "name": "Pet Care", "type": "outflow", "keywords": []},
    )
    assert create.status_code == 201

    res = client.patch("/api/categories/pet_care", json={"name": "Pets"})
    assert res.status_code == 200
    assert res.json()["name"] == "Pets"

    listed = client.get("/api/categories").json()
    pet = next(c for c in listed if c["id"] == "pet_care")
    assert pet["name"] == "Pets"


def test_patch_uncategorized_virtual_category() -> None:
    res = client.patch("/api/categories/uncategorized", json={"name": "Needs Review"})
    assert res.status_code == 200
    assert res.json()["name"] == "Needs Review"

    overrides = client.get("/api/categories/overrides").json()
    assert overrides["uncategorized"] == "Needs Review"

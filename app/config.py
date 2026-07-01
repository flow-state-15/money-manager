"""Application configuration."""

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
STATIC_DIR = ROOT_DIR / "static"
DB_PATH = DATA_DIR / "money_manager.db"
CATEGORIES_LOCAL_PATH = DATA_DIR / "categories.yaml"
CATEGORIES_DIST_PATH = DATA_DIR / "categories.dist.yaml"


def resolve_categories_path() -> Path:
    """Prefer local categories.yaml; fall back to shipped categories.dist.yaml."""
    if CATEGORIES_LOCAL_PATH.is_file():
        return CATEGORIES_LOCAL_PATH
    return CATEGORIES_DIST_PATH


HOST = "127.0.0.1"
PORT = 8765
DEFAULT_ACCOUNT_NAME = "Primary Checking"

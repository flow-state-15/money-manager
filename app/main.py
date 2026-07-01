"""FastAPI application entry point."""

from __future__ import annotations

import threading
import webbrowser
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import accounts, analytics, categories, export, import_routes, projections, transactions
from app.config import HOST, PORT, STATIC_DIR
from app.db.database import init_db
from app.services.categorizer import get_registry


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    get_registry()
    yield


app = FastAPI(
    title="Money Manager",
    description="Personal finance tracker — bank statement CSV import, categorization, analytics",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api"
app.include_router(accounts.router, prefix=API_PREFIX)
app.include_router(transactions.router, prefix=API_PREFIX)
app.include_router(categories.router, prefix=API_PREFIX)
app.include_router(import_routes.router, prefix=API_PREFIX)
app.include_router(analytics.router, prefix=API_PREFIX)
app.include_router(projections.router, prefix=API_PREFIX)
app.include_router(export.router, prefix=API_PREFIX)


@app.get("/api/health")
def health():
    return {"status": "ok"}


STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


def _open_browser(url: str) -> None:
    webbrowser.open(url)


def main() -> None:
    url = f"http://{HOST}:{PORT}/"
    threading.Timer(1.0, _open_browser, args=[url]).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)


if __name__ == "__main__":
    main()

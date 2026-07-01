# Money Manager

Personal finance tracker for bank statement CSV exports. Import transactions, auto-categorize from a YAML taxonomy, analyze spending, and run what-if projections.

## Quick start (WSL2 / Linux)

Many WSL installs have `python3` but no `python` command. Use one of these from the project root:

```bash
cd money-manager

# Easiest: uses .venv/bin/python3 (or uv / system python3)
./run.sh
```

**First-time setup with [uv](https://docs.astral.sh/uv/) (Python 3.12):**

```bash
cd money-manager
uv venv
uv pip install -r requirements.txt
./run.sh
```

**Alternative run commands (equivalent to** `./run.sh`**):**

```bash
uv run python -m app.main
# or
source .venv/bin/activate && python3 -m app.main
```

Server: [http://127.0.0.1:8765/](http://127.0.0.1:8765/) (health: `curl http://127.0.0.1:8765/api/health`)

**Stop / port already in use:** A prior `./run.sh` may still be listening on port 8765 (common after closing the terminal without stopping the server).

```bash
./stop.sh
# or manually:
kill $(lsof -t -i:8765)
```

If you run `./run.sh` while a healthy instance is already up, it prints the URL and exits instead of failing with "address already in use".

**Classic venv (no uv):**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m app.main
```

API docs: [http://127.0.0.1:8765/docs](http://127.0.0.1:8765/docs)  
REST contract: [docs/API.md](docs/API.md)

## Project layout

```
money-manager/
  app/
    main.py              # FastAPI entry, serves static + API
    config.py            # paths, port 8765, category file resolution
    schemas.py           # Pydantic models
    db/                  # SQLAlchemy models + SQLite
    parsers/             # CSV parser
    services/            # categorizer, import, analytics, projections, export
    api/routes/          # REST endpoints
  data/
    categories.dist.yaml # shipped generic taxonomy (tracked in git)
    categories.yaml      # optional local overrides (gitignored)
    money_manager.db     # SQLite DB (created on first run, gitignored)
  tests/fixtures/
    sample_bofa.csv      # synthetic sample statement for tests
  static/                # frontend assets (served at /)
  docs/API.md
  tests/
```

## Categories (cold start)

On first run the app loads the category taxonomy from:

1. `data/categories.yaml` — if present (local dev / personal keyword mappings)
2. `data/categories.dist.yaml` — otherwise (generic public taxonomy with empty keywords)

The shipped `categories.dist.yaml` defines a minimal generic taxonomy with **no payee keywords** — transactions stay uncategorized until you add keywords locally.

To customize without changing the shipped file:

```bash
cp data/categories.dist.yaml data/categories.yaml
# edit data/categories.yaml: add keywords under each subcategory
```

`POST /api/categories/reload` re-reads the active file without restart.

## Import a statement

Use the Import CSV modal in the UI, or:

```bash
curl -X POST http://127.0.0.1:8765/api/import \
  -F "files=@tests/fixtures/sample_bofa.csv"
```

Place personal bank statement CSV exports in `data/` (gitignored); never commit real statements.

## Run tests

```bash
source .venv/bin/activate && pytest tests/ -v
# or: uv run pytest tests/ -v
```

## Key behaviors

- **Dedup:** imports hash `date + description + amount + running_balance`
- **Categorization priority:** vendor rules → YAML keywords → uncategorized
- **Vendor rules:** created when user assigns category via `PATCH /api/transactions/{id}`
- **Categories reload:** `POST /api/categories/reload` re-reads the active taxonomy file

## Tech stack

- Python 3.12+
- FastAPI + Uvicorn
- SQLAlchemy + SQLite
- PyYAML for categories

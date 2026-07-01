# Money Manager API

Base URL: `http://127.0.0.1:8765/api`

Interactive docs: `http://127.0.0.1:8765/docs`

All JSON responses use standard HTTP status codes. Errors return `{"detail": "..."}`.

---

## Health

### `GET /api/health`

```json
{"status": "ok"}
```

---

## Import

### `POST /api/import`

Upload one or more bank statement CSV files.

**Content-Type:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | file[] | yes | Bank statement CSV export(s) |
| `account_id` | int (query) | no | Target account; creates default account if omitted |

**Response `200`:**

```json
{
  "batch_id": 1,
  "filename": "sample_statement.csv",
  "account_id": 1,
  "rows_total": 42,
  "rows_new": 42,
  "rows_duplicate": 0,
  "rows_categorized": 38,
  "rows_uncategorized": 4
}
```

Re-importing the same file increments `rows_duplicate` and leaves `rows_new` at 0.

---

## Accounts

### `GET /api/accounts`

List accounts with computed balance and transaction count.

**Response `200`:**

```json
[
  {
    "id": 1,
    "name": "Primary Checking",
    "currency": "USD",
    "balance": 2847.50,
    "transaction_count": 42
  }
]
```

Balance uses latest `running_balance` when available, otherwise sum of amounts.

---

## Transactions

### `GET /api/transactions`

| Query param | Type | Description |
|-------------|------|-------------|
| `account_id` | int | Filter by account |
| `start_date` | `YYYY-MM-DD` | Inclusive start |
| `end_date` | `YYYY-MM-DD` | Inclusive end |
| `category_id` | string | e.g. `restaurants` |
| `subcategory_id` | string | e.g. `coffee` |
| `uncategorized_only` | bool | `subcategory_id == uncategorized` |
| `payee` | string | Substring match on normalized payee |
| `limit` | int | Default 500, max 5000 |
| `offset` | int | Pagination offset |

**Response `200`:** array of:

```json
{
  "id": 1,
  "account_id": 1,
  "date": "2024-01-15",
  "description": "COFFEE SHOP 01/14 PURCHASE ANYTOWN ST",
  "normalized_payee": "COFFEE SHOP",
  "amount": -4.50,
  "running_balance": 2843.00,
  "category_id": "restaurants",
  "subcategory_id": "coffee",
  "is_pending": false
}
```

### `GET /api/transactions/{id}`

Single transaction. `404` if not found.

### `PATCH /api/transactions/{id}`

Assign category (drag-to-categorize). Creates or updates a vendor rule for future imports.

**Body:**

```json
{
  "category_id": "restaurants",
  "subcategory_id": "coffee",
  "create_vendor_rule": true
}
```

**Response `200`:** updated transaction object.

### `GET /api/transactions/{id}/similar`

Same-payee siblings for categorization hints.

**Response `200`:**

```json
{
  "transaction": { "...": "..." },
  "similar": [ { "...": "..." } ],
  "suggested_category": {
    "category_id": "restaurants",
    "subcategory_id": "coffee"
  }
}
```

`suggested_category` is derived from the most recent categorized sibling, or `null`.

---

## Categories

### `GET /api/categories`

YAML taxonomy + custom DB categories.

```json
[
  {
    "id": "income",
    "name": "Income",
    "type": "inflow",
    "source": "yaml",
    "parent_id": null,
    "subcategories": [
      {"id": "payroll", "name": "Payroll & Wages"}
    ]
  }
]
```

### `POST /api/categories`

Create custom category (last resort).

**Body:**

```json
{
  "id": "my_custom",
  "name": "My Custom Category",
  "parent_id": null,
  "type": "outflow",
  "keywords": ["foo", "bar"]
}
```

`409` if id conflicts with YAML or existing custom category.

### `POST /api/categories/reload`

Reload the active category taxonomy (`data/categories.yaml` if present, else `data/categories.dist.yaml`) without restart.

```json
{"status": "ok", "version": 1, "count": 12}
```

---

## Analytics

### `GET /api/analytics/summary`

| Query param | Type | Default | Description |
|-------------|------|---------|-------------|
| `period` | string | `monthly` | `monthly` \| `quarterly` \| `yearly` \| `total` |
| `account_id` | int | — | Filter |
| `start_date` | date | — | Filter |
| `end_date` | date | — | Filter |

**Response `200`:**

```json
{
  "period": "monthly",
  "account_id": 1,
  "periods": [
    {"key": "2024-01", "inflow": 3200.0, "outflow": 1850.25, "net": 1349.75}
  ],
  "totals": {"inflow": 3200.0, "outflow": 1850.25, "net": 1349.75},
  "category_totals": {
    "restaurants/coffee": -18.00,
    "income/payroll": 3200.0
  },
  "monthly_burn_rate": 1850.25,
  "savings_rate_percent": 42.18
}
```

### `GET /api/analytics/recurring`

Detect recurring charges (same payee, ~monthly, similar amount).

| Query param | Type | Default |
|-------------|------|---------|
| `account_id` | int | — |
| `min_occurrences` | int | 2 |

**Response `200`:** array of:

```json
{
  "payee": "STREAMING SERVICE",
  "occurrences": 3,
  "average_amount": 15.00,
  "total_spent": 45.00,
  "category_id": "subscriptions",
  "subcategory_id": "streaming",
  "first_date": "2024-01-01",
  "last_date": "2024-03-01",
  "transaction_ids": [7, 19, 31]
}
```

### `GET /api/analytics/category-trend`

Per-period inflow/outflow/net for a single category (used by category-scoped trend chart).

| Query param | Type | Default | Description |
|-------------|------|---------|-------------|
| `category_id` | string | required | e.g. `restaurants` |
| `subcategory_id` | string | — | Optional subcategory filter |
| `period` | string | `monthly` | `monthly` \| `quarterly` \| `yearly` \| `total` |
| `account_id` | int | — | Filter |
| `start_date` | date | — | Filter |
| `end_date` | date | — | Filter |

**Response `200`:**

```json
{
  "period": "monthly",
  "account_id": 1,
  "category_id": "restaurants",
  "subcategory_id": null,
  "periods": [
    {"key": "2024-01", "label": "2024-01", "inflow": 0, "outflow": 52.00, "net": -52.00, "ending_balance": 2847.50}
  ]
}
```

---

## Projections (What-If)

### `POST /api/projections`

Deterministic scenario modeling — no Monte Carlo.

**Scope-based body (current UI):**

```json
{
  "account_id": 1,
  "period": "monthly",
  "scope": {
    "type": "total"
  },
  "increase_percent": 20,
  "decrease_percent": 10,
  "dollar_mode": false,
  "increase_dollars": null,
  "decrease_dollars": null
}
```

**Category scope:**

```json
{
  "account_id": 1,
  "period": "quarterly",
  "scope": {
    "type": "category",
    "category_id": "restaurants",
    "subcategory_id": null
  },
  "increase_percent": 15,
  "decrease_percent": 5
}
```

```json
{
  "account_id": 1,
  "slider_period": "monthly",
  "stats_period": "yearly",
  "scope": {
    "type": "category",
    "category_id": "restaurants",
    "subcategory_id": null
  },
  "increase_percent": 0,
  "decrease_percent": 0,
  "decrease_dollars": 50,
  "dollar_mode": true
}
```

| Field | Description |
|-------|-------------|
| `scope.type` | `total` (default) or `category` |
| `scope.category_id` | Required when `type` is `category` |
| `period` | Legacy alias for `stats_period` when dual periods omitted |
| `slider_period` | Period the increase/decrease sliders represent (default: `period` or `monthly`) |
| `stats_period` | Period for banner effect labels/values (default: `period` or `monthly`) |
| `increase_percent` / `decrease_percent` | 0–100; sliders reconcile to **net** for category scope; **independent** (income ↑, burn ↓) for total scope |
| `dollar_mode` | When `true`, use `increase_dollars` / `decrease_dollars` instead of percents |
| `increase_dollars` / `decrease_dollars` | Dollar deltas at `slider_period`; net = increase − decrease |

**Period scaling:** Slider deltas are computed at `slider_period`, then scaled to `stats_period` for the banner `effects` object: monthly→quarterly ×3, monthly→yearly ×12, same period ×1. `total` uses monthly-equivalent means (×1 vs monthly).

**Response `200` (scope-based):**

```json
{
  "scope": "total",
  "period": "yearly",
  "slider_period": "monthly",
  "stats_period": "yearly",
  "adjustment": {
    "increase_delta": 640.0,
    "decrease_delta": 370.05,
    "net_delta": 269.95
  },
  "baseline": {
    "income": 3200.0,
    "burn": 1850.25,
    "net": 1349.75,
    "balance": 2847.50
  },
  "projected": {
    "income": 3840.0,
    "burn": 1665.23,
    "net": 2174.77,
    "balance": 3517.25
  },
  "effects": {
    "income": 3840.0,
    "burn": -2220.30,
    "net": 6060.30,
    "balance": 3239.75
  },
  "months_forward": 12
}
```

Banner `effects` are signed deltas scaled to `stats_period` (e.g. monthly −$50 burn decrease with yearly stats → `burn: -600`).

For category scope, `adjustment` includes `net_percent` and `net_dollars` (increase − decrease).

**Legacy body** (still supported when `category_adjustments` is non-empty):

```json
{
  "income_delta": 200.0,
  "account_id": 1,
  "months_forward": 12,
  "category_adjustments": [
    {"category_id": "restaurants", "subcategory_id": "fast_food", "mode": "percent", "value": -20}
  ]
}
```

**Legacy adjustment modes:**

| mode | value meaning |
|------|---------------|
| `percent` | % change to category monthly average (+/-) |
| `pad` | floor category spend to $X/month |
| `reduce` | subtract $X/month from category |

**Legacy response** includes `scenario.projected_monthly_net`, `runway_months`, and `cashflow_projection`.

---

## Export

### `GET /api/export/json`

Full JSON dump for backup or external analysis.

| Query param | Type | Description |
|-------------|------|-------------|
| `account_id` | int | Filter |
| `start_date` | date | Filter |
| `end_date` | date | Filter |

**Response `200`:**

```json
{
  "export_version": 1,
  "categories": [ "..." ],
  "accounts": [ "..." ],
  "vendor_rules": [ "..." ],
  "transactions": [ "..." ],
  "trends": {
    "monthly": { "..." },
    "quarterly": { "..." },
    "yearly": { "..." },
    "total": { "..." }
  },
  "recurring": [ "..." ]
}
```

---

## Frontend integration notes

1. **Category transaction drawer:** `GET /api/transactions?category_id=…` for a selected category; `GET /api/transactions?uncategorized_only=true` for the virtual Uncategorized card (`subcategory_id == uncategorized`, typically `category_id=personal`)
2. **Category cards:** `GET /api/analytics/summary?period=monthly` → `category_totals` (Uncategorized total from `*/uncategorized` keys)
3. **Drag categorize:** `PATCH /api/transactions/{id}` with category ids from `GET /api/categories`
4. **Similar hint on drag:** `GET /api/transactions/{id}/similar` before confirming
5. **Import modal:** `POST /api/import` with `FormData` containing file(s)
6. **Charts:** use `periods` from summary endpoint; switch `period` query for quarterly/yearly/total
7. **Category trend chart:** `GET /api/analytics/category-trend?category_id=…&subcategory_id=…&period=…` when a category card is selected (Uncategorized uses `personal` + `uncategorized`)
8. **What-if sliders:** `POST /api/projections` with `scope`, `period`, `increase_percent`/`decrease_percent` (or dollar mode)
9. **Category selection:** Uncategorized card selected by default on load; deselect = total scope for charts/projections
10. **Static UI:** served from `/` — API is under `/api/*`

CORS is enabled for local development.

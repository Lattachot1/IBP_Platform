# Mock planning data

Fictitious data for building and testing the product-level planner:
the database import, the in-memory mode and the optimizer tests. **Nothing here is
client data.** Material numbers (99xxxx), customers (8xxxxx), the plant
(9001) and all quantities are made up. Real exports belong in the database and
never in git.

Regenerate with `python sample_data/generate_mock.py`. The script uses a fixed
seed, so the same script always writes the same files. The data describes the
stock export of Friday 2026-11-06, and the first plan starts on Monday
2026-11-09.

## Files

| File | Imitates | Loads into | Key |
|---|---|---|---|
| `mock/products.csv` | platform master data | `Products` | MaterialNo |
| `mock/forecast_monthly.csv` | forecast engine output | `DemandForecasts` | GroupCode + ForecastMonth + Source |
| `mock/sap_stock.csv` | SAP stock list | `StockSnapshots` (sum of `Unrestricted` over storage locations) | Stock Date + Material Number |
| `mock/sap_qc_lots.csv` | SAP inspection lots | `QcLots` | Inspection Lot |
| `mock/sap_sales_orders.csv` | SAP sales order items | `SalesOrders` | Sales Order Number + Sales Order Item |

The `sap_*` files follow the layout of the client's billing extract:
- a title row sits above the header
- column names are the same wherever the files overlap
- `SU` = `TO`, so quantities are in tons
- dates are written `yyyy/mm/dd`

`Stock Date` is not part of every SAP stock export. If the real file has no such
column, the date has to be entered at upload time.

## Code mapping

- **Usage Decision** (QC lots): blank → `in_qc`, `A` → `released`, `R` → `rejected`
  - A rejected lot shows up as `Blocked` in the stock file.
  - Only lots released after `Stock Date` count as incoming stock.
- **Status** (orders): `Open` / `In Process` → `open`, `Completed` → `closed`, `Rejected` → `cancelled`
  - The open quantity is `Order Qty − Delivered Qty`.
- **Sold-to Code**: present in the order file so the importer can be tested against extra columns. It is ignored and not stored.

## Cases built in on purpose

| Case | Where |
|---|---|
| Stock already below its minimum | 990102 (60 t / min 100), 990401 (90 t / min 100) |
| No stock and nothing in QC | 990202 |
| Large surplus that should reduce the forecast still to produce | 990301 (640 t / min 200) |
| Several storage locations per material | 990101, 990301 |
| Discontinued product that still holds stock | 990104 (`IsActive = 0`) |
| Lot delayed in QC, lot rejected | 990101 produced 11-04 (released 2 days late), 990302 produced 11-02 |
| Overdue order, partly shipped | 990201, 60 t due 2026-11-05, 20 t delivered |
| Order inside the QC window with no stock | 990202, 40 t due 2026-11-10 |
| Orders exceed the forecast (nothing left to produce for the forecast) | BR150L and BR150B in Nov 2026 |
| Planner override of the engine forecast | BR150 Dec 2026, `manual` 2600 over `engine` 2300 |
| Orders beyond a 28-day horizon | everything due in Jan 2027 |

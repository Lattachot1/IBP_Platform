"""Generate the fictitious planning data set in sample_data/mock/.

    cd Backend && python sample_data/generate_mock.py

Every value is made up (seeded random, so re-running gives the same
files). The three sap_*.csv files copy the layout of the client's SAP
billing extract: a title row above the header, the same column names
where they overlap (Material Number, Mat Description, Plant, SU, Sales
Order Number, ...), quantities in tons (SU = TO) and dates as yyyy/mm/dd.
products.csv and forecast_monthly.csv are the platform's own data, so
they use the database column names and ISO dates.

The data describes the morning of Friday 2026-11-06 (stock export date);
the first plan would start on Monday 2026-11-09.
"""

import csv
import random
from datetime import date, timedelta
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "mock"
SEED = 20261106
STOCK_DATE = date(2026, 11, 6)
QC_DAYS = 5
PLANT = "9001"
TITLE = "MOCK DATA - fictitious values for development and tests (not client data)"
CUSTOMERS = ["8%05d" % i for i in range(1, 26)]

# MaterialNo, Description, GroupCode, MinStockTons, IsActive, share of the group's sales
PRODUCTS = [
    ("990101", "UBEPOL BR150 MOCK-A", "BR150", 300, True, 0.70),
    ("990102", "UBEPOL BR150 MOCK-B", "BR150", 100, True, 0.25),
    ("990103", "UBEPOL BR150 MOCK-C", "BR150", 0, True, 0.05),
    ("990104", "UBEPOL BR150 MOCK-D", "BR150", 0, False, 0.0),  # discontinued
    ("990201", "UBEPOL BR150L MOCK-A", "BR150L", 150, True, 0.85),
    ("990202", "UBEPOL BR150L MOCK-B", "BR150L", 30, True, 0.15),
    ("990301", "UBEPOL BR150B MOCK-A", "BR150B", 200, True, 0.65),
    ("990302", "UBEPOL BR150B MOCK-B", "BR150B", 100, True, 0.35),
    ("990401", "UBEPOL BR360B MOCK-A", "BR360B", 100, True, 1.0),
    ("990501", "UBEPOL VCR412 MOCK-A", "VCR412", 150, True, 0.95),
    ("990502", "UBEPOL VCR412 MOCK-B", "VCR412", 0, True, 0.05),
    ("990601", "UBEPOL VCR617 MOCK-A", "VCR617", 100, True, 0.95),
    ("990602", "UBEPOL VCR617 MOCK-B", "VCR617", 0, True, 0.05),
]
DESC = {p[0]: p[1] for p in PRODUCTS}

# Released stock per storage location; 990102 and 990401 start below
# their minimum, 990202 has none, 990301 holds a large surplus.
STOCK = [
    ("990101", "W001", 400.0), ("990101", "W002", 120.0),
    ("990102", "W001", 60.0),
    ("990103", "W001", 35.0),
    ("990104", "W002", 12.0),
    ("990201", "W001", 210.0),
    ("990202", "W001", 0.0),
    ("990301", "W001", 520.0), ("990301", "W002", 120.0),
    ("990302", "W001", 140.0),
    ("990401", "W001", 90.0),
    ("990501", "W001", 300.0),
    ("990502", "W001", 20.0),
    ("990601", "W001", 180.0),
    ("990602", "W002", 8.0),
]

# What the plant made in the days before the export: (first day, last day, group, tons/day)
PRODUCTION = [
    (date(2026, 10, 29), date(2026, 11, 3), "BR150B", 239.0),
    (date(2026, 11, 4), date(2026, 11, 6), "BR150", 230.0),
]
REJECTED_LOT = ("990302", date(2026, 11, 2))        # failed QC -> blocked stock
DELAYED_LOT = ("990101", date(2026, 11, 4), 2)      # re-test: released 2 days late

# Monthly forecast per group (Source = engine) and one planner override.
FORECAST = {
    "BR150": (2400, 2300, 2500),
    "BR150L": (900, 850, 900),
    "BR150B": (1200, 1250, 1150),
    "BR360B": (500, 450, 500),
    "VCR412": (900, 1000, 900),
    "VCR617": (600, 650, 600),
}
MONTHS = (date(2026, 11, 1), date(2026, 12, 1), date(2027, 1, 1))
MANUAL_FORECAST = [("BR150", date(2026, 12, 1), 2600)]
ORDERED_SHARE = (0.85, 0.50, 0.15)   # how much of each month's forecast is already ordered
ORDER_SIZES = (20, 40, 60, 80, 100)


def fmt(tons: float) -> str:
    return ("%.3f" % tons).rstrip("0").rstrip(".")


def sap_date(d: date) -> str:
    return d.strftime("%Y/%m/%d")


def month_end(first: date) -> date:
    nxt = date(first.year + first.month // 12, first.month % 12 + 1, 1)
    return nxt - timedelta(days=1)


def write_csv(name: str, header: list, rows: list, title: bool) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_DIR / name, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        if title:
            writer.writerow([TITLE] + [""] * (len(header) - 1))
        writer.writerow(header)
        writer.writerows(rows)


def products_rows() -> list:
    return [[m, d, g, fmt(mn), 1 if active else 0] for m, d, g, mn, active, _ in PRODUCTS]


def qc_lots() -> list:
    """One inspection lot per product per production day."""
    lots, serial = [], 1
    for first, last, group, per_day in PRODUCTION:
        members = [p for p in PRODUCTS if p[2] == group and p[4]]
        day = first
        while day <= last:
            for material, _, _, _, _, share in members:
                tons = round(per_day * share, 1)
                release = day + timedelta(days=QC_DAYS)
                if (material, day) == DELAYED_LOT[:2]:
                    release += timedelta(days=DELAYED_LOT[2])
                if (material, day) == REJECTED_LOT:
                    decision = "R"
                elif release <= STOCK_DATE:
                    decision = "A"
                else:
                    decision = ""     # still in inspection
                lots.append({
                    "lot": "04%010d" % (5000 + serial),
                    "material": material,
                    "tons": tons,
                    "produced": day,
                    "release": release,
                    "decision": decision,
                })
                serial += 1
            day += timedelta(days=1)
    return lots


def stock_rows(lots: list) -> list:
    in_qc, blocked = {}, {}
    for lot in lots:
        if lot["decision"] == "":
            in_qc[lot["material"]] = in_qc.get(lot["material"], 0.0) + lot["tons"]
        elif lot["decision"] == "R":
            blocked[lot["material"]] = blocked.get(lot["material"], 0.0) + lot["tons"]
    rows, seen = [], set()
    for material, sloc, unrestricted in STOCK:
        first_row = material not in seen   # QC and blocked stock sit in the first location
        seen.add(material)
        rows.append([
            sap_date(STOCK_DATE), material, DESC[material], PLANT, sloc, "TO",
            fmt(unrestricted),
            fmt(in_qc.get(material, 0.0) if first_row else 0.0),
            fmt(blocked.get(material, 0.0) if first_row else 0.0),
        ])
    return rows


def weekday_in(rng: random.Random, first: date, last: date) -> date:
    while True:
        d = first + timedelta(days=rng.randrange((last - first).days + 1))
        if d.weekday() < 5:
            return d


def sales_orders(rng: random.Random) -> list:
    """Order items per group and month until the ordered share of the forecast is reached."""
    items = []
    for group, per_month in FORECAST.items():
        members = [p for p in PRODUCTS if p[2] == group and p[4]]
        weights = [p[5] for p in members]
        for month, forecast, share in zip(MONTHS, per_month, ORDERED_SHARE):
            target, booked = forecast * share, 0.0
            while booked < target:
                material = rng.choices(members, weights=weights)[0][0]
                tons = float(rng.choice(ORDER_SIZES))
                due = weekday_in(rng, month, month_end(month))
                items.append({"material": material, "tons": tons, "due": due})
                booked += tons

    # Cases the planner has to handle, placed by hand.
    items += [
        {"material": "990201", "tons": 60.0, "due": date(2026, 11, 5), "delivered": 20.0},  # overdue, part shipped
        {"material": "990202", "tons": 40.0, "due": date(2026, 11, 10)},   # no stock, nothing in QC
        {"material": "990102", "tons": 80.0, "due": date(2026, 11, 12)},   # pushes stock below minimum
        {"material": "990301", "tons": 300.0, "due": date(2026, 11, 16)},  # large order, covered by surplus
        {"material": "990401", "tons": 60.0, "due": date(2026, 11, 18), "status": "Rejected"},
    ]
    items.sort(key=lambda it: (it["due"], it["material"]))

    rows, order_no = [], 9100000000
    i = 0
    while i < len(items):
        order_no += 1
        customer = rng.choice(CUSTOMERS)
        n_items = 1 if rng.random() < 0.7 else 2
        for pos in range(n_items):
            if i >= len(items):
                break
            it = items[i]
            i += 1
            status = it.get("status")
            delivered = it.get("delivered", 0.0)
            if status is None:
                if it["due"] <= STOCK_DATE and "delivered" not in it:
                    delivered, status = it["tons"], "Completed"
                elif delivered:
                    status = "In Process"
                elif it["tons"] >= 80 and rng.random() < 0.25:
                    delivered, status = it["tons"] / 2, "In Process"   # first half shipped early
                else:
                    status = "Open"
            if status == "Rejected" or (status == "Open" and rng.random() < 0.02):
                status, delivered = "Rejected", 0.0
            rows.append([
                str(order_no), str(10 * (pos + 1)), it["material"], DESC[it["material"]],
                customer, PLANT, fmt(it["tons"]), fmt(delivered), "TO",
                sap_date(it["due"]), status,
            ])
    return rows


def forecast_rows() -> list:
    rows = []
    for group, per_month in FORECAST.items():
        for month, tons in zip(MONTHS, per_month):
            rows.append([group, month.isoformat(), "engine", fmt(tons)])
    for group, month, tons in MANUAL_FORECAST:
        rows.append([group, month.isoformat(), "manual", fmt(tons)])
    return rows


def main() -> None:
    rng = random.Random(SEED)
    lots = qc_lots()

    write_csv("products.csv",
              ["MaterialNo", "Description", "GroupCode", "MinStockTons", "IsActive"],
              products_rows(), title=False)
    write_csv("forecast_monthly.csv",
              ["GroupCode", "ForecastMonth", "Source", "Tons"],
              forecast_rows(), title=False)
    write_csv("sap_stock.csv",
              ["Stock Date", "Material Number", "Mat Description", "Plant", "Storage Location", "SU",
               "Unrestricted", "In Quality Insp.", "Blocked"],
              stock_rows(lots), title=True)
    write_csv("sap_qc_lots.csv",
              ["Inspection Lot", "Material Number", "Mat Description", "Plant", "Lot Qty", "SU",
               "Production Date", "Release Date", "Usage Decision"],
              [[lot["lot"], lot["material"], DESC[lot["material"]], PLANT, fmt(lot["tons"]), "TO",
                sap_date(lot["produced"]), sap_date(lot["release"]), lot["decision"]] for lot in lots],
              title=True)
    write_csv("sap_sales_orders.csv",
              ["Sales Order Number", "Sales Order Item", "Material Number", "Mat Description",
               "Sold-to Code", "Plant", "Order Qty", "Delivered Qty", "SU", "Req. Delivery Date", "Status"],
              sales_orders(rng), title=True)
    print("wrote", ", ".join(sorted(p.name for p in OUT_DIR.glob("*.csv"))), "to", OUT_DIR)


if __name__ == "__main__":
    main()

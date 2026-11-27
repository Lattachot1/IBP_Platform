"""Product-level planning on top of the group schedule (use_planning_data).

The CP-SAT engine keeps every plant rule on the product groups. With
use_planning_data the day's output of each group is also split over the
group's products (alloc), and the plan is scored on three requirement
tiers per product instead of a tons-per-grade demand:

  1. open sales orders shipped on time     (late ton-days, weight W_LATE)
  2. stock kept at or above its minimum    (ton-days below, weight W_BELOW_MIN)
  3. the forecast still to produce         (tons short at each month end, W_FORECAST)

then fewer changeovers, then stock built for the expected demand right
after the horizon (look-ahead, W_LOOKAHEAD), then more output. The
look-ahead gives spare output a sensible home: by each product's share
instead of whichever product the solver happens to pick. The inputs come from the
planning data (planning_data.store): released stock, lots in QC, open
orders, the monthly group forecast and the product master.

Stock logic per product and day d (tons, d = 0 is the plan start):
  available(d) = starting stock (the hand-entered adjustment when there is
                 one, else the imported snapshot value) + QC releases up
                 to d + production up to d - qc_days - open orders due up to d
Orders due before the plan start count as due on day 0. Output enters
stock qc_days after it is produced, so production in the last qc_days of
the horizon only serves the forecast tier.

Forecast tier: per month touching the horizon, the group forecast
('manual' overrides 'engine') minus every order due that month (shipped
or open) is the demand not ordered yet. It is split over the group's
active products by their share of that month's order tons, falling back to
prior months, then an equal split. It is prorated when the month runs past
the horizon and must be produced (not yet QC-released)
by the month end on top of the open orders and the minimum stock: stock
above that counts against it, product by product. For an explicit product
plan, the product's own target minus its orders is used as its monthly
requirement directly.
"""

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, List, Optional

W_LATE = 200            # per ton-day an order is late
W_BELOW_MIN = 20        # per ton-day stock is below its minimum
W_FORECAST = 10         # per ton of forecast not produced by the month end
W_LOOKAHEAD = 2         # per ton of next month's expected demand not built up by the horizon end
W_OUTPUT = 1            # per ton produced (keep the plant loaded once all tiers are met)
STALE_STOCK_DAYS = 7


class MonthlyDemandError(ValueError):
    """A plan's monthly demand does not match its scope or latest orders."""


def _t(value: float) -> int:
    return int(round(value))


@dataclass
class ProductInput:
    material_no: str
    description: str
    group: str
    min_stock: float
    share: float                                   # order mix for splitting a hand-edited schedule
    start_stock: float
    receipts: Dict[int, float] = field(default_factory=dict)   # day index -> QC release tons
    demand: Dict[int, float] = field(default_factory=dict)     # day index -> open order tons due
    expected: Dict[int, float] = field(default_factory=dict)   # month deadline index -> forecast tons
    lookahead: float = 0.0                         # expected demand just after the horizon


@dataclass
class OrderInput:
    order_no: str
    item_no: int
    material_no: str
    open_tons: float
    due_date: date
    due_index: int          # max(0, due - start); may be >= horizon


@dataclass
class MonthInput:
    group: str
    month: date
    forecast: float
    source: str
    ordered: float
    remainder: float
    fraction: float
    deadline: int           # day index of min(month end, horizon end)
    material_no: Optional[str] = None  # explicit demand for one product


@dataclass
class PlanInputs:
    start: date
    horizon: int
    qc_days: int
    snapshot_date: Optional[date]
    products: List[ProductInput]
    orders: List[OrderInput]
    months: List[MonthInput]
    warnings: List[str]

    def by_group(self) -> Dict[str, List[ProductInput]]:
        out: Dict[str, List[ProductInput]] = {}
        for p in self.products:
            out.setdefault(p.group, []).append(p)
        return out


def _month_end(first: date) -> date:
    return first.replace(day=calendar.monthrange(first.year, first.month)[1])


def _effective_forecasts(forecasts) -> Dict[tuple, tuple]:
    """(group, month) -> (tons, source); a 'manual' row overrides 'engine'."""
    out: Dict[tuple, tuple] = {}
    for f in forecasts:
        key = (f.group_code, f.forecast_month)
        if key not in out or f.source == "manual":
            out[key] = (f.tons, f.source)
    return out


@dataclass
class OrderMix:
    product_tons: Dict[tuple, float]
    group_tons: Dict[tuple, float]
    active_by_group: Dict[str, List[str]]
    production_shares: Dict[str, float]

    def forecast_shares(self, month: date) -> Dict[str, float]:
        """Use the target month's mix, then earlier months, then equal shares."""
        history = defaultdict(float)
        for (material, due_month), tons in self.product_tons.items():
            if due_month < month:
                history[material] += tons

        shares = {}
        for materials in self.active_by_group.values():
            weights = [self.product_tons.get((material, month), 0.0) for material in materials]
            if not sum(weights):
                weights = [history[material] for material in materials]
            total = sum(weights)
            for material, weight in zip(materials, weights):
                shares[material] = weight / total if total else 1.0 / len(materials)
        return shares


def _order_totals(products, orders) -> OrderMix:
    """Summarize non-cancelled order tons and eligible products."""
    group_of = {p.material_no: p.group_code for p in products}
    ordered_by_product = defaultdict(float)
    ordered_by_group = defaultdict(float)
    lifetime_tons = defaultdict(float)
    for order in orders:
        group = group_of.get(order.material_no)
        if group is None or order.status == "cancelled":
            continue
        month = order.due_date.replace(day=1)
        ordered_by_product[order.material_no, month] += order.tons
        ordered_by_group[group, month] += order.tons
        lifetime_tons[order.material_no] += order.tons

    active_by_group = defaultdict(list)
    for product in products:
        if product.is_active:
            active_by_group[product.group_code].append(product.material_no)
    production_shares = {}
    for materials in active_by_group.values():
        total = sum(lifetime_tons[material] for material in materials)
        for material in materials:
            production_shares[material] = lifetime_tons[material] / total if total else 1.0 / len(materials)
    return OrderMix(ordered_by_product, ordered_by_group, active_by_group, production_shares)


def product_demand_grid(groups, products, orders, forecasts, months):
    """Break stored group forecasts into editable product totals for the requested months."""
    products = sorted((p for p in products if p.group_code in groups),
                      key=lambda p: (p.group_code, p.description.casefold(), p.material_no))
    order_mix = _order_totals(products, orders)
    shares_by_month = {month: order_mix.forecast_shares(month) for month in months}
    effective = _effective_forecasts(forecasts)
    group_share = defaultdict(float)
    end = _month_end(months[-1])
    open_materials = {o.material_no for o in orders if o.status == "open" and o.open_tons > 0 and o.due_date <= end}
    rows = []
    for product in products:
        material, group = product.material_no, product.group_code
        if not product.is_active and material not in open_materials:
            continue
        cells = []
        for month in months:
            share = shares_by_month[month].get(material, 0.0)
            key = (group, month)
            start_share = group_share[key]
            end_share = start_share + share
            group_share[key] = end_share
            floor = order_mix.product_tons.get((material, month), 0.0)
            group_floor = order_mix.group_tons.get(key, 0.0)
            forecast = effective.get((group, month))
            total = None
            if forecast is not None and product.is_active:
                extra = max(0.0, forecast[0] - group_floor)
                # Round cumulative shares so the product extras still sum to the group extra.
                total = round(floor + round(extra * end_share, 3) - round(extra * start_share, 3), 3)
            cells.append({"month": month, "ordered_tons": floor, "group_ordered_tons": group_floor,
                          "forecast_share": share, "tons": total})
        rows.append({"material_no": material, "description": product.description, "group_code": group,
                     "is_active": product.is_active, "months": cells})
    return rows


def build_inputs(groups: List[str], products, snapshot, lots, orders, forecasts,
                 start: date, horizon: int, qc_days: int,
                 monthly_product_demand: Optional[Dict[date, Dict[str, float]]] = None) -> PlanInputs:
    """Pure function: planning data records -> per-product model inputs."""
    end = start + timedelta(days=horizon - 1)
    warnings: List[str] = []

    open_orders = [o for o in orders if o.status == "open" and o.open_tons > 0]
    with_open_orders = {o.material_no for o in open_orders if o.due_date <= end}
    unassigned = sorted(p.material_no for p in products if p.is_active and p.group_code not in groups)
    if unassigned:
        warnings.append("Not planned (product group not in plant_config.yaml): " + ", ".join(unassigned))
    planned = [p for p in products if p.group_code in groups
               and (p.is_active or p.material_no in with_open_orders)]
    for p in planned:
        if not p.is_active:
            warnings.append("Inactive product %s still has open orders: they are planned" % p.material_no)
    known = {p.material_no for p in planned}

    # stock snapshot; a hand-entered adjustment wins over the imported value
    # (and stands alone when nothing has been imported yet)
    snapshot_date = snapshot.snapshot_date
    stock = {r.material_no: r.on_hand_tons for r in snapshot.rows} if snapshot_date else {}
    adjusted = {a.material_no: a.adjust_tons for a in snapshot.adjustments if a.material_no in known}
    stock.update(adjusted)
    if snapshot_date is None:
        if adjusted:
            warnings.append("No stock snapshot on or before %s: %d materials use hand-entered stock, "
                            "the rest start at 0" % (start, len(adjusted)))
        else:
            warnings.append("No stock snapshot on or before %s: starting stock taken as 0" % start)
    elif adjusted:
        warnings.append("%d materials use hand-entered stock instead of the snapshot of %s"
                        % (len(adjusted), snapshot_date))
    elif (start - snapshot_date).days > STALE_STOCK_DAYS:
        warnings.append("Stock snapshot is %d days old (%s)" % ((start - snapshot_date).days, snapshot_date))

    # QC lots: still in QC, or released after the snapshot was taken
    receipts: Dict[str, Dict[int, float]] = {}
    for lot in lots:
        if lot.material_no not in known or lot.status == "rejected":
            continue
        if lot.status == "released" and snapshot_date is not None and lot.release_date <= snapshot_date:
            continue      # already part of the snapshot
        day = max(0, (lot.release_date - start).days)
        receipts.setdefault(lot.material_no, {})
        receipts[lot.material_no][day] = receipts[lot.material_no].get(day, 0.0) + lot.tons

    # open orders
    order_inputs = []
    demand: Dict[str, Dict[int, float]] = {}
    for o in sorted(open_orders, key=lambda o: (o.due_date, o.order_no, o.item_no)):
        if o.material_no not in known:
            continue
        index = max(0, (o.due_date - start).days)
        order_inputs.append(OrderInput(o.order_no, o.item_no, o.material_no, o.open_tons, o.due_date, index))
        if index < horizon:
            demand.setdefault(o.material_no, {})
            demand[o.material_no][index] = demand[o.material_no].get(index, 0.0) + o.open_tons

    eligible = [p for p in products if p.group_code in groups]
    order_mix = _order_totals(eligible, orders)
    active = {p.material_no: p for p in eligible if p.is_active}
    if monthly_product_demand is not None:
        for month, targets in monthly_product_demand.items():
            if month.day != 1 or not start.replace(day=1) <= month <= end:
                raise MonthlyDemandError(f"Monthly demand must use a month start within the plan: {month}")
            for material, tons in targets.items():
                if material not in active:
                    raise MonthlyDemandError(f"Product is inactive or unavailable for monthly demand: {material}")
                floor = order_mix.product_tons.get((material, month), 0.0)
                if tons < floor - 1e-9:
                    raise MonthlyDemandError(
                        f"{active[material].description} ({material}) {month:%Y-%m}: "
                        f"demand cannot go below the latest order total ({floor:g} t)."
                    )

    effective = _effective_forecasts(forecasts) if monthly_product_demand is None else {}
    forecast_months = {month for _, month in effective}
    shares_by_month = {month: order_mix.forecast_shares(month) for month in forecast_months}
    months: List[MonthInput] = []
    lookahead: Dict[tuple, float] = {}          # (group, month) -> tons just after the horizon
    product_lookahead: Dict[str, float] = defaultdict(float)
    first = start.replace(day=1)
    while first <= end:
        last = _month_end(first)
        from_day = max(first, start)
        to_day = min(last, end)
        fraction = ((to_day - from_day).days + 1) / ((last - from_day).days + 1)
        for g in groups:
            if (g, first) not in effective:
                continue
            tons, source = effective[(g, first)]
            used = order_mix.group_tons.get((g, first), 0.0)
            remainder = max(0.0, tons - used)
            months.append(MonthInput(g, first, tons, source, used, remainder, fraction, (to_day - start).days))
            lookahead[g, first] = remainder * (1.0 - fraction)
        for material, tons in (monthly_product_demand or {}).get(first, {}).items():
            used = order_mix.product_tons.get((material, first), 0.0)
            remainder = max(0.0, tons - used)
            months.append(MonthInput(active[material].group_code, first, tons, "plan", used, remainder,
                                     fraction, (to_day - start).days, material))
            product_lookahead[material] += remainder * (1.0 - fraction)
        first = last + timedelta(days=1)
    if not any(mi.fraction < 1 for mi in months):
        # the horizon ends on a month end: look ahead to the whole next month
        for g in groups:
            if (g, first) in effective:
                tons, _ = effective[(g, first)]
                lookahead[g, first] = max(0.0, tons - order_mix.group_tons.get((g, first), 0.0))

    product_inputs = []
    for p in sorted(planned, key=lambda p: (p.group_code, p.material_no)):
        expected: Dict[int, float] = {}
        for mi in months:
            if mi.material_no == p.material_no:
                allocation = mi.remainder * mi.fraction
            elif mi.material_no is None and mi.group == p.group_code:
                share = shares_by_month[mi.month].get(p.material_no, 0.0)
                allocation = mi.remainder * mi.fraction * share
            else:
                continue
            if allocation > 0:
                expected[mi.deadline] = expected.get(mi.deadline, 0.0) + allocation
        product_inputs.append(ProductInput(
            material_no=p.material_no,
            description=p.description,
            group=p.group_code,
            min_stock=p.min_stock_tons if p.is_active else 0.0,
            share=order_mix.production_shares.get(p.material_no, 0.0),
            start_stock=stock.get(p.material_no, 0.0),
            receipts=receipts.get(p.material_no, {}),
            demand=demand.get(p.material_no, {}),
            expected=expected,
            lookahead=product_lookahead[p.material_no] + sum(
                tons * shares_by_month[month].get(p.material_no, 0.0)
                for (group, month), tons in lookahead.items() if group == p.group_code
            ),
        ))
    return PlanInputs(start, horizon, qc_days, snapshot_date, product_inputs, order_inputs, months, warnings)


def load_inputs(groups: List[str], start: date, horizon: int, qc_days: int,
                monthly_product_demand: Optional[Dict[date, Dict[str, float]]] = None) -> PlanInputs:
    """Read the planning data (database or memory) for a plan starting on `start`.

    Raises planning_data.sql.StoreUnavailable when the database is down.
    """
    from planning_data import products as product_master
    from planning_data import store

    planning = store.get_store()
    return build_inputs(
        groups,
        product_master.get_store().list(),
        planning.stock_snapshot(start),
        planning.qc_lots(),
        planning.sales_orders(),
        planning.forecasts(start.replace(day=1), start + timedelta(days=horizon)) if monthly_product_demand is None else [],
        start, horizon, qc_days, monthly_product_demand,
    )


# ----------------------------------------------------------------------------
# CP-SAT model
# ----------------------------------------------------------------------------
@dataclass
class ProductVars:
    product: ProductInput
    alloc: list                       # per day IntVar
    base: List[float]                 # stock + receipts - orders, cumulative per day
    late: list = field(default_factory=list)        # (day, var or int)
    below_min: list = field(default_factory=list)   # (day, var or int)
    forecast_short: list = field(default_factory=list)  # (deadline, var, expected cumulative)


@dataclass
class PlanModel:
    inputs: PlanInputs
    products: List[ProductVars]
    late_terms: list
    late_const: int
    below_terms: list
    below_const: int
    forecast_terms: list
    lookahead_terms: list


def _cumulative(per_day: Dict[int, float], horizon: int) -> List[float]:
    out, running = [], 0.0
    for d in range(horizon):
        running += per_day.get(d, 0.0)
        out.append(running)
    return out


def attach(m, inputs: PlanInputs, prod, grades: List[str], caps: List[int]) -> PlanModel:
    """Add product allocation and the three requirement tiers to model `m`."""
    H, Q = inputs.horizon, inputs.qc_days
    gi = {g: i for i, g in enumerate(grades)}
    product_vars: List[ProductVars] = []
    for group, members in inputs.by_group().items():
        g = gi[group]
        allocs = [[m.NewIntVar(0, caps[g], "alloc_%s_%d" % (p.material_no, d)) for d in range(H)] for p in members]
        for d in range(H):
            m.Add(sum(a[d] for a in allocs) == prod[d][g])
        for p, alloc in zip(members, allocs):
            receipts = _cumulative(p.receipts, H)
            orders = _cumulative(p.demand, H)
            base = [p.start_stock + receipts[d] - orders[d] for d in range(H)]
            product_vars.append(ProductVars(p, alloc, base))

    late_terms, below_terms, forecast_terms, lookahead_terms = [], [], [], []
    late_const = below_const = 0
    for pv in product_vars:
        p, alloc, base = pv.product, pv.alloc, pv.base
        minimum = _t(p.min_stock)
        for d in range(H):
            ready = [alloc[t] for t in range(d - Q + 1)]      # produced by d - Q, in stock on d
            shortfall = _t(-base[d])
            late = 0
            if shortfall > 0:
                if ready:
                    late = m.NewIntVar(0, shortfall, "late_%s_%d" % (p.material_no, d))
                    m.Add(late >= shortfall - sum(ready))
                    late_terms.append(late)
                else:
                    late = shortfall
                    late_const += shortfall
                pv.late.append((d, late))
            gap = minimum - _t(base[d])
            if minimum > 0 and gap > 0:
                if ready:
                    below = m.NewIntVar(0, minimum, "below_%s_%d" % (p.material_no, d))
                    m.Add(below >= gap - sum(ready) - late)
                    below_terms.append(below)
                else:
                    below = max(0, min(minimum, gap - late))
                    below_const += below
                pv.below_min.append((d, below))
        expected_cum = 0.0
        for deadline in sorted(p.expected):
            expected_cum += p.expected[deadline]
            need = _t(expected_cum + p.min_stock - base[deadline])
            if need <= 0:
                continue
            short = m.NewIntVar(0, need, "fc_%s_%d" % (p.material_no, deadline))
            m.Add(short >= need - sum(alloc[t] for t in range(deadline + 1)))
            forecast_terms.append(short)
            pv.forecast_short.append((deadline, short, expected_cum))
        need = _t(expected_cum + p.lookahead + p.min_stock - base[H - 1])
        if p.lookahead > 0 and need > 0:
            short = m.NewIntVar(0, need, "look_%s" % p.material_no)
            m.Add(short >= need - sum(alloc))
            lookahead_terms.append(short)
    return PlanModel(inputs, product_vars, late_terms, late_const, below_terms, below_const,
                     forecast_terms, lookahead_terms)


def objective_terms(plan: PlanModel):
    """Linear penalty (to subtract from the maximized objective)."""
    return (W_LATE * sum(plan.late_terms) + W_BELOW_MIN * sum(plan.below_terms)
            + W_FORECAST * sum(plan.forecast_terms) + W_LOOKAHEAD * sum(plan.lookahead_terms))


def attach_free(inputs: PlanInputs, prod, grades: List[str], caps: List[int]) -> PlanModel:
    """PlanModel with plain-integer product allocs derived from a GIVEN
    per-day group production (the hand-edited plan) - no CP-SAT model.

    Each day's group output is split across the group's products by order
    share, largest remainder first, so the whole tons always add back to
    the day's total. Everything report() reads (base curves, late / below /
    forecast shortfalls) is recomputed as ints, mirroring attach().
    """
    H, Q = inputs.horizon, inputs.qc_days
    gi = {g: i for i, g in enumerate(grades)}
    product_vars: List[ProductVars] = []
    for group, members in inputs.by_group().items():
        shares = {p.material_no: p.share for p in members}
        allocs: Dict[str, List[int]] = {p.material_no: [0] * H for p in members}
        for d in range(H):
            total = int(prod[d][gi[group]])
            ideal = [(total * shares[p.material_no], p.material_no) for p in members]
            whole = {m: int(f) for f, m in ideal}
            left = total - sum(whole.values())
            order = sorted(ideal, key=lambda fm: (-(fm[0] - whole[fm[1]]), fm[1]))
            for k in range(left):
                whole[order[k % len(order)][1]] += 1
            for m in allocs:
                allocs[m][d] = whole[m]
        for p in members:
            receipts = _cumulative(p.receipts, H)
            orders_cum = _cumulative(p.demand, H)
            base = [p.start_stock + receipts[d] - orders_cum[d] for d in range(H)]
            product_vars.append(ProductVars(p, allocs[p.material_no], base))

    late_terms, below_terms, forecast_terms, lookahead_terms = [], [], [], []
    late_const = below_const = 0
    for pv in product_vars:
        p, alloc, base = pv.product, pv.alloc, pv.base
        minimum = _t(p.min_stock)
        for d in range(H):
            ready = [alloc[t] for t in range(d - Q + 1)]      # produced by d - Q, in stock on d
            shortfall = _t(-base[d])
            late = 0
            if shortfall > 0:
                if ready:
                    late = max(0, shortfall - sum(ready))
                    late_terms.append(late)
                else:
                    late = shortfall
                    late_const += shortfall
                pv.late.append((d, late))
            gap = minimum - _t(base[d])
            if minimum > 0 and gap > 0:
                if ready:
                    below = max(0, min(minimum, gap - sum(ready) - late))
                    below_terms.append(below)
                else:
                    below = max(0, min(minimum, gap - late))
                    below_const += below
                pv.below_min.append((d, below))
        expected_cum = 0.0
        for deadline in sorted(p.expected):
            expected_cum += p.expected[deadline]
            need = _t(expected_cum + p.min_stock - base[deadline])
            if need <= 0:
                continue
            short = max(0, need - sum(alloc[t] for t in range(deadline + 1)))
            forecast_terms.append(short)
            pv.forecast_short.append((deadline, short, expected_cum))
    return PlanModel(inputs, product_vars, late_terms, late_const, below_terms, below_const,
                     forecast_terms, lookahead_terms)


# ----------------------------------------------------------------------------
# report
# ----------------------------------------------------------------------------
def _fifo_ready(order_tons: List[tuple], supply: List[tuple]) -> List[Optional[int]]:
    """First supply day covering each order (orders in due order), or None."""
    supply = sorted(supply)
    ready, have, i, need = [], 0.0, 0, 0.0
    for tons in order_tons:
        need += tons
        while have + 1e-6 < need and i < len(supply):
            have += supply[i][1]
            i += 1
        ready.append(supply[i - 1][0] if have + 1e-6 >= need and i > 0 else (0 if need <= 1e-6 else None))
    return ready


def report(plan: PlanModel, value, dates: List[date]) -> dict:
    """Planning section of the optimize response, from solved values."""
    inputs = plan.inputs
    H, Q, start = inputs.horizon, inputs.qc_days, inputs.start

    def val(x):
        return x if isinstance(x, int) else value(x)

    products_out, alloc_by_day, produced_total = [], [dict() for _ in range(H)], {}
    supply_by_product = {}
    for pv in plan.products:
        p = pv.product
        produced = [value(a) for a in pv.alloc]
        produced_tons = sum(produced)
        produced_total[p.material_no] = produced_tons
        need = net_requirement(p)
        for d, tons in enumerate(produced):
            if tons:
                alloc_by_day[d][p.material_no] = tons
        stock, below_days = [], 0
        for d in range(H):
            ready = sum(produced[: max(0, d - Q + 1)])
            level = pv.base[d] + ready
            stock.append(round(level, 1))
            if p.min_stock > 0 and level < p.min_stock - 0.5:
                below_days += 1
        supply = [(0, p.start_stock)] + sorted(p.receipts.items()) + \
                 [(d + Q, tons) for d, tons in enumerate(produced) if tons]
        supply_by_product[p.material_no] = supply
        products_out.append({
            "material_no": p.material_no,
            "description": p.description,
            "group": p.group,
            "min_stock": p.min_stock,
            "start_stock": round(p.start_stock, 1),
            "qc_release": [round(p.receipts.get(d, 0.0), 1) for d in range(H)],
            "shipped": [round(p.demand.get(d, 0.0), 1) for d in range(H)],
            "produced": produced,
            "stock": stock,
            "end_stock": stock[-1] if stock else round(p.start_stock, 1),
            "days_below_min": below_days,
            "share": round(p.share, 3),
            "lookahead_tons": round(p.lookahead, 1),
            # requirement = orders due in the horizon + minimum stock + the
            # forecast share due in the horizon - starting stock - lots in QC
            "requirement": round(need, 1),
            "shortage": round(max(0.0, need - produced_tons), 1),
        })

    # orders: FIFO per product in due order
    orders_out = []
    by_product: Dict[str, List[OrderInput]] = {}
    for o in inputs.orders:
        by_product.setdefault(o.material_no, []).append(o)
    for material, items in by_product.items():
        ready = _fifo_ready([o.open_tons for o in items], supply_by_product.get(material, []))
        for o, r in zip(items, ready):
            ready_date = start + timedelta(days=r) if r is not None else None
            if ready_date is None:
                status, late_days = ("after_horizon" if o.due_index >= H else "not_covered"), None
            else:
                late_days = max(0, (ready_date - o.due_date).days)
                status = "late" if late_days > 0 else "on_time"
            orders_out.append({
                "order_no": o.order_no, "item_no": o.item_no, "material_no": material,
                "open_tons": o.open_tons, "due_date": o.due_date.isoformat(),
                "ready_date": ready_date.isoformat() if ready_date else None,
                "late_days": late_days, "status": status, "in_horizon": o.due_index < H,
            })
    orders_out.sort(key=lambda o: (o["due_date"], o["order_no"], o["item_no"]))

    # Forecast coverage has both legacy group rows and explicit product rows.
    short_at = defaultdict(float)
    product_short_at = defaultdict(float)
    for pv in plan.products:
        for deadline, var, _ in pv.forecast_short:
            short_at[pv.product.group, deadline] += value(var)
            product_short_at[pv.product.material_no, deadline] += value(var)
    groups_with_forecast_products = {p.group for p in inputs.products if p.share > 0}
    def shortage(mi):
        if mi.material_no is not None:
            return product_short_at[mi.material_no, mi.deadline]
        if mi.group in groups_with_forecast_products:
            return short_at[mi.group, mi.deadline]
        return mi.remainder * mi.fraction

    forecast_out = [{
        **({"material_no": mi.material_no} if mi.material_no is not None else {}),
        "group": mi.group, "month": mi.month.strftime("%Y-%m"), "source": mi.source,
        "forecast": round(mi.forecast, 1), "ordered": round(mi.ordered, 1),
        "not_yet_ordered": round(mi.remainder, 1), "share_in_horizon": round(mi.fraction, 3),
        "to_produce": round(mi.remainder * mi.fraction, 1),
        "deadline": dates[mi.deadline].isoformat(),
        "short_tons": round(shortage(mi), 1),
    } for mi in inputs.months]

    in_horizon = [o for o in orders_out if o["in_horizon"]]
    on_time = [o for o in in_horizon if o["status"] == "on_time"]
    tons_all = sum(o["open_tons"] for o in in_horizon)
    late_ton_days = plan.late_const + sum(value(v) for v in plan.late_terms)
    below_ton_days = plan.below_const + sum(value(v) for v in plan.below_terms)
    kpis = {
        "orders_in_horizon": len(in_horizon),
        "orders_on_time": len(on_time),
        "orders_late": sum(1 for o in in_horizon if o["status"] == "late"),
        "orders_not_covered": sum(1 for o in in_horizon if o["status"] == "not_covered"),
        "on_time_pct": round(len(on_time) / len(in_horizon) * 100, 1) if in_horizon else 100.0,
        "on_time_tons_pct": round(sum(o["open_tons"] for o in on_time) / tons_all * 100, 1) if tons_all else 100.0,
        "late_ton_days": int(late_ton_days),
        "below_min_ton_days": int(below_ton_days),
        "forecast_short_tons": round(sum(f["short_tons"] for f in forecast_out), 1),
    }
    return {
        "planning": {
            "snapshot_date": inputs.snapshot_date.isoformat() if inputs.snapshot_date else None,
            "qc_days": Q,
            "kpis": kpis,
            "products": products_out,
            "orders": orders_out,
            "forecast": forecast_out,
            "warnings": inputs.warnings,
        },
        "alloc_by_day": alloc_by_day,
        "produced_by_product": produced_total,
    }


def net_requirement(p: ProductInput) -> float:
    """Production a product needs over the horizon, ignoring timing."""
    need = sum(p.demand.values()) + p.min_stock + sum(p.expected.values()) \
        - p.start_stock - sum(p.receipts.values())
    return max(0.0, need)


def group_requirements(inputs, grades):
    demand = dict.fromkeys(grades, 0)
    for product in inputs.products:
        demand[product.group] += int(round(net_requirement(product)))
    return demand


def checks(section: dict) -> List[dict]:
    """Constraint-check lines for the planning section (same shape as the engine's)."""
    out = [{"level": "warn", "text": w} for w in section["warnings"]]
    k = section["kpis"]
    orders = [o for o in section["orders"] if o["in_horizon"]]
    late = [o for o in orders if o["status"] in ("late", "not_covered")]
    if not orders:
        out.append({"level": "ok", "text": "No open orders due in this horizon"})
    elif late:
        listed = ", ".join(
            "%s/%d %s %s" % (o["order_no"], o["item_no"], o["material_no"],
                              "%dd late" % o["late_days"] if o["status"] == "late" else "not covered")
            for o in late[:5])
        more = " (+%d more)" % (len(late) - 5) if len(late) > 5 else ""
        out.append({"level": "warn", "text": "%d of %d orders not on time: %s%s"
                    % (len(late), len(orders), listed, more)})
    else:
        out.append({"level": "ok", "text": "All %d orders due in this horizon ship on time" % len(orders)})
    below = [p for p in section["products"] if p["days_below_min"] > 0]
    if below:
        out.append({"level": "warn", "text": "Stock below its minimum: " + ", ".join(
            "%s %dd" % (p["material_no"], p["days_below_min"]) for p in below)})
    elif any(p["min_stock"] > 0 for p in section["products"]):
        out.append({"level": "ok", "text": "Every product stays at or above its minimum stock"})
    short = [f for f in section["forecast"] if f["short_tons"] > 0]
    if short:
        out.append({"level": "warn", "text": "Forecast not fully produced: " + ", ".join(
            "%s %s short %g t" % (f.get("material_no", f["group"]), f["month"], f["short_tons"]) for f in short)})
    elif section["forecast"]:
        out.append({"level": "ok", "text": "Monthly demand above actual orders is covered"})
    unallocated = section.get("unallocated_tons") or {}
    if unallocated:
        out.append({"level": "warn", "text": "Output of groups with no products in the product master: " + ", ".join(
            "%s %d t" % (g, t) for g, t in unallocated.items())})
    if k["late_ton_days"] and not late:
        out.append({"level": "warn", "text": "%d late ton-days (orders due before stock could be replenished)"
                    % k["late_ton_days"]})
    return out

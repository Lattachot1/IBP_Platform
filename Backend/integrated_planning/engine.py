"""Daily deterministic joint pilot, extending the shared CP-SAT factory model.

Production uses integer tons; raw balances use kilograms and integer BOMs.
The objective uses 1e-5 USD units, while reporting unweighted USD separately.
"""
import hashlib
import json
import time
from datetime import date, timedelta
from pathlib import Path

import optimization
from plant_scheduling import engine as factory
from .schemas import IntegratedRequest

MONEY = 100000
PRODUCTS = {p.code: p for p in optimization.PRODUCTS}


def spread(total, days):
    return [total // days + (i < total % days) for i in range(days)]


def demo(horizon=28, start=None):
    h = horizon
    start = start or factory._next_monday(date.today()).isoformat()
    firm, forecast = {}, {}
    for p in optimization.PRODUCTS:
        total = round(p.demand[0] * h / 28)
        booked = round(total * 0.4)
        first = min(14, h)
        firm[p.code] = spread(booked, first) + [0] * (h - first)
        forecast[p.code] = spread(total - booked, h)
    return IntegratedRequest(
        plant={"start_date": start, "horizon_days": h, "time_limit_s": 15},
        opening_fg={p.code: int(p.initial_inventory) for p in optimization.PRODUCTS},
        firm_demand=firm, forecast_residual=forecast,
        raw_pipeline=[{"day": 3, "tons": 700}],
        raw_prices=[1500.0 if i < h // 2 else 1400.0 for i in range(h)],
    ).model_dump()


class JointModel:
    def __init__(self, request):
        self.req = request
        self.stages = []

    def attach(self, m, grades, dates, prod, main, chg, rx12, rx34):
        r, h = self.req, len(dates)
        self.grades, self.dates, self.prod = grades, dates, prod
        self.checkpoints = [d for d in range(h) if d == h - 1 or dates[d].month != dates[d + 1].month]
        self.buy = [m.NewIntVar(0, r["purchase_limit_tons_per_day"] if d + r["purchase_lead_days"] < h else 0, f"buy_{d}") for d in range(h)]
        self.raw = [m.NewIntVar(0, r["raw_storage_tons"] * 1000, f"raw_kg_{d}") for d in range(h)]
        pipeline = [sum(x["tons"] * 1000 for x in r["raw_pipeline"] if x["day"] == d) for d in range(h)]
        for d in range(h):
            order = self.buy[d - r["purchase_lead_days"]] if d >= r["purchase_lead_days"] else 0
            opening = self.raw[d - 1] if d else r["opening_raw_tons"] * 1000
            available = opening + pipeline[d] + 1000 * order
            m.Add(available <= r["raw_storage_tons"] * 1000)
            m.Add(self.raw[d] == available - sum(r["bom_kg_per_ton"][g] * prod[d][i] for i, g in enumerate(grades)))
        self.fg, self.dispatch, self.firm_dispatch, self.short = {}, {}, {}, {}
        for i, g in enumerate(grades):
            upper = r["opening_fg"][g] + sum(x["tons"] for x in r["fg_pipeline"] if x["grade"] == g) + 239 * h
            self.fg[g], self.dispatch[g], self.firm_dispatch[g], self.short[g] = [], [], [], []
            for d in range(h):
                released = prod[d - r["release_lag_days"]][i] if d >= r["release_lag_days"] else 0
                released += sum(x["tons"] for x in r["fg_pipeline"] if x["grade"] == g and x["day"] == d)
                opening = self.fg[g][d - 1] if d else r["opening_fg"][g]
                firm, forecast = r["firm_demand"][g][d], r["forecast_residual"][g][d]
                shipped = m.NewIntVar(0, firm + forecast, f"ship_{g}_{d}")
                booked = m.NewIntVar(0, firm, f"firm_ship_{g}_{d}")
                stock = m.NewIntVar(0, upper, f"fg_{g}_{d}")
                short = m.NewIntVar(0, firm + forecast, f"short_{g}_{d}")
                m.AddMinEquality(shipped, [opening + released, firm + forecast])
                m.AddMinEquality(booked, [opening + released, firm])
                m.Add(stock == opening + released - shipped)
                m.Add(short == firm + forecast - shipped)
                self.fg[g].append(stock); self.dispatch[g].append(shipped)
                self.firm_dispatch[g].append(booked); self.short[g].append(short)
        for lock in r["day_locks"]:
            d = lock["day"]
            m.Add(main[d] == grades.index(lock["grade"]))
            if lock["production"] is not None:
                for i, g in enumerate(grades):
                    m.Add(prod[d][i] == lock["production"].get(g, 0))
            for key, states in (("rx12", rx12), ("rx34", rx34)):
                if lock[key] is not None:
                    m.Add(states[("prod", "clean", "idle").index(lock[key])][d] == 1)
        for lock in r["purchase_locks"]:
            m.Add(self.buy[lock["day"]] == lock["tons"])
        terms, bound = [], 0

        def cost(variable, rate, component, upper, divisor=1):
            nonlocal bound
            coefficient = round(rate * r["weights"][component] * MONEY / divisor)
            terms.append(coefficient * variable)
            bound += abs(coefficient) * upper

        for d in range(h):
            cost(self.buy[d], r["raw_prices"][d], "raw_material", r["purchase_limit_tons_per_day"])
            if d:
                cost(chg[d], optimization.SETUP_COST, "setup", 1)
            for i, g in enumerate(grades):
                cost(prod[d][i], PRODUCTS[g].production_cost, "production", 239)
                cost(self.short[g][d], PRODUCTS[g].shortage_cost, "shortage", r["firm_demand"][g][d] + r["forecast_residual"][g][d])
        for d in self.checkpoints:
            cost(self.raw[d], r["holding_costs"]["raw_material"], "raw_material_holding", r["raw_storage_tons"] * 1000, 1000)
            for g in grades:
                upper = r["opening_fg"][g] + sum(x["tons"] for x in r["fg_pipeline"] if x["grade"] == g) + 239 * h
                cost(self.fg[g][d], r["holding_costs"]["finished_goods"][g], "finished_goods_holding", upper)
        if bound >= 10**18:
            raise ValueError("Requested cost bounds exceed the safe integer objective range")
        self.cost = sum(terms)
        self.shortage = sum(v for row in self.short.values() for v in row)
        self.hints = [*main, *self.buy, *(v for row in prod for v in row), *(v for states in (rx12, rx34) for row in states for v in row)]

    def solve(self, m, seconds):
        from ortools.sat.python import cp_model
        goals = [("weighted_cost", self.cost)] if self.req["policy"] == "weighted_cost" else [("shortage_tons", self.shortage), ("weighted_cost", self.cost)]
        started, incumbent = time.perf_counter(), None
        for index, (name, expression) in enumerate(goals):
            m.Minimize(expression)
            validation = m.Validate()
            if validation:
                raise ValueError("Integrated model validation failed: " + validation[:250])
            solver = cp_model.CpSolver()
            solver.parameters.max_time_in_seconds = max(0.1, (seconds - (time.perf_counter() - started)) / (len(goals) - index))
            solver.parameters.num_search_workers = 8
            status = solver.Solve(m)
            found = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
            self.stages.append({"goal": name, "status": solver.StatusName(status), "value": round(solver.ObjectiveValue(), 4) if found else None,
                                "best_bound": round(solver.BestObjectiveBound(), 4) if found else None,
                                "proven_optimal": status == cp_model.OPTIMAL, "unit": "tons" if name == "shortage_tons" else "weighted 1e-5 USD units"})
            if not found:
                return (incumbent, cp_model.FEASIBLE) if incumbent is not None else (solver, status)
            incumbent = solver
            if status != cp_model.OPTIMAL:
                return solver, status
            if index < len(goals) - 1:
                m.Add(expression == round(solver.ObjectiveValue()))
                m.ClearHints()
                for v in self.hints:
                    m.AddHint(v, solver.Value(v))
        return incumbent, cp_model.OPTIMAL

    def finish(self, payload, solver):
        r, rows = self.req, []
        breakdown = dict.fromkeys(sorted(r["weights"]), 0.0)
        for d, day in enumerate(payload["days"]):
            releases, dispatch, firm_shipped, short, fg = {}, {}, {}, {}, {}
            for i, g in enumerate(self.grades):
                releases[g] = (solver.Value(self.prod[d - r["release_lag_days"]][i]) if d >= r["release_lag_days"] else 0) + sum(x["tons"] for x in r["fg_pipeline"] if x["grade"] == g and x["day"] == d)
                dispatch[g] = solver.Value(self.dispatch[g][d]); firm_shipped[g] = solver.Value(self.firm_dispatch[g][d])
                short[g] = solver.Value(self.short[g][d]); fg[g] = solver.Value(self.fg[g][d])
                breakdown["production"] += solver.Value(self.prod[d][i]) * PRODUCTS[g].production_cost
                breakdown["shortage"] += short[g] * PRODUCTS[g].shortage_cost
                if d in self.checkpoints:
                    breakdown["finished_goods_holding"] += fg[g] * r["holding_costs"]["finished_goods"][g]
            bought = solver.Value(self.buy[d])
            raw_tons = solver.Value(self.raw[d]) / 1000
            arrived = (solver.Value(self.buy[d - r["purchase_lead_days"]]) if d >= r["purchase_lead_days"] else 0) + sum(x["tons"] for x in r["raw_pipeline"] if x["day"] == d)
            consumed = sum(solver.Value(self.prod[d][i]) * r["bom_kg_per_ton"][g] / 1000 for i, g in enumerate(self.grades))
            breakdown["raw_material"] += bought * r["raw_prices"][d]
            breakdown["setup"] += optimization.SETUP_COST * day["chg"]
            if d in self.checkpoints:
                breakdown["raw_material_holding"] += raw_tons * r["holding_costs"]["raw_material"]
            rows.append({"date": day["iso"], "purchase_tons": bought, "receipt_tons": arrived, "raw_consumed_tons": round(consumed, 3),
                         "raw_stock_tons": raw_tons, "releases": releases, "dispatch": dispatch, "firm_dispatch": firm_shipped,
                         "shortage": short, "fg_stock": fg, "production_tons": sum(p["tons"] for p in day["parts"]),
                         "demand_tons": sum(r["firm_demand"][g][d] + r["forecast_residual"][g][d] for g in self.grades)})
        demand = sum(row["demand_tons"] for row in rows)
        short = sum(sum(row["shortage"].values()) for row in rows)
        firm = sum(sum(v) for v in r["firm_demand"].values())
        firm_sent = sum(sum(row["firm_dispatch"].values()) for row in rows)
        wip = [{"grade": g, "tons": solver.Value(self.prod[d][i]), "release_date": (self.dates[d] + timedelta(days=r["release_lag_days"])).isoformat()}
               for d in range(len(rows)) if d + r["release_lag_days"] >= len(rows) for i, g in enumerate(self.grades) if solver.Value(self.prod[d][i])]
        operating = sum(v for k, v in breakdown.items() if k != "shortage")
        payload.update(mode="integrated_cpsat", scope="joint_deterministic_factory_procurement_stock_delivery", overtime_allowed=False)
        payload["input"] = r
        payload["input_signature"] = hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()
        payload["model_signature"] = hashlib.sha256(Path(__file__).read_bytes() + Path(factory.__file__).read_bytes() + Path(factory.CONFIG_PATH).read_bytes()).hexdigest()
        payload["integration"] = {
            "daily": rows, "stages": self.stages, "cost_breakdown": {k: round(v, 2) for k, v in breakdown.items()},
            "weighted_score": round(sum(v * r["weights"][k] for k, v in breakdown.items()), 2),
            "operating_cost_usd": round(operating, 2), "modeled_shortage_loss_usd": round(breakdown["shortage"], 2),
            "demand_tons": demand, "shortage_tons": short, "dispatch_tons": demand - short,
            "fulfillment_pct": round(100 * (1 - short / demand), 2) if demand else 100,
            "firm_shortage_tons": firm - firm_sent, "closing_fg_tons": sum(rows[-1]["fg_stock"].values()),
            "closing_raw_tons": rows[-1]["raw_stock_tons"], "closing_wip_tons": sum(x["tons"] for x in wip), "wip_releases_after_horizon": wip,
            "holding_checkpoints": [self.dates[d].isoformat() for d in self.checkpoints],
            "locks_honored": {"production_days": len(r["day_locks"]), "purchase_days": len(r["purchase_locks"])},
            "optimality_proven": len(self.stages) == (1 if r["policy"] == "weighted_cost" else 2) and all(x["proven_optimal"] for x in self.stages),
        }
        payload["factory_kpis"] = dict(payload["kpis"])
        payload["kpis"].update(fulfillment_pct=payload["integration"]["fulfillment_pct"], shortage_tons=short)
        payload["fulfillment_rows_basis"] = "aggregate production only; integration.daily contains actual due-day dispatch"
        for check in payload["checks"]:
            if check["text"] == "Demand fully met for all grades":
                check["text"] = "Aggregate production covers horizon demand totals; this does not guarantee due-day dispatch after release lag."
            elif check["text"].startswith("Demand not fully met:"):
                check["text"] = check["text"].replace("Demand not fully met:", "Aggregate production below demand totals (not dispatch shortage):", 1)
        payload["assumptions"] = [x for x in payload["assumptions"] if "daily factory model only" not in x] + [
            r["input_note"], "Deterministic pilot, not a stochastic or robust daily formulation; all controls are here-and-now.",
            "Firm orders plus residual forecast; firm orders get first access to available same-grade stock within each day. Unserved demand is lost sales, not backlog.",
            "Receipts arrive before same-day consumption; raw storage capacity applies before consumption. Purchase price is locked on the order date; fixed lead time, no supplier MOQ or tank compatibility.",
            "Operating expense excludes the sunk acquisition cost of opening raw stock and committed pipeline receipts. No revenue or full P&L is modeled.",
            "FG release lag is provisional (default 3 calendar days). End-horizon WIP is reported, not dispatched early. No value/salvage assigned to terminal inventory.",
            "Holding charges apply at calendar month ends and the final partial-month close, with no prorating. Zero rates remove charges, not balances.",
            "Setup cost is an illustrative per-changeover charge, unlike the monthly activation charge. No safety-stock, I/S band, hard service constraint or OT is added.",
            "Time-limited feasible does not mean optimal. Delivery-first proceeds to cost refinement only after proving the minimum shortage.",
        ]
        if r.get("demand_source"):
            source = r["demand_source"]
            payload["integration"]["demand_source_status"] = source["status"]
            payload["assumptions"] += ["Demand forecast snapshot %s: %s; %s path, %s allocation. This provenance describes captured inputs, not proof of company approval or untouched billing data." %
                (source["snapshot_id"][:12], source["status"], source["path"], source["allocation"]), *source["warnings"]]
        return payload


def solve(request: IntegratedRequest):
    r = request.model_dump()
    if r.get("demand_source") and r["demand_source"]["status"] == "modified" and not r["demand_source"]["manual_override_acknowledged"]:
        raise ValueError("Demand changed since the forecast snapshot. Reload the forecast to reconcile firm orders, or explicitly accept the edited demand as manual before solving.")
    plant = {**r["plant"], "demand": {g: sum(r["firm_demand"][g]) + sum(r["forecast_residual"][g]) for g in r["opening_fg"]}}
    result = factory.solve(plant, integration=JointModel(r))
    if not result.get("days"):
        result.update(scope="joint_deterministic_factory_procurement_stock_delivery", input=r, overtime_allowed=False)
        result["message"] += " Check locked days, opening stocks, pipeline arrivals, fixed lead time and full-rate production. No rules were silently relaxed."
    return result

"""Illustrative two-month production and procurement optimization prototype.

The assumptions in this module are deliberately visible demo values. They are
not UBE master data. The model is a conversation aid for confirming business
decisions, cost definitions and constraints before a production model is built.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import math
from pathlib import Path
from typing import Dict, Iterable

import pulp


PERIODS = ["2026-09", "2026-10"]


@dataclass(frozen=True)
class Product:
    code: str
    demand: tuple[float, float]
    initial_inventory: float
    safety_stock: float
    bom: float
    production_cost: float
    holding_cost: float
    shortage_cost: float
    min_batch: float
    max_monthly: float


PRODUCTS = [
    Product("BR150", (1700.0, 1650.0), 330.0, 250.0, 1.02, 145.0, 13.0, 9000.0, 180.0, 2300.0),
    Product("BR150L", (1450.0, 1500.0), 280.0, 220.0, 1.03, 155.0, 14.0, 10000.0, 180.0, 2100.0),
    Product("BR150B", (1050.0, 1100.0), 210.0, 180.0, 1.02, 150.0, 13.0, 8500.0, 150.0, 1700.0),
    Product("VCR617", (1150.0, 1100.0), 220.0, 170.0, 1.04, 175.0, 16.0, 10500.0, 150.0, 1700.0),
    Product("VCR412", (550.0, 600.0), 120.0, 90.0, 1.04, 180.0, 17.0, 11000.0, 100.0, 1000.0),
    Product("BR360B", (250.0, 220.0), 60.0, 45.0, 1.03, 165.0, 15.0, 9500.0, 60.0, 600.0),
]

SCENARIO_SPECS = {
    "low": {
        "label": "Low demand / lower BD",
        "probability": 0.20,
        "demand_multiplier": 0.90,
        "raw_prices": (1322.75, 1080.83),
    },
    "base": {
        "label": "Base planning case",
        "probability": 0.60,
        "demand_multiplier": 1.00,
        "raw_prices": (1503.75, 1401.50),
    },
    "high": {
        "label": "High demand / higher BD",
        "probability": 0.20,
        "demand_multiplier": 1.12,
        "raw_prices": (1688.50, 1807.65),
    },
}

SETUP_COST = 9000.0
RAW_HOLDING_COST = 8.0
SAFETY_GAP_COST = 85.0
SERVICE_VIOLATION_COST = 10000.0
NORMAL_CAPACITY = (5800.0, 5800.0)
INITIAL_RAW_INVENTORY = 1100.0
RAW_STORAGE_CAPACITY = 5000.0
PURCHASE_CAPACITY = (7000.0, 7000.0)
DEFAULT_OBJECTIVE_WEIGHTS = dict.fromkeys((
    "raw_material", "production", "setup", "finished_goods_holding",
    "raw_material_holding", "shortage", "safety_stock_gap", "service_target_violation",
), 1.0)
DEFAULT_OBJECTIVE_WEIGHTS["overtime"] = 0.0  # Legacy request field, never an active decision.
PENALTY_COMPONENTS = {"shortage", "safety_stock_gap", "service_target_violation"}
MODEL_SOURCE_SHA = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def model_signature() -> str:
    """Identify the loaded formulation and fixed master data, not user preferences."""
    payload = {
        "source": MODEL_SOURCE_SHA, "periods": PERIODS,
        "products": [asdict(product) for product in PRODUCTS], "scenarios": SCENARIO_SPECS,
        "costs": [SETUP_COST, RAW_HOLDING_COST, SAFETY_GAP_COST, SERVICE_VIOLATION_COST],
        "limits": [NORMAL_CAPACITY, INITIAL_RAW_INVENTORY, RAW_STORAGE_CAPACITY, PURCHASE_CAPACITY],
        "overtime_allowed": False,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()


def normalize_objective_weights(values: dict | None = None) -> dict:
    if values is None:
        values = {}
    if not isinstance(values, dict) or set(values) - set(DEFAULT_OBJECTIVE_WEIGHTS):
        raise ValueError("unknown objective weight")
    weights = {**DEFAULT_OBJECTIVE_WEIGHTS, **values}
    for key, value in weights.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 20:
            raise ValueError("objective weight %s must be finite and between 0 and 20" % key)
    weights["overtime"] = 0.0
    if not any(weights.values()):
        raise ValueError("at least one objective weight must be positive")
    return weights


def default_holding_costs() -> dict:
    return {"finished_goods": {p.code: p.holding_cost for p in PRODUCTS}, "raw_material": RAW_HOLDING_COST}


def normalize_holding_costs(values: dict | None = None) -> dict:
    if values is None:
        values = {}
    if not isinstance(values, dict) or set(values) - {"finished_goods", "raw_material"}:
        raise ValueError("Unknown holding cost field")
    base = default_holding_costs()
    fg = values.get("finished_goods", {})
    if not isinstance(fg, dict) or set(fg) - set(base["finished_goods"]):
        raise ValueError("Unknown finished-goods grade")
    rates = {"finished_goods": {**base["finished_goods"], **fg}, "raw_material": values.get("raw_material", base["raw_material"])}
    for value in [rates["raw_material"], *rates["finished_goods"].values()]:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100000:
            raise ValueError("Holding costs must be finite rates between 0 and 100000 USD/t/month")
    return rates


def _effective_weights(request: dict) -> dict:
    weights = normalize_objective_weights(request.get("objective_weights"))
    # Preserve older clients' shortage preference without changing the base loss rate.
    weights["shortage"] *= float(request["shortage_penalty_multiplier"])
    return weights


def _round(value: float, digits: int = 1) -> float:
    return round(float(value), digits)


def _scenario_data(request: dict) -> dict:
    demand_factor = 1.0 + float(request["demand_adjustment_pct"]) / 100.0
    price_factor = 1.0 + float(request["raw_price_adjustment_pct"]) / 100.0
    scenarios = {}
    for name, spec in SCENARIO_SPECS.items():
        scenarios[name] = {
            **spec,
            "demands": {
                p.code: [
                    max(0.0, p.demand[t] * spec["demand_multiplier"] * demand_factor)
                    for t in range(len(PERIODS))
                ]
                for p in PRODUCTS
            },
            "raw_prices": [max(0.0, price * price_factor) for price in spec["raw_prices"]],
        }
    return scenarios


def _selected_scenarios(mode: str) -> Iterable[str]:
    return ("base",) if mode == "deterministic" else SCENARIO_SPECS.keys()


def _solve(mode: str, request: dict, scenarios: dict) -> dict:
    if mode not in {"deterministic", "stochastic", "robust"}:
        raise ValueError("unknown optimization mode: %s" % mode)

    scenario_names = list(_selected_scenarios(mode))
    model = pulp.LpProblem("IBP_%s" % mode, pulp.LpMinimize)
    product_by_code = {p.code: p for p in PRODUCTS}
    codes = list(product_by_code)
    periods = range(len(PERIODS))

    production = pulp.LpVariable.dicts("production", (codes, periods), lowBound=0)
    active = pulp.LpVariable.dicts("active", (codes, periods), cat="Binary")
    purchase = pulp.LpVariable.dicts("purchase", periods, lowBound=0)
    raw_inventory = pulp.LpVariable.dicts("raw_inventory", periods, lowBound=0)
    inventory = pulp.LpVariable.dicts("inventory", (scenario_names, codes, periods), lowBound=0)
    shortage = pulp.LpVariable.dicts("shortage", (scenario_names, codes, periods), lowBound=0)
    safety_gap = pulp.LpVariable.dicts("safety_gap", (scenario_names, codes, periods), lowBound=0)
    service_violation = pulp.LpVariable.dicts("service_violation", scenario_names, lowBound=0)
    stockout = pulp.LpVariable.dicts("stockout", (scenario_names, codes, periods), cat="Binary")

    capacity_factor = 1.0 + float(request["capacity_adjustment_pct"]) / 100.0
    normal_capacity = [max(100.0, value * capacity_factor) for value in NORMAL_CAPACITY]

    for t in periods:
        model += (
            pulp.lpSum(production[code][t] for code in codes)
            <= normal_capacity[t],
            "capacity_%s" % t,
        )
        model += purchase[t] <= PURCHASE_CAPACITY[t], "purchase_limit_%s" % t

        raw_used = pulp.lpSum(product_by_code[code].bom * production[code][t] for code in codes)
        previous_raw = INITIAL_RAW_INVENTORY if t == 0 else raw_inventory[t - 1]
        model += raw_inventory[t] == previous_raw + purchase[t] - raw_used
        model += raw_inventory[t] <= RAW_STORAGE_CAPACITY

        for code in codes:
            product = product_by_code[code]
            model += production[code][t] <= product.max_monthly * active[code][t]
            model += production[code][t] >= product.min_batch * active[code][t]

    for scenario_name in scenario_names:
        scenario = scenarios[scenario_name]
        for code in codes:
            product = product_by_code[code]
            for t in periods:
                previous_inventory = (
                    product.initial_inventory if t == 0 else inventory[scenario_name][code][t - 1]
                )
                demand = scenario["demands"][code][t]
                model += (
                    inventory[scenario_name][code][t]
                    == previous_inventory + production[code][t] - demand + shortage[scenario_name][code][t]
                )
                model += shortage[scenario_name][code][t] <= demand
                # Lost sales cannot coexist with positive closing stock of the same grade.
                stock_bound = product.initial_inventory + len(PERIODS) * product.max_monthly
                model += inventory[scenario_name][code][t] <= stock_bound * (1 - stockout[scenario_name][code][t])
                model += shortage[scenario_name][code][t] <= demand * stockout[scenario_name][code][t]
                model += safety_gap[scenario_name][code][t] >= product.safety_stock - inventory[scenario_name][code][t]

    service_target = float(request["service_target_pct"]) / 100.0
    for s in scenario_names:
        model += service_violation[s] >= (
            pulp.lpSum(shortage[s][code][t] for code in codes for t in periods)
            - (1.0 - service_target) * sum(sum(scenarios[s]["demands"][code]) for code in codes)
        )
    if mode == "stochastic":
        expected_shortage = pulp.lpSum(
            scenarios[s]["probability"] * shortage[s][code][t]
            for s in scenario_names for code in codes for t in periods
        )
        expected_demand = sum(
            scenarios[s]["probability"] * scenarios[s]["demands"][code][t]
            for s in scenario_names for code in codes for t in periods
        )
        model += (
            expected_shortage
            <= (1.0 - service_target) * expected_demand
            + pulp.lpSum(scenarios[s]["probability"] * service_violation[s] for s in scenario_names)
        )
    else:
        for s in scenario_names:
            total_shortage = pulp.lpSum(shortage[s][code][t] for code in codes for t in periods)
            total_demand = sum(scenarios[s]["demands"][code][t] for code in codes for t in periods)
            model += total_shortage <= (1.0 - service_target) * total_demand + service_violation[s]

    weights = _effective_weights(request)
    holding = normalize_holding_costs(request.get("holding_costs"))
    common_cost = (
        pulp.lpSum(
            weights["production"] * product_by_code[code].production_cost * production[code][t]
            + weights["setup"] * SETUP_COST * active[code][t]
            for code in codes for t in periods
        )
        + pulp.lpSum(weights["raw_material_holding"] * holding["raw_material"] * raw_inventory[t] for t in periods)
    )

    scenario_costs: Dict[str, pulp.LpAffineExpression] = {}
    for s in scenario_names:
        scenario_costs[s] = (
            common_cost
            + pulp.lpSum(weights["raw_material"] * scenarios[s]["raw_prices"][t] * purchase[t] for t in periods)
            + pulp.lpSum(
                weights["finished_goods_holding"] * holding["finished_goods"][code] * inventory[s][code][t]
                + weights["shortage"] * product_by_code[code].shortage_cost * shortage[s][code][t]
                + weights["safety_stock_gap"] * SAFETY_GAP_COST * safety_gap[s][code][t]
                for code in codes for t in periods
            )
            + weights["service_target_violation"] * SERVICE_VIOLATION_COST * service_violation[s]
        )

    if mode == "deterministic":
        model += scenario_costs["base"]
    elif mode == "stochastic":
        model += pulp.lpSum(scenarios[s]["probability"] * scenario_costs[s] for s in scenario_names)
    else:
        worst_case_cost = pulp.LpVariable("worst_case_cost", lowBound=0)
        for s in scenario_names:
            model += worst_case_cost >= scenario_costs[s]
        model += worst_case_cost

    solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=15, gapRel=0.005)
    model.solve(solver)
    status = pulp.LpStatus[model.status]
    if status not in {"Optimal", "Feasible"}:
        raise RuntimeError("%s optimizer returned %s" % (mode, status))

    decisions = {
        "production": {
            code: [_round(pulp.value(production[code][t]), 4) for t in periods]
            for code in codes
        },
        "active": {
            code: [int(round(pulp.value(active[code][t]) or 0.0)) for t in periods]
            for code in codes
        },
        "overtime": [0.0 for _ in periods],
        "purchase": [_round(pulp.value(purchase[t]), 4) for t in periods],
        "raw_inventory": [_round(pulp.value(raw_inventory[t]), 4) for t in periods],
        "normal_capacity": normal_capacity,
    }
    return {"status": status, "decisions": decisions, "weighted_objective": float(pulp.value(model.objective) or 0.0)}


def _evaluate(mode: str, solved: dict, request: dict, scenarios: dict) -> dict:
    decisions = solved["decisions"]
    product_by_code = {p.code: p for p in PRODUCTS}
    weights = _effective_weights(request)
    holding = normalize_holding_costs(request.get("holding_costs"))
    scenario_rows = []
    scenario_details = {}

    for scenario_name, scenario in scenarios.items():
        components = {
            "raw_material": 0.0,
            "production": 0.0,
            "setup": 0.0,
            "overtime": 0.0,
            "finished_goods_holding": 0.0,
            "raw_material_holding": 0.0,
            "shortage": 0.0,
            "safety_stock_gap": 0.0,
            "service_target_violation": 0.0,
        }
        total_demand = 0.0
        total_shortage = 0.0
        product_detail = {}

        for t in range(len(PERIODS)):
            components["raw_material"] += decisions["purchase"][t] * scenario["raw_prices"][t]
            components["raw_material_holding"] += decisions["raw_inventory"][t] * holding["raw_material"]

        for code, product in product_by_code.items():
            opening_inventory = product.initial_inventory
            product_shortage = 0.0
            ending_inventory = opening_inventory
            for t in range(len(PERIODS)):
                produced = decisions["production"][code][t]
                demand = scenario["demands"][code][t]
                available = opening_inventory + produced
                delivered = min(available, demand)
                short = max(0.0, demand - delivered)
                ending_inventory = max(0.0, available - delivered)
                safety_gap = max(0.0, product.safety_stock - ending_inventory)

                components["production"] += produced * product.production_cost
                components["setup"] += decisions["active"][code][t] * SETUP_COST
                components["finished_goods_holding"] += ending_inventory * holding["finished_goods"][code]
                components["shortage"] += short * product.shortage_cost
                components["safety_stock_gap"] += safety_gap * SAFETY_GAP_COST
                total_demand += demand
                total_shortage += short
                product_shortage += short
                opening_inventory = ending_inventory

            product_detail[code] = {
                "ending_inventory": ending_inventory,
                "shortage": product_shortage,
            }

        service_level = 100.0 if total_demand == 0 else 100.0 * (1.0 - total_shortage / total_demand)
        allowed_shortage = (1.0 - float(request["service_target_pct"]) / 100.0) * total_demand
        components["service_target_violation"] = (
            max(0.0, total_shortage - allowed_shortage) * SERVICE_VIOLATION_COST
        )
        total_cost = sum(components.values())
        scenario_rows.append({
            "scenario": scenario_name,
            "label": scenario["label"],
            "probability": scenario["probability"],
            "total_cost": _round(total_cost),
            "weighted_score": _round(sum(weights[key] * value for key, value in components.items())),
            "operating_cost": _round(sum(value for key, value in components.items() if key not in PENALTY_COMPONENTS)),
            "service_level_pct": _round(service_level, 2),
            "shortage_tons": _round(total_shortage),
            "ending_inventory_tons": _round(sum(v["ending_inventory"] for v in product_detail.values())),
        })
        scenario_details[scenario_name] = {
            "components": components,
            "products": product_detail,
        }

    expected_total_cost = sum(row["probability"] * row["total_cost"] for row in scenario_rows)
    expected_shortage = sum(row["probability"] * row["shortage_tons"] for row in scenario_rows)
    expected_demand = sum(
        scenarios[s]["probability"]
        * sum(sum(scenarios[s]["demands"][p.code]) for p in PRODUCTS)
        for s in scenarios
    )
    expected_service = 100.0 if expected_demand == 0 else 100.0 * (1.0 - expected_shortage / expected_demand)

    expected_components = {
        key: sum(
            scenarios[s]["probability"] * scenario_details[s]["components"][key]
            for s in scenarios
        )
        for key in next(iter(scenario_details.values()))["components"]
    }
    weighted_components = {key: weights[key] * value for key, value in expected_components.items()}

    product_rows = []
    for product in PRODUCTS:
        expected_end = sum(
            scenarios[s]["probability"] * scenario_details[s]["products"][product.code]["ending_inventory"]
            for s in scenarios
        )
        expected_product_shortage = sum(
            scenarios[s]["probability"] * scenario_details[s]["products"][product.code]["shortage"]
            for s in scenarios
        )
        base_demand = sum(scenarios["base"]["demands"][product.code])
        product_rows.append({
            "product": product.code,
            "base_demand_tons": _round(base_demand),
            "planned_production_tons": _round(sum(decisions["production"][product.code])),
            "expected_ending_inventory_tons": _round(expected_end),
            "expected_shortage_tons": _round(expected_product_shortage),
            "safety_stock_tons": product.safety_stock,
        })

    monthly_rows = []
    for t, period in enumerate(PERIODS):
        production_total = sum(decisions["production"][p.code][t] for p in PRODUCTS)
        available_capacity = decisions["normal_capacity"][t]
        monthly_rows.append({
            "period": period,
            "base_demand_tons": _round(sum(scenarios["base"]["demands"][p.code][t] for p in PRODUCTS)),
            "planned_production_tons": _round(production_total),
            "raw_material_purchase_tons": _round(decisions["purchase"][t]),
            "ending_raw_inventory_tons": _round(decisions["raw_inventory"][t]),
            "overtime_tons": _round(decisions["overtime"][t]),
            "capacity_utilization_pct": _round(100.0 * production_total / available_capacity, 1),
            "active_campaigns": sum(decisions["active"][p.code][t] for p in PRODUCTS),
        })

    return {
        "mode": mode,
        "status": solved["status"],
        "expected_total_cost": _round(expected_total_cost),
        "worst_case_cost": _round(max(row["total_cost"] for row in scenario_rows)),
        "expected_operating_cost": _round(sum(value for key, value in expected_components.items() if key not in PENALTY_COMPONENTS)),
        "expected_penalty_cost": _round(sum(value for key, value in expected_components.items() if key in PENALTY_COMPONENTS)),
        "expected_weighted_score": _round(sum(weighted_components.values())),
        "worst_weighted_score": _round(max(row["weighted_score"] for row in scenario_rows)),
        "optimized_weighted_score": _round(solved["weighted_objective"]),
        "objective_weights": weights,
        "holding_cost_rates": holding,
        "overtime_allowed": False,
        "weighted_breakdown": {key: _round(value) for key, value in weighted_components.items()},
        "expected_service_level_pct": _round(expected_service, 2),
        "worst_service_level_pct": _round(min(row["service_level_pct"] for row in scenario_rows), 2),
        "expected_shortage_tons": _round(expected_shortage),
        "total_overtime_tons": _round(sum(decisions["overtime"])),
        "total_purchase_tons": _round(sum(decisions["purchase"])),
        "cost_breakdown": {key: _round(value) for key, value in expected_components.items()},
        "monthly_plan": monthly_rows,
        "product_plan": product_rows,
        "scenario_outcomes": scenario_rows,
    }


def build_demo_comparison(request: dict) -> dict:
    """Solve and compare deterministic, stochastic and robust demo plans."""
    request = {**request, "objective_weights": normalize_objective_weights(request.get("objective_weights")),
               "holding_costs": normalize_holding_costs(request.get("holding_costs"))}
    scenarios = _scenario_data(request)
    results = {}
    for mode in ("deterministic", "stochastic", "robust"):
        solved = _solve(mode, request, scenarios)
        results[mode] = _evaluate(mode, solved, request, scenarios)

    selected_mode = request["strategy"]
    selected = results[selected_mode]
    strategy_comparison = [
        {
            key: result[key]
            for key in (
                "mode",
                "status",
                "expected_total_cost",
                "worst_case_cost",
                "expected_operating_cost",
                "expected_penalty_cost",
                "expected_weighted_score",
                "worst_weighted_score",
                "optimized_weighted_score",
                "expected_service_level_pct",
                "worst_service_level_pct",
                "expected_shortage_tons",
                "total_overtime_tons",
            )
        }
        for result in results.values()
    ]

    return {
        "prototype_status": "illustrative_assumptions",
        "overtime_allowed": False,
        "model_signature": model_signature(),
        "selected_strategy": selected_mode,
        "currency": "USD",
        "unit": "metric_ton",
        "horizon": PERIODS,
        "input": request,
        "strategy_comparison": strategy_comparison,
        "selected_plan": selected,
        "scenario_definitions": [
            {
                "scenario": name,
                "label": scenario["label"],
                "probability": scenario["probability"],
                "demand_multiplier": _round(scenario["demand_multiplier"] * (1.0 + request["demand_adjustment_pct"] / 100.0), 3),
                "raw_prices": [_round(value, 2) for value in scenario["raw_prices"]],
            }
            for name, scenario in scenarios.items()
        ],
        "assumptions_requiring_confirmation": [
            "Planning decisions are monthly for a two-month horizon.",
            "Six product grades share one aggregate production capacity.",
            "Production and purchase timing are controllable decisions. Overtime is prohibited.",
            "Demand and BD price scenarios are correlated low/base/high cases.",
            "Costs, BOM factors, safety stocks and capacities are illustrative.",
            "Objective weights express preferences, not accounting prices or hard priorities.",
            "Service targets and safety stocks are soft: changing weights does not guarantee zero shortage.",
            "Weighted score is separate from unweighted operating expenses and modeled penalties.",
            "Shortage is treated as lost sales; no backlog carries to the next month.",
        ],
        "constraint_summary": [
            "Finished-goods inventory balance by grade and scenario",
            "Raw-material balance with grade-specific BOM consumption",
            "Normal capacity only; no overtime",
            "Minimum production batch and grade activation",
            "Raw-material storage and monthly purchase capacity",
            "Service-level requirement matched to the selected risk strategy",
        ],
    }

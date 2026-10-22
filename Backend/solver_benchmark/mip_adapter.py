"""Bounded CP-SAT integer-model subset to MILP, for offline comparisons only.

Unsupported constraints fail closed. Reification and disjunctions use finite
expression bounds, not a guessed global big-M. Every returned integer solution
must also pass validation against the original CP-SAT constraints.
"""
from dataclasses import dataclass
import math

from ortools.linear_solver import pywraplp
from ortools.sat.python import cp_model


KINDS = ("linear", "bool_or", "bool_and", "exactly_one", "at_most_one", "element", "lin_max")


@dataclass
class Expr:
    terms: dict
    offset: int = 0

    def plus(self, other, multiplier=1):
        terms = dict(self.terms)
        for i, c in other.terms.items():
            terms[i] = terms.get(i, 0) + multiplier * c
        return Expr({i: c for i, c in terms.items() if c}, self.offset + multiplier * other.offset)


class MipAdapter:
    def __init__(self, model, backend, element_formulation="convex_hull"):
        if element_formulation not in ("convex_hull", "disjunctive"):
            raise ValueError("Unknown element formulation")
        self.model = model
        self.proto = model.Proto()
        self.solver = pywraplp.Solver.CreateSolver(backend)
        if self.solver is None:
            raise RuntimeError(f"Solver unavailable: {backend}")
        self.variables, self.bounds = [], []
        for i, v in enumerate(self.proto.variables):
            domain = list(v.domain)
            self.new_var(domain[0], domain[-1], f"v{i}_{v.name}")
        for i, v in enumerate(self.proto.variables):
            if len(v.domain) > 2:
                self.domain(Expr({i: 1}), list(v.domain), [])
        self.constraint_counts = {}
        for c in self.proto.constraints:
            kind = next((k for k in KINDS if getattr(c, "has_" + k)()), None)
            if kind is None:
                raise ValueError("Unsupported CP constraint; benchmark conversion refused")
            self.constraint_counts[kind] = self.constraint_counts.get(kind, 0) + 1
            active = [self.literal(i) for i in c.enforcement_literal]
            if kind == "linear":
                self.domain(Expr(dict(zip(c.linear.vars, c.linear.coeffs))), list(c.linear.domain), active)
            elif kind in ("bool_or", "bool_and", "exactly_one", "at_most_one"):
                literals = [self.literal(i) for i in getattr(c, kind).literals]
                total = Expr({})
                for lit in literals:
                    total = total.plus(lit)
                if kind == "bool_and":
                    for lit in literals:
                        self.between(lit, 1, 1, active)
                elif kind == "bool_or":
                    self.between(total, 1, len(literals), active)
                elif kind == "exactly_one":
                    self.between(total, 1, 1, active)
                else:
                    self.between(total, 0, 1, active)
            elif kind == "element":
                p = c.element
                index, target = self.expression(p.linear_index), self.expression(p.linear_target)
                lo, hi = self.expr_bounds(index)
                choices = [(i, self.expression(e)) for i, e in enumerate(p.exprs) if lo <= i <= hi]
                if choices and not active and element_formulation == "convex_hull" and all(not e.terms for _, e in choices):
                    # Constant lookup tables admit a stronger one-hot formulation.
                    selectors = [self.new_var(0, 1, f"lookup_{len(self.variables)}") for _ in choices]
                    total, selected_index, selected_value = Expr({}), Expr({}), Expr({})
                    for (i, e), s in zip(choices, selectors):
                        total = total.plus(s)
                        selected_index = selected_index.plus(s, i)
                        selected_value = selected_value.plus(s, e.offset)
                    self.between(total, 1, 1, [])
                    self.between(index.plus(selected_index, -1), 0, 0, [])
                    self.between(target.plus(selected_value, -1), 0, 0, [])
                else:
                    self.select(choices, active, lambda i, e, a: (
                        self.between(index, i, i, a), self.between(target.plus(e, -1), 0, 0, a)))
            elif kind == "lin_max":
                target = self.expression(c.lin_max.target)
                choices = [(i, self.expression(e)) for i, e in enumerate(c.lin_max.exprs)]
                for _, e in choices:
                    self.between(target.plus(e, -1), 0, None, active)
                self.select(choices, active, lambda i, e, a: self.between(target.plus(e, -1), None, 0, a))

    def new_var(self, lo, hi, name):
        if not (-10**15 < lo <= hi < 10**15):
            raise ValueError("Finite, safely representable integer bounds are required")
        i = len(self.variables)
        self.variables.append(self.solver.IntVar(lo, hi, name))
        self.bounds.append((lo, hi))
        return Expr({i: 1})

    def literal(self, index):
        i = index if index >= 0 else -index - 1
        if self.bounds[i][0] < 0 or self.bounds[i][1] > 1:
            raise ValueError("Non-Boolean enforcement literal")
        return Expr({i: 1}) if index >= 0 else Expr({i: -1}, 1)

    @staticmethod
    def expression(proto):
        if any(i < 0 for i in proto.vars):
            raise ValueError("Negative integer references are unsupported")
        terms = {}
        for i, c in zip(proto.vars, proto.coeffs):
            terms[i] = terms.get(i, 0) + c
        return Expr(terms, proto.offset)

    def expr_bounds(self, expr):
        lo = hi = expr.offset
        for i, c in expr.terms.items():
            a, b = self.bounds[i]
            lo += c * (a if c >= 0 else b)
            hi += c * (b if c >= 0 else a)
        return lo, hi

    def row(self, expr, lo, hi):
        row = self.solver.RowConstraint(
            -self.solver.infinity() if lo is None else lo - expr.offset,
            self.solver.infinity() if hi is None else hi - expr.offset, "")
        for i, c in expr.terms.items():
            row.SetCoefficient(self.variables[i], c)

    def between(self, expr, lo, hi, active):
        lower, upper = self.expr_bounds(expr)
        inactive = Expr({}, len(active))
        for lit in active:
            inactive = inactive.plus(lit, -1)
        if lo is not None and lo > lower:
            self.row(expr.plus(inactive, lo - lower), lo, None)
        if hi is not None and hi < upper:
            self.row(expr.plus(inactive, -(upper - hi)), None, hi)

    def select(self, choices, active, add_choice):
        if not choices:
            self.between(Expr({}), 1, None, active)
            return
        if len(choices) == 1:
            add_choice(*choices[0], active)
            return
        selectors = [self.new_var(0, 1, f"select_{len(self.variables)}") for _ in choices]
        total = Expr({})
        for s in selectors:
            total = total.plus(s)
        self.between(total, 1, 1, [])
        for (i, expr), selector in zip(choices, selectors):
            add_choice(i, expr, active + [selector])

    def domain(self, expr, domain, active):
        lo, hi = self.expr_bounds(expr)
        intervals = [(max(lo, a), min(hi, b)) for a, b in zip(domain[::2], domain[1::2]) if a <= hi and b >= lo]
        self.select(list(enumerate(intervals)), active,
                    lambda i, interval, a: self.between(expr, *interval, a))

    def minimize(self, objective, scale):
        obj = self.solver.Objective()
        obj.Clear()
        for i, c in objective.terms.items():
            obj.SetCoefficient(self.variables[i], c / scale)
        obj.SetOffset(objective.offset / scale)
        obj.SetMinimization()

    def solution(self):
        raw = [v.solution_value() for v in self.variables[:len(self.proto.variables)]]
        if any(not math.isfinite(x) or abs(x - round(x)) > 1e-5 for x in raw):
            raise ValueError("MILP did not return an integer original-variable assignment")
        return [round(x) for x in raw]


def value(expr, values):
    return expr.offset + sum(c * values[i] for i, c in expr.terms.items())


def validate_original(model, values):
    """Use integer arithmetic for the entire supported source-model subset."""
    p = model.Proto()
    failures = []
    if len(values) != len(p.variables):
        return ["Incorrect assignment length"]
    for i, (v, x) in enumerate(zip(p.variables, values)):
        domain = list(v.domain)
        if not isinstance(x, int) or not any(a <= x <= b for a, b in zip(domain[::2], domain[1::2])):
            failures.append(f"variable {i} domain")
    def lit(i):
        return values[i] if i >= 0 else 1 - values[-i - 1]
    for i, c in enumerate(p.constraints):
        if not all(lit(j) for j in c.enforcement_literal):
            continue
        if c.has_linear():
            x = sum(a * values[j] for j, a in zip(c.linear.vars, c.linear.coeffs))
            domain = list(c.linear.domain)
            ok = any(a <= x <= b for a, b in zip(domain[::2], domain[1::2]))
        elif any(getattr(c, "has_" + k)() for k in ("bool_or", "bool_and", "exactly_one", "at_most_one")):
            kind = next(k for k in ("bool_or", "bool_and", "exactly_one", "at_most_one") if getattr(c, "has_" + k)())
            xs = [lit(j) for j in getattr(c, kind).literals]
            ok = {"bool_or": any(xs), "bool_and": all(xs), "exactly_one": sum(xs) == 1, "at_most_one": sum(xs) <= 1}[kind]
        elif c.has_element():
            q = c.element
            index = value(MipAdapter.expression(q.linear_index), values)
            ok = 0 <= index < len(q.exprs) and value(MipAdapter.expression(q.linear_target), values) == value(MipAdapter.expression(q.exprs[index]), values)
        elif c.has_lin_max():
            q = c.lin_max
            ok = bool(q.exprs) and value(MipAdapter.expression(q.target), values) == max(value(MipAdapter.expression(e), values) for e in q.exprs)
        else:
            raise ValueError("Unsupported source constraint in validation")
        if not ok:
            failures.append(f"constraint {i}")
    return failures


def cp_fixed_check(model, values, seconds=2):
    fixed = model.Clone()
    fixed.ClearObjective()
    for i, x in enumerate(values):
        fixed.Add(fixed.GetIntVarFromProtoIndex(i) == x)
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.max_time_in_seconds = seconds
    status = solver.Solve(fixed)
    return solver.StatusName(status)

# Interactive Manual Planning

Open `/?view=timeline`. The user confirmed simulated data for this phase
and a provisional three-day production-to-delivery lag, with a visible note.

## Interaction

- Drag production campaigns, raw-material arrivals, cleaning blocks and
  simulated deliveries in one-calendar-day increments. Keyboard dragging
  uses Space/Enter, Left/Right and Enter to commit; Escape cancels.
- Resize a campaign's right edge or edit its start date, group and duration.
  Gross quantity follows the company's stated daily group throughput.
- Swap a campaign with its earlier/later neighbor while preserving the
  occupied time window and existing gap. Overlapping blocks must be
  resolved before swapping.
- Add/delete events, change purchase quantities and fixed quotes, or follow
  monthly demo BD prices. A market-linked receipt moved into another month
  takes that month's demo price, not an actual supplier quote.
- Inspect validation findings and jump to their day. Compare service,
  unmet demand, inventory and illustrative cost against the initial draft.
- Undo/redo event edits, save/restore a browser-local draft and export JSON
  containing events, assumptions, daily balances and validation findings.
- Switching views preserves the working draft. A new monthly optimizer
  result does not silently overwrite edits; rebuilding is explicit.

## Daily Simulation

The starting sequence is a heuristic concatenation of rounded-up daily
campaign durations based on the monthly optimizer quantities. It is not a
daily schedule returned by the solver and does not preserve monthly timing
or guarantee the exact original quantities. The standalone fallback uses
the same six demo grades and two months.

Simulated monthly demand is allocated to four due dates per month. These
are not company orders. Each day's operations are evaluated in this order:

1. Complete valid seven-day cleaning and reset the pair's operating age.
2. Receive raw material; flag requested receipts exceeding tank capacity.
3. Simulate production using stated group throughput and provisional
   transition capacity adjustments; consume illustrative BOM quantities.
4. Release each batch after the configured calendar-day lag, before that
   day's deliveries. Initial WIP is assumed zero.
5. Fulfill due quantities from available finished-goods stock. Unmet demand
   is lost sales, not backlog. Moving due dates changes the service basis.
6. Record daily stock, shortages, reactor ages and illustrative cost terms.

Full-day campaign overlaps, unavailable reactor capacity and material-starved
production receive no output credit. Planned output subject to other rule
violations remains a hypothetical diagnostic, not an executable promise.
The conflict count and unverified status must be retained when presenting
metrics. No-OT applies in this separate manual simulator; the existing
monthly optimizer remains unchanged and still permits illustrative OT.

## Rule Coverage

Checks include full-day overlaps, horizon boundaries, contiguous minimum
grade runs, combined VCR blocks of at least eight days, cleaning duration
and simultaneous cleaning, operating age thresholds, the legacy transition
table, known transition loss and weekend/company-holiday VCR-to-BR150
restrictions. The holiday list is empty by default. Initial pair ages are
editable demo zeros, not actual plant state.

Mixed-grade transition-day totals are provisionally assigned to the
incoming grade. The actual split, complete `Allow_GradeChange.xlsx`, incoming
campaign/WIP state, complete reactor cycle ordering, SKU allocation,
contracts, confirmed due dates and I/S policy are not fully modeled.
Minimum runs are checked on the planned contiguous sequence; unavailable
days can still interrupt actual production. Zero detected conflicts is
therefore not a feasibility certificate.

## Financial Interpretation

Only illustrative USD cost is reported, not actual profit or validated
business savings. Purchase, production, setup, FG/RM holding and shortage
penalty are separate terms. Penalty is not necessarily a cash expenditure.
Cost rates, BOM and initial inventories originate from demo assumptions.
Baseline and draft are evaluated by the same daily simulator and current
assumptions; these scores are not comparable to the monthly solver's
expected multi-scenario score. Lower ending stock is not inherently better
without considering delivery and inventory policy.

## Verification

With Node 24 or another Node release that supports TypeScript type stripping:

```powershell
node tests/manual-planning.test.cjs
```

With Playwright and running frontend/backend, `node tests/manual-plan.smoke.cjs`
checks actual pointer/keyboard drag, live recomputation, resize, swap,
undo/redo, findings, receipt dates, monthly pricing, persistence, view changes,
export and confirmation. `PLAYWRIGHT_MODULE` can point to an external
Playwright installation. Captures and exports go to ignored `.ui-qa/`.

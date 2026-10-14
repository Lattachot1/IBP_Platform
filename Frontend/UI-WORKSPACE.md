# Planning Workspace

The default route now contains the redesigned planning workspace. The
previous dashboard remains at `/classic` for comparison.

## Views

- Overview: real billing forecast, demo BD scenarios, modeled cost/service
  metrics, strategy selection and grade allocation.
- Demand intelligence: existing forecast API, two-month default, marginal
  intervals reported separately per month rather than as a total interval.
- Scenario studio: existing three-strategy optimizer API, editable stress
  inputs, cost breakdown, scenario outcomes and monthly/product decisions.
- Interactive plan: a separate manual Gantt and daily what-if simulator.
  See `MANUAL-PLANNING.md` for its provisional assumptions and limited rule
  coverage; it is not the monthly solver's daily execution schedule.
- Decision map: conceptual pipeline, pending integrations, company reactor
  rules and a Sankey allocation based on the returned production quantities.
- Model observatory: existing billing backtest evidence.
- Saved plans: browser-local snapshots, restore/delete and JSON export.

Search, detail drawers, keyboard focus trapping, reduced-motion styles and
responsive navigation are included. Inputs changed since the last solve are
marked unapplied; a stale result cannot be saved as the new scenario.

## Scope and Provenance

No backend, forecasting algorithm, cost formula or optimizer constraint was
changed. This is a presentation and interaction update, not approval of the
existing prototype's business assumptions. The existing optimizer still
allows OT and lacks the detailed reactor/grade/holiday rules; these are
explicitly labeled in the interface. Forecast and optimizer data are not
yet integrated and their horizons can differ.

Local billing was copied from the user-provided Downloads CSV into the
ignored `DemandModel/` directory so the existing forecast engine could run.
No billing data is included in Git. The latest extract-month completeness
is unverified. Retraining with the existing engine in October includes
September if present in the extract; this UI update does not revise its
incomplete-month detection logic.

The facility photograph is a private-prototype reference asset. See
`public/images/ATTRIBUTION.md`; replace with a company-approved asset before
public distribution.

## Local Preview

The default homepage now opens **Executive cockpit** (`/?view=executive`):
a standalone mock operating picture, Three.js factory, disruption tests,
response comparisons and a four-chapter presentation mode. The prior
overview remains at `/?view=overview`. See `EXECUTIVE-COCKPIT.md` for exact
provenance, financial interpretation and implementation limitations.

The **Logistics globe** view (`/?view=logistics`) adds an independent mock
shipment network with a Three.js Earth, date playback, editable receipt and
delivery schedules, transit stress and arrival-buffer visualization. It is
not connected to inventory or optimizer decisions. See
`LOGISTICS-GLOBE.md` for the data contract, metric interpretation and checks.

Start the existing backend from `Backend/` on port 8080 with the project's
Python environment: `python -m uvicorn main:app --host 127.0.0.1 --port 8080`.
With Node on PATH, run `npm run dev -- -p 3000` from `Frontend/`.

## UI Verification

`tests/workspace.smoke.cjs` uses Playwright against running local servers.
Install Playwright in the test environment, then run
`node tests/workspace.smoke.cjs` from `Frontend/`. `PLAYWRIGHT_MODULE` can
point to an externally installed Playwright package. `UI_BROWSER` defaults
to `msedge`; use an installed Playwright-supported browser channel.

The test covers desktop/mobile views, chart and photo rendering, actual
solver invocation, unapplied-input state, local snapshot persistence,
restore, export, search, drawer focus, offline behavior and `/classic`.
Screenshots are written to the ignored `.ui-qa/` directory.

"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Focus,
  Globe2,
  Package,
  Pause,
  Play,
  RotateCcw,
  Ship,
  Timer,
  TriangleAlert,
} from "lucide-react";
import {
  DEMO_DAYS,
  DEMO_START,
  MOCK_SHIPMENTS,
  PORTS,
  Shipment,
  dateDay,
  dayISO,
  dayLabel,
  greatCircleKm,
  port,
  shipmentState,
  summarizeShipments,
} from "../lib/logisticsDemo";

const WorldGlobe = dynamic(() => import("./WorldGlobe"), {
  ssr: false,
  loading: () => (
    <div className="world-globe">
      <span className="globe-status">Loading 3D scene...</span>
    </div>
  ),
});
const nf = (n: number, decimals = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: decimals });
type Filter = "all" | "inbound" | "outbound";
function Tool({
  label,
  children,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function LogisticsGlobeStudio({ active }: { active: boolean }) {
  const [shipments, setShipments] = useState<Shipment[]>(
    MOCK_SHIPMENTS.map((s) => ({ ...s })),
  );
  const [selected, setSelected] = useState("OUT-001");
  const [filter, setFilter] = useState<Filter>("all");
  const [day, setDay] = useState(18);
  const [delay, setDelay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [focus, setFocus] = useState({ port: "th", revision: 0 });
  useEffect(() => {
    setRotating(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setDay((d) => {
          if (d >= DEMO_DAYS - 1) {
            setPlaying(false);
            return d;
          }
          return d + 1;
        }),
      850,
    );
    return () => clearInterval(timer);
  }, [playing]);
  const visible = useMemo(
    () => shipments.filter((s) => filter === "all" || s.direction === filter),
    [shipments, filter],
  );
  const current = visible.find((s) => s.id === selected) || visible[0];
  const totals = summarizeShipments(visible, day, delay);
  const baseline = summarizeShipments(visible, day, 0);
  const original = summarizeShipments(
    MOCK_SHIPMENTS.filter((s) => filter === "all" || s.direction === filter),
    day,
    0,
  );
  const state = shipmentState(current, day, delay);
  const originalShipment = MOCK_SHIPMENTS.find((s) => s.id === current.id)!;
  const baselineArrival = shipmentState(current, day, 0).arrival;
  const originalArrival = shipmentState(originalShipment, day, 0).arrival;
  const destinations = new Set(visible.map((s) => s.destination)).size;
  const buffers = visible
    .map((s) => ({ ...s, ...shipmentState(s, day, delay) }))
    .sort((a, b) => a.slack - b.slack);
  const maxBuffer = Math.max(5, ...buffers.map((s) => Math.abs(s.slack)));
  const edit = (key: keyof Shipment, value: string | number) =>
    setShipments((rows) =>
      rows.map((s) => (s.id === current.id ? { ...s, [key]: value } : s)),
    );
  const choose = (id: string, moveCamera = false) => {
    setSelected(id);
    if (moveCamera) {
      const s = shipments.find((s) => s.id === id);
      if (s)
        setFocus((f) => ({ port: s.destination, revision: f.revision + 1 }));
    }
  };
  const reset = () => {
    if (!window.confirm("Reset all mock shipment edits and transit stress?"))
      return;
    setShipments(MOCK_SHIPMENTS.map((s) => ({ ...s })));
    setDelay(0);
    setDay(18);
    setPlaying(false);
  };
  const download = () => {
    const payload = {
      schema_version: 1,
      status: "mock_logistics_not_live_not_connected_to_optimizer",
      exported_at: new Date().toISOString(),
      start_date: DEMO_START,
      day,
      transit_stress_days: delay,
      ports: PORTS,
      shipments,
      evaluated_shipments: shipments.map((s) => ({
        ...s,
        ...shipmentState(s, day, delay),
        departure_date: dayISO(s.departure),
        arrival_date: dayISO(shipmentState(s, day, delay).arrival),
        due_date: dayISO(s.dueDay),
      })),
      full_network_metrics: summarizeShipments(shipments, day, delay),
      assumptions: [
        "All partners, shipment dates, quantities, freight and travel times are mock.",
        "Port coordinates are approximate, not verified UBE locations.",
        "Arcs are great-circle connections, not navigable sea routes or vessel tracking.",
        "Every shipment receives the same additive transit stress, including planned and historically departed mock shipments.",
        "On-time share is quantity-weighted against mock receipt/delivery due dates across the entire schedule, not an observed service level.",
        "Freight excludes cargo purchase cost, demurrage, inventory and shortage costs.",
        "Independent logistics sandbox. No changes to production, stocks or the optimizer.",
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "ube-mock-logistics.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!active) return null;
  return (
    <div className="logistics-studio">
      <div className="logistics-toolbar">
        <div
          className="logistics-segments"
          role="group"
          aria-label="Shipment direction"
        >
          {(["all", "inbound", "outbound"] as Filter[]).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? (
                <Globe2 size={15} />
              ) : f === "inbound" ? (
                <ArrowDownLeft size={15} />
              ) : (
                <ArrowUpRight size={15} />
              )}
              {f === "all"
                ? "All flows"
                : f === "inbound"
                  ? "Raw material"
                  : "Finished goods"}
            </button>
          ))}
        </div>
        <span className="logistics-provenance">
          <span className="tiny-dot" />
          MOCK NETWORK / SEP-OCT 2026
        </span>
        <div className="logistics-tools">
          <Tool label="Reset mock shipments" onClick={reset}>
            <RotateCcw size={17} />
          </Tool>
          <button className="button" onClick={download}>
            <Download size={15} />
            Export mock network
          </button>
        </div>
      </div>
      <div className="logistics-metrics">
        <div>
          <span>Selected network volume</span>
          <strong>
            {nf(totals.tons)}
            <small>t</small>
          </strong>
          <em>
            {visible.length} shipments / {destinations} receiving ports
          </em>
        </div>
        <div>
          <span>In transit on {dayLabel(day)}</span>
          <strong>
            {nf(totals.inTransit)}
            <small>t</small>
          </strong>
          <em>{nf(totals.arrived)} t arrived</em>
        </div>
        <div className={totals.lateCount ? "risk" : ""}>
          <span>Projected late volume</span>
          <strong>
            {nf(totals.lateTons)}
            <small>t</small>
          </strong>
          <em>
            {totals.lateCount} of {visible.length} shipments / full schedule
          </em>
        </div>
        <div>
          <span>Illustrative freight</span>
          <strong>
            ${nf(totals.freight / 1000, 1)}
            <small>k</small>
          </strong>
          <em>
            {totals.freight === original.freight
              ? "Mock rates / excludes cargo value"
              : `${totals.freight > original.freight ? "+" : "-"}$${nf(Math.abs(totals.freight - original.freight))} vs original mock`}
          </em>
        </div>
      </div>
      <section className="logistics-world" aria-label="Global shipment network">
        <div className="globe-stage">
          <div className="globe-overlay-top">
            <div>
              <span className="globe-eyebrow">SUPPLY NETWORK</span>
              <h2>Materials in. Products out.</h2>
              <span className="globe-date">
                <Ship size={14} />
                {dayLabel(day)} 2026
              </span>
            </div>
            <div className="globe-controls">
              <Tool
                label="Auto rotate globe"
                pressed={rotating}
                onClick={() => setRotating((v) => !v)}
              >
                <Globe2 size={18} />
              </Tool>
              <Tool
                label="Focus Thailand hub"
                onClick={() =>
                  setFocus((f) => ({ port: "th", revision: f.revision + 1 }))
                }
              >
                <Focus size={18} />
              </Tool>
            </div>
          </div>
          <WorldGlobe
            shipments={visible}
            day={day}
            delay={delay}
            selected={current.id}
            rotating={rotating}
            focus={focus}
            onSelect={(id) => choose(id)}
          />
          <div className="globe-legend">
            <span>
              <i className="inbound" />
              Raw material
            </span>
            <span>
              <i className="outbound" />
              Finished goods
            </span>
            <span>
              <i className="late" />
              Late arrival
            </span>
          </div>
          <div className="globe-footnote">
            Schematic connections / not vessel tracking or navigable sea routes
          </div>
        </div>
        <aside className="route-inspector" aria-label="Selected shipment">
          <div className="route-inspector-header">
            <span className="eyebrow">SHIPMENT INSPECTOR</span>
            <span className="label-chip">Mock</span>
          </div>
          <div className="route-identity">
            <span>{current.id}</span>
            <strong>{current.product}</strong>
            <small>{current.partner}</small>
          </div>
          <div className="route-endpoints">
            <div>
              <i />
              <span>
                ORIGIN<strong>{port(current.origin).name}</strong>
                <small>{port(current.origin).country}</small>
              </span>
              <Tool
                label="Focus origin"
                onClick={() =>
                  setFocus((f) => ({
                    port: current.origin,
                    revision: f.revision + 1,
                  }))
                }
              >
                <Focus size={16} />
              </Tool>
            </div>
            <div>
              <i />
              <span>
                DESTINATION<strong>{port(current.destination).name}</strong>
                <small>{port(current.destination).country}</small>
              </span>
              <Tool
                label="Focus destination"
                onClick={() =>
                  setFocus((f) => ({
                    port: current.destination,
                    revision: f.revision + 1,
                  }))
                }
              >
                <Focus size={16} />
              </Tool>
            </div>
          </div>
          <div className="route-state">
            <span className={state.lateDays ? "late" : ""}>
              {state.lateDays ? (
                <TriangleAlert size={15} />
              ) : (
                <Ship size={15} />
              )}
              {state.status}
            </span>
            <strong>
              {state.lateDays
                ? `${state.lateDays} days late at arrival`
                : `${state.slack} days arrival buffer`}
            </strong>
          </div>
          <div className="route-progress">
            <span style={{ width: `${state.progress * 100}%` }} />
          </div>
          <div className="route-edit-grid">
            <label>
              Departure
              <input
                type="date"
                aria-label="Shipment departure"
                value={dayISO(current.departure)}
                min={DEMO_START}
                max={dayISO(DEMO_DAYS - 1)}
                onChange={(e) => {
                  if (e.target.value)
                    edit(
                      "departure",
                      Math.max(
                        0,
                        Math.min(DEMO_DAYS - 1, dateDay(e.target.value)),
                      ),
                    );
                }}
              />
            </label>
            <label>
              Required arrival
              <input
                type="date"
                aria-label="Required shipment arrival"
                value={dayISO(current.dueDay)}
                min={DEMO_START}
                max={dayISO(DEMO_DAYS + 90)}
                onChange={(e) => {
                  if (e.target.value)
                    edit(
                      "dueDay",
                      Math.max(
                        0,
                        Math.min(DEMO_DAYS + 90, dateDay(e.target.value)),
                      ),
                    );
                }}
              />
            </label>
            <label>
              Transit days
              <input
                type="number"
                aria-label="Shipment transit days"
                min="1"
                max="90"
                value={current.transitDays}
                onChange={(e) =>
                  edit(
                    "transitDays",
                    Math.max(
                      1,
                      Math.min(90, Math.round(Number(e.target.value))),
                    ),
                  )
                }
              />
            </label>
            <label>
              Quantity / t
              <input
                type="number"
                aria-label="Shipment quantity"
                min="1"
                max="10000"
                value={current.tons}
                onChange={(e) =>
                  edit(
                    "tons",
                    Math.max(1, Math.min(10000, Number(e.target.value))),
                  )
                }
              />
            </label>
            <label className="wide">
              Freight / USD per t
              <input
                type="number"
                aria-label="Shipment freight rate"
                min="0"
                max="2000"
                value={current.freightPerTon}
                onChange={(e) =>
                  edit(
                    "freightPerTon",
                    Math.max(0, Math.min(2000, Number(e.target.value))),
                  )
                }
              />
            </label>
          </div>
          <div className="route-arrival">
            <span>Scenario arrival</span>
            <strong data-testid="scenario-arrival">
              {dayLabel(state.arrival)}
            </strong>
            <small>
              Original mock: {dayLabel(originalArrival)} / edited, no stress:{" "}
              {dayLabel(baselineArrival)}
            </small>
            {state.arrival >= DEMO_DAYS && (
              <small className="late">Beyond displayed horizon</small>
            )}
          </div>
          <div className="route-distance">
            <span>
              {nf(
                greatCircleKm(port(current.origin), port(current.destination)),
              )}{" "}
              km great-circle
            </span>
            <span>Not sailing distance</span>
          </div>
        </aside>
      </section>
      <section className="logistics-time" aria-label="Shipment time controls">
        <div className="logistics-time-head">
          <div>
            <span className="eyebrow">NETWORK SNAPSHOT</span>
            <h3>{dayLabel(day)} 2026</h3>
          </div>
          <div className="logistics-time-buttons">
            <Tool
              label="Previous shipment day"
              disabled={day === 0}
              onClick={() => {
                setPlaying(false);
                setDay((d) => Math.max(0, d - 1));
              }}
            >
              <ChevronLeft size={17} />
            </Tool>
            <Tool
              label={
                playing ? "Pause shipment timeline" : "Play shipment timeline"
              }
              pressed={playing}
              onClick={() => {
                if (day === DEMO_DAYS - 1) setDay(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </Tool>
            <Tool
              label="Next shipment day"
              disabled={day === DEMO_DAYS - 1}
              onClick={() => {
                setPlaying(false);
                setDay((d) => Math.min(DEMO_DAYS - 1, d + 1));
              }}
            >
              <ChevronRight size={17} />
            </Tool>
          </div>
        </div>
        <input
          className="network-day-slider"
          type="range"
          min="0"
          max={DEMO_DAYS - 1}
          value={day}
          aria-label="Network snapshot day"
          onChange={(e) => {
            setPlaying(false);
            setDay(Number(e.target.value));
          }}
        />
        <div className="time-ticks">
          <span>1 Sep</span>
          <span>15 Sep</span>
          <span>1 Oct</span>
          <span>15 Oct</span>
          <span>31 Oct</span>
        </div>
      </section>
      <section
        className="logistics-stress"
        aria-label="Transit delay experiment"
      >
        <div className="stress-setting">
          <span className="eyebrow">TRANSIT STRESS / ALL SHIPMENTS</span>
          <label htmlFor="sea-delay">
            <Timer size={17} />
            Additional transit time<strong>+{delay} days</strong>
          </label>
          <input
            id="sea-delay"
            aria-label="Additional transit delay"
            type="range"
            min="0"
            max="20"
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
          />
          <div className="time-ticks">
            <span>+0 days</span>
            <span>+20 days</span>
          </div>
        </div>
        <div className="stress-outcome">
          <span>Projected on-time volume share</span>
          <div>
            <strong>{nf(baseline.onTimePct, 1)}%</strong>
            <ArrowRight size={22} />
            <strong
              className={
                totals.onTimePct < baseline.onTimePct ? "late" : "green"
              }
              data-testid="network-ontime"
            >
              {nf(totals.onTimePct, 1)}%
            </strong>
          </div>
          <small>
            Edited schedule without stress vs with stress / selected direction
          </small>
        </div>
        <div className="stress-exposure">
          <span>Inbound arrivals beyond requirement</span>
          <strong>
            {nf(
              summarizeShipments(
                shipments.filter((s) => s.direction === "inbound"),
                day,
                delay,
              ).lateTons,
            )}{" "}
            t
          </strong>
          <small>Supply timing flag only / not computed stockout</small>
        </div>
      </section>
      <section
        className="logistics-buffer"
        aria-label="Shipment arrival buffers"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">COMMITMENT EXPOSURE</span>
            <h2>Arrival buffer / days</h2>
          </div>
          <span className="source-badge muted">
            Scenario arrival vs required date / sorted by smallest buffer
          </span>
        </div>
        <div className="buffer-axis">
          <span>-{maxBuffer}d / Late</span>
          <span>Due date</span>
          <span>+{maxBuffer}d / Early</span>
        </div>
        <div className="buffer-lanes">
          {buffers.map((s) => (
            <button
              key={s.id}
              aria-label={`Inspect arrival buffer ${s.id}`}
              className={`buffer-row ${s.id === current.id ? "selected" : ""}`}
              onClick={() => choose(s.id, true)}
            >
              <span className="buffer-name">
                <strong>{s.id}</strong>
                <small>{port(s.destination).name}</small>
              </span>
              <span className="buffer-track">
                <i
                  style={{
                    left:
                      s.slack < 0
                        ? `${50 - (Math.abs(s.slack) / maxBuffer) * 48}%`
                        : "50%",
                    width: `${Math.max(0.4, (Math.abs(s.slack) / maxBuffer) * 48)}%`,
                    background: s.slack < 0 ? "#d78063" : "#48a88e",
                  }}
                />
              </span>
              <strong className={s.slack < 0 ? "late" : "green"}>
                {s.slack > 0 ? "+" : ""}
                {s.slack}d
              </strong>
            </button>
          ))}
        </div>
      </section>
      <section className="logistics-ledger" aria-label="Shipment ledger">
        <div className="section-heading">
          <div>
            <span className="eyebrow">RECEIPTS & DELIVERIES</span>
            <h2>Every route, every commitment.</h2>
          </div>
          <span className="source-badge muted">
            Independent mock / not optimizer output
          </span>
        </div>
        <div className="shipment-table-wrap">
          <table className="shipment-table">
            <thead>
              <tr>
                <th>Shipment / flow</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Product / tons</th>
                <th>Departure</th>
                <th>Arrival / required</th>
                <th>Schedule</th>
                <th>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const t = shipmentState(s, day, delay);
                return (
                  <tr
                    key={s.id}
                    className={s.id === current.id ? "selected" : ""}
                  >
                    <td>
                      <button
                        aria-label={`Select shipment ${s.id}`}
                        onClick={() => choose(s.id, true)}
                      >
                        {s.direction === "inbound" ? (
                          <ArrowDownLeft size={16} />
                        ) : (
                          <ArrowUpRight size={16} />
                        )}
                        <span>
                          {s.id}
                          <small>{s.direction}</small>
                        </span>
                      </button>
                    </td>
                    <td>{port(s.origin).name}</td>
                    <td>{port(s.destination).name}</td>
                    <td>
                      <strong>{s.product}</strong>
                      <small>{nf(s.tons)} t</small>
                    </td>
                    <td>{dayLabel(s.departure)}</td>
                    <td>
                      <strong>{dayLabel(t.arrival)}</strong>
                      <small>Due {dayLabel(s.dueDay)}</small>
                    </td>
                    <td>
                      <span
                        className={`route-schedule ${t.lateDays ? "late" : "green"}`}
                      >
                        {t.lateDays ? (
                          <TriangleAlert size={13} />
                        ) : (
                          <Check size={13} />
                        )}
                        {t.lateDays
                          ? `+${t.lateDays}d late`
                          : `${t.slack}d buffer`}
                      </span>
                    </td>
                    <td>
                      <span className="shipment-snapshot">
                        <Package size={13} />
                        {t.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="logistics-disclosure">
          <TriangleAlert size={15} />
          <span>
            Mock counterparties, volumes, dates, freight and transit times.
            Approximate port locations. No stock, production or optimizer
            updates from this sandbox.
          </span>
        </div>
      </section>
    </div>
  );
}

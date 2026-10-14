import type { ExecutiveOption, ExecutiveShock } from "./executiveDemo";

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const n = (value: number, digits = 0) =>
  value.toLocaleString("en-US", { maximumFractionDigits: digits });
const money = (value: number) => `${value < 0 ? "-" : ""}$${n(Math.abs(value))}`;
export function executiveBriefHtml({
  shock,
  options,
  selectedId,
  baselineCost,
  reviewed,
  note,
}: {
  shock: ExecutiveShock;
  options: ExecutiveOption[];
  selectedId: string;
  baselineCost: number;
  reviewed: Record<string, boolean>;
  note: string;
}) {
  const selected = options.find((option) => option.id === selectedId)!;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UBE Executive Discussion Brief - MOCK</title><style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#244039;margin:30px auto;padding:0 24px;max-width:1000px;font-size:12px;line-height:1.6}header{border-bottom:3px solid #278d75;padding-bottom:16px;display:flex;justify-content:space-between;gap:20px}h1{font-size:25px;line-height:1.3;margin:6px 0}h2{font-size:15px;margin:20px 0 10px}.eyebrow{font-size:10px;color:#608474}small{font-size:10px;color:#728679}.mock{font-weight:bold;color:#ab6a46}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;border-bottom:1px solid #dce7df;padding:20px 0}.metrics span{display:block;font-size:10px;color:#708577}.metrics strong{display:block;font-size:20px;font-weight:500;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;background:#edf3ef;color:#627d6b;font-weight:500}td,th{border-bottom:1px solid #dce7df;padding:10px;vertical-align:top}tr.selected{background:#f0f8f3}td strong{display:block}.condition{font-size:10px;margin-top:4px;color:#708675}.caution{background:#fff5ea;border-left:3px solid #c88a5d;padding:12px;margin:15px 0;color:#8a6848}.note{white-space:pre-wrap;overflow-wrap:anywhere;border-top:1px solid #dce7df;padding-top:12px}.review{display:flex;justify-content:space-between;border-bottom:1px solid #e4ece5;padding:7px 0;gap:15px}footer{border-top:1px solid #dce7df;font-size:10px;color:#8b9888;margin-top:22px;padding-top:10px}.print{font-size:12px;color:#32614b;background:#fff;border:1px solid #aacbbb;padding:8px 12px;cursor:pointer}@media(max-width:600px){.metrics{grid-template-columns:1fr 1fr}body{padding:0 12px}header{flex-direction:column}table{font-size:10px}td,th{padding:7px}}@page{size:A4;margin:15mm}@media print{body{margin:0;padding:0;max-width:none;font-size:11px}.print{display:none}tr{break-inside:avoid}h2{break-after:avoid}header{padding-bottom:10px}.metrics{padding:12px 0}.metrics strong{font-size:18px}}
  </style></head><body><header><div><span class="eyebrow">UBE / EXECUTIVE DISCUSSION</span><h1>Operating exposure & response options</h1><span class="mock">STANDALONE MOCK / NOT AN APPROVED FACTORY PLAN</span></div><div><button class="print" onclick="window.print()">Print / PDF</button><p><small>September-October 2026<br>Common evaluation tail through 7 November<br>No OT / provisional 3-calendar-day release lag</small></p></div></header>
  <div class="metrics"><div><span>Modeled cost, penalty excluded</span><strong>${money(selected.costExcludingPenalty)}</strong></div><div><span>Fulfilment against ${selectedId === "reschedule" ? "revised" : "original"} due dates</span><strong>${n(selected.evaluation.service, 1)}%</strong></div><div><span>Unserved demand</span><strong>${n(selected.evaluation.totalShortage)} t</strong></div><div><span>Required demand, all counted</span><strong>${n(selected.evaluation.totalDemand)} t</strong></div></div>
  <h2>Scenario snapshot</h2><p>Demand +${n(shock.demandPct)}% / butadiene purchase price +${n(shock.pricePct)}% / raw material receipts +${n(shock.receiptDelay)} days.</p><p>Selected candidate: <strong>${escape(selected.name)}</strong>. Original base cost: ${money(baselineCost)}. Scenario cost difference: ${money(selected.costExcludingPenalty - baselineCost)}. Not realized savings.</p>
  <h2>Response comparison</h2><table><thead><tr><th>Candidate & assumptions</th><th>Modeled cost</th><th>Fulfilment</th><th>Unserved</th></tr></thead><tbody>${options.map((option) => `<tr class="${option.id === selectedId ? "selected" : ""}"><td><strong>${escape(option.name)}</strong><div class="condition">${escape(option.condition)}</div></td><td>${money(option.costExcludingPenalty)}</td><td>${n(option.evaluation.service, 1)}%<div class="condition">${option.id === "reschedule" ? "Revised dates; not original-date on-time service" : "Original dates"}</div></td><td>${n(option.evaluation.totalShortage)} t</td></tr>`).join("")}</tbody></table>
  <div class="caution">These are deterministic what-if candidates, not optimization results or approved actions. Delivery extensions require customer agreement. Every original ton remains in the common evaluation horizon. Mock cost excludes shortage penalty, revenue, opening-stock valuation, taxes and cash timing. Deferred receipts beyond evaluation are not cost savings.</div>
  <h2>Discussion follow-up</h2>${[
    {
      id: "supply",
      owner: "Procurement",
      title: "Confirm supplier recovery dates and quote",
    },
    {
      id: "delivery",
      owner: "Commercial",
      title: "Confirm original or accepted revised customer due dates",
    },
    {
      id: "factory",
      owner: "Production",
      title: "Validate grade, reactor and cleaning schedule",
    },
    {
      id: "finance",
      owner: "Finance",
      title: "Replace mock financial assumptions",
    },
  ]
    .map(
      (item) =>
        `<div class="review"><span>${reviewed[item.id] ? "Discussed" : "Pending discussion"}: ${item.title}</span><small>${item.owner}</small></div>`,
    )
    .join("")}
  <h2>Meeting note</h2><div class="note">${escape(note || "No meeting note recorded.")}</div><footer>All volumes, dates, counterparties, costs and interventions are illustrative. Independent of live forecasts, manual drafts and logistics mock. No telemetry, company approval, dispatch or guaranteed feasibility. Discussion checkboxes do not constitute approval.</footer></body></html>`;
}

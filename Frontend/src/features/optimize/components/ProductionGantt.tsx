import { Fragment, useState } from 'react';
import { CELL_W, LABEL_W, type OptimizePlan } from '../useOptimizePlan';
import { CLEAN_DAYS, PAIRS, addCleaning, cleaningAt, pairOfReactor, removeCampaign, removeCleaning, resizeCampaign, setCampaignGrade, splitCampaign, swapCampaign } from '../manualPlan';
import { dispOf, slotOf } from '../samplePlan';
import { formatNumber } from '@/lib/format';
import type { OptimizeResult, PlanDay } from '../types';

// Daily Gantt (plant + RX1-RX4) incl. the hand-edit mode
export function ProductionGantt({ plan, data, view }: { plan: OptimizePlan; data: OptimizeResult; view: OptimizeResult }) {
  const { manual, setManual, setTip, startEditing, stopEditing, updateDraft, onResizeDown, onCleanDown, showTip, grades, hasPlan, editing, conflictDays, starts, selectedCampaign, canEdit, editBlockedReason, gridCols } = plan;
  const [byProduct, setByProduct] = useState(false);
  const hasProducts = view.days.some((d) => (d.products?.length ?? 0) > 0);

  function dayBlocks(d: PlanDay) {
    return d.parts.map((p, k) => (
      <div
        key={p.grade + k}
        className={'opt-gblk' + (d.chg ? ' half' : '')}
        style={{
          background: `var(--s${slotOf(p.grade)})`,
          color: `var(--s${slotOf(p.grade)}i)`,
        }}
      >
        {d.chg
          ? `${dispOf(p.grade, data?.grades)}·${formatNumber(p.tons)}`
          : (
            <>
              {dispOf(p.grade, data?.grades)}
              <small>{formatNumber(p.tons)} t</small>
            </>
          )}
      </div>
    ));
  }

  /** Thin strip under a day's blocks: how the day's output is shared over its products. */
  function prodStrip(d: PlanDay) {
    if (!byProduct || !d.products || d.products.length === 0) return null;
    return (
      <div className="opt-prodstrip" aria-hidden="true">
        {d.products.map((p) => (
          <span key={p.material_no} style={{ flexGrow: Math.max(p.tons, 0.05) }} />
        ))}
      </div>
    );
  }

  return (
    <section className="opt-panel" aria-label="Daily production Gantt">
      <div className="opt-phrow">
        <div className="opt-phleft">
          <h2 className="opt-ph">Daily production schedule — one row per reactor (Plant + RX1–RX4)</h2>
          {hasProducts && (
            <label className="opt-prodtoggle">
              <input
                type="checkbox"
                checked={byProduct}
                onChange={(e) => setByProduct(e.target.checked)}
              />
              Product split
            </label>
          )}
        </div>
        {!editing ? (
          <button
            type="button"
            className="opt-editbtn"
            onClick={startEditing}
            disabled={!canEdit}
            title={canEdit ? 'Drag campaigns and cleaning windows; every change is checked against the plant rules' : editBlockedReason ?? undefined}
          >
            ✎ Edit plan
          </button>
        ) : (
          <div className="opt-editbar">
            <button type="button" className="opt-fixbtn" onClick={startEditing} disabled={manual?.checking}>Reset to optimized</button>
            <button type="button" className="opt-fixbtn dark" onClick={stopEditing}>Exit edit mode</button>
          </div>
        )}
      </div>

      {editing && manual && (
        <div className="opt-edithelp">
          <span>
            <b>Edit:</b> drag the right edge of a campaign block to make it longer or shorter (the next campaign gives or takes the days) ·
            drag a <i>Cleaning</i> block in a reactor row to move it · click a campaign for grade / swap / split / remove.
            Every change is checked against plant_config.yaml; days that break a rule turn red.
          </span>
        </div>
      )}

      {editing && manual && (
        <div className="opt-edittools">
          <div className="opt-edittool">
            <span className="opt-lab">Selected campaign</span>
            {selectedCampaign && manual.selected !== null ? (
              <div className="opt-toolrow">
                <i className="opt-dot" style={{ background: `var(--s${slotOf(selectedCampaign.grade)})` }} />
                <select
                  aria-label="Campaign grade"
                  value={selectedCampaign.grade}
                  onChange={(e) => updateDraft(setCampaignGrade(manual.draft, manual.selected!, e.target.value), true, null)}
                >
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>{g.disp}</option>
                  ))}
                </select>
                <label className="opt-dayslbl">
                  days
                  <input
                    type="number"
                    min={1}
                    aria-label="Campaign days"
                    value={selectedCampaign.days}
                    disabled={manual.selected === manual.draft.campaigns.length - 1}
                    title={manual.selected === manual.draft.campaigns.length - 1 ? 'The last campaign runs to the horizon end — resize the one before it' : ''}
                    onChange={(e) => updateDraft(resizeCampaign(manual.draft, manual.selected!, Number(e.target.value) || 1), true)}
                  />
                </label>
                <button type="button" className="opt-fixbtn" disabled={manual.selected === 0} onClick={() => updateDraft(swapCampaign(manual.draft, manual.selected!, -1), true, manual.selected! - 1)}>◀ Swap</button>
                <button type="button" className="opt-fixbtn" disabled={manual.selected === manual.draft.campaigns.length - 1} onClick={() => updateDraft(swapCampaign(manual.draft, manual.selected!, 1), true, manual.selected! + 1)}>Swap ▶</button>
                <button
                  type="button"
                  className="opt-fixbtn"
                  disabled={selectedCampaign.days < 2}
                  title="Carve a new campaign out of the end of this one"
                  onClick={() => {
                    const alt = grades.find((g) => g.id !== selectedCampaign.grade)?.id ?? selectedCampaign.grade;
                    updateDraft(splitCampaign(manual.draft, manual.selected!, alt), true, manual.selected! + 1);
                  }}
                >
                  Split
                </button>
                <button type="button" className="opt-fixbtn" disabled={manual.draft.campaigns.length < 2} onClick={() => updateDraft(removeCampaign(manual.draft, manual.selected!), true, null)}>Remove</button>
              </div>
            ) : (
              <span className="opt-railnote" style={{ margin: 0 }}>Click a campaign block in the “Edit” row.</span>
            )}
          </div>
          {PAIRS.map((pair) => (
            <div className="opt-edittool" key={pair}>
              <span className="opt-lab">{pair} cleaning ({CLEAN_DAYS} days)</span>
              <div className="opt-toolrow">
                {manual.draft.cleanings.map((c, i) =>
                  c.pair === pair ? (
                    <span className="opt-cleanchip" key={i}>
                      {view.days[c.start]?.date ?? `day ${c.start + 1}`}
                      {' → '}
                      {view.days[Math.min(view.days.length - 1, c.start + CLEAN_DAYS - 1)]?.date ?? ''}
                      <button type="button" aria-label={`Remove ${pair} cleaning`} title="Remove" onClick={() => updateDraft(removeCleaning(manual.draft, i), true)}>×</button>
                    </span>
                  ) : null,
                )}
                <button
                  type="button"
                  className="opt-fixbtn"
                  onClick={() => updateDraft(addCleaning(manual.draft, pair, manual.selected !== null ? starts[manual.selected] : 0), true)}
                >
                  + Add cleaning
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="opt-legend">
        {grades.map((g) => (
          <span key={g.id}>
            <i className="opt-dot" style={{ background: `var(--s${g.slot})` }} />
            {g.disp}
          </span>
        ))}
        <span>
          <i
            className="opt-dot"
            style={{
              background:
                'repeating-linear-gradient(45deg, transparent 0 3px, var(--hatch) 3px 5px), var(--surface2)',
              border: '1px solid var(--line)',
            }}
          />
          Cleaning
        </span>
        <span>
          <i
            className="opt-dot"
            style={{ border: '1px dashed var(--baseline)', background: 'transparent' }}
          />
          Standby (not yet used)
        </span>
        {editing && (
          <span>
            <i className="opt-dot" style={{ border: '2px solid var(--bad)', background: 'transparent' }} />
            Rule conflict
          </span>
        )}
      </div>
      {!hasPlan && (
        <p className="opt-railnote" style={{ margin: '0 0 8px' }}>
          No plan to draw — change the inputs (or use a quick fix above) and run again.
        </p>
      )}
      <div className="opt-ganttwrap">
        <div className="opt-gantt" style={{ minWidth: LABEL_W + view.days.length * CELL_W }}>
          <div className="opt-ghead" style={{ gridTemplateColumns: gridCols }}>
            <div className="opt-glabel" />
            {view.days.map((d, i) => {
              const parts = d.date.split(' ');
              return (
                <div key={d.iso} className={'opt-d' + (d.wknd ? ' wknd' : '') + (conflictDays.has(i) ? ' conf' : '')}>
                  <b>{parts[0]}</b>
                  {parts.slice(1).join(' ')} · {d.wd}
                </div>
              );
            })}
          </div>

          {editing && manual && (
            <>
              {/* ghost: the optimized plan this draft started from */}
              <div className="opt-grow opt-ghostrow" style={{ gridTemplateColumns: gridCols }}>
                <div className="opt-glabel">Optimized</div>
                {manual.base.days.map((d) => (
                  <div
                    key={'ghost-' + d.iso}
                    className={'opt-gcell ghost' + (d.wknd ? ' wknd' : '')}
                    onMouseMove={(e) => showTip(e, d)}
                    onMouseLeave={() => setTip(null)}
                  >
                    <>{dayBlocks(d)}{prodStrip(d)}</>
                  </div>
                ))}
              </div>
              {/* editable campaign blocks */}
              <div className="opt-grow opt-editrow" style={{ gridTemplateColumns: gridCols }}>
                <div className="opt-glabel" style={{ gridColumn: 1, gridRow: 1 }}>Edit</div>
                {manual.draft.campaigns.map((c, i) => {
                  const last = i === manual.draft.campaigns.length - 1;
                  const selected = manual.selected === i;
                  return (
                    <div
                      key={i}
                      role="button"
                      tabIndex={0}
                      aria-label={`${dispOf(c.grade, grades)} campaign, ${c.days} days`}
                      aria-pressed={selected}
                      className={'opt-camp' + (selected ? ' sel' : '')}
                      style={{
                        gridColumn: `${starts[i] + 2} / span ${c.days}`,
                        gridRow: 1,
                        background: `var(--s${slotOf(c.grade)})`,
                        color: `var(--s${slotOf(c.grade)}i)`,
                      }}
                      onClick={() => setManual((prev) => (prev ? { ...prev, selected: i } : prev))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setManual((prev) => (prev ? { ...prev, selected: i } : prev));
                        } else if (!last && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                          e.preventDefault();
                          updateDraft(resizeCampaign(manual.draft, i, c.days + (e.key === 'ArrowRight' ? 1 : -1)), true, i);
                        }
                      }}
                    >
                      <span className="opt-camplbl">
                        {dispOf(c.grade, grades)}
                        <small>{c.days} d</small>
                      </span>
                      {!last && (
                        <span
                          className="opt-camp-h"
                          title="Drag to resize"
                          onPointerDown={(e) => onResizeDown(e, i)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="opt-grow" style={{ gridTemplateColumns: gridCols }}>
            <div className="opt-glabel">Plant</div>
            {view.days.map((d, i) => (
              <div
                key={'plant-' + d.iso}
                className={'opt-gcell' + (d.wknd ? ' wknd' : '') + (conflictDays.has(i) ? ' conf' : '')}
                onMouseMove={(e) => showTip(e, d)}
                onMouseLeave={() => setTip(null)}
              >
                <>{dayBlocks(d)}{prodStrip(d)}</>
              </div>
            ))}
            {['RX1', 'RX2', 'RX3', 'RX4'].map((rid) => (
              <Fragment key={rid}>
                <div className="opt-glabel">{rid}</div>
                {view.days.map((d, i) => {
                  const reactor = d.reactors?.find((r) => r.id === rid);
                  const pair = pairOfReactor(rid);
                  let status = reactor?.status ?? 'prod';
                  let draggable = false;
                  if (manual) {
                    // live preview of cleaning windows while dragging
                    if (cleaningAt(manual.draft, pair, i) >= 0) {
                      status = 'clean';
                      draggable = true;
                    } else if (status === 'clean') {
                      status = 'idle';
                    }
                  }
                  return (
                    <div
                      key={d.iso}
                      className={'opt-gcell' + (d.wknd ? ' wknd' : '') + (conflictDays.has(i) ? ' conf' : '') + (draggable ? ' grab' : '')}
                      onMouseMove={(e) => showTip(e, d, { id: rid, status })}
                      onMouseLeave={() => setTip(null)}
                      onPointerDown={draggable ? (e) => onCleanDown(e, pair, i) : undefined}
                    >
                      {status === 'prod'
                        ? <>{dayBlocks(d)}{prodStrip(d)}</>
                        : (
                          <div className={'opt-gblk state-' + status}>
                            {status === 'clean' ? 'Cleaning' : 'Standby'}
                          </div>
                        )}
                    </div>
                  );
                })}
                {(rid === 'RX2' || rid === 'RX4') && (
                  <div className="opt-lanecap opt-paircap">
                    {rid === 'RX2' ? view.pair_notes?.['RX1-2'] : view.pair_notes?.['RX3-4']}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <details className="opt-details">
        <summary>How to read this plan</summary>
        <p className="opt-gcap">
          Plant row = plant-level grade for the day · RX1–RX4 rows = per-reactor status (producing / cleaning / standby) · two-tone block = changeover day (uses the special ceiling of that pair) · grey columns = Sat–Sun (production allowed, but no grade change) · with &quot;Product split&quot; on, the strip at the bottom of each block shows how the day&apos;s output is shared over its products (hover for names and tons)
          {editing && ' · red outline = a plant rule is broken on that day (hover for the reason)'}
        </p>
      </details>
    </section>
  );
}

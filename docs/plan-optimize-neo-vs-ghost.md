# แผนรวมงาน: branch `Neo` เป็นฐาน + หยิบไอเดียจาก `feature/shared-scenario-ghost-plan`

สถานะ (16 ต.ค. 2026): **Phase 1 ทำแล้ว** (ข้อ 2.2-1/2/3 และ 2.3 ทั้งหมด) และเพิ่ม **Gantt แบบแก้ได้** ตามที่ขอเพิ่ม: แผนที่ optimize เป็น ghost, ลากยืด/หด campaign, ย้ายช่วงล้างเตา, สลับ/แทรก/ลบ campaign แล้วให้ backend ตรวจกฎทุกครั้ง (`POST /api/v1/optimize/evaluate`, `Backend/optimization/manual.py`) วันที่ผิดกฎขึ้นสีแดงพร้อมเหตุผล — ทำแทนข้อ 2.4 แถว ManualPlanStudio โดยไม่ต้องคัดลอกกฎไปไว้ใน TypeScript

เขียนครั้งแรก 15 ต.ค. 2026 (ตอนนั้นยังเป็นแผนล้วน)

หลักการที่ใช้ตลอดแผนนี้
- **Neo คือฐาน** ทั้ง backend, forecasting, หน้า `/` และหน้า `/optimize`
- **Logic ของ optimizer = CP-SAT ใน `Backend/optimization/`** (อ่านกฎจาก `plant_config.yaml`) เท่านั้น
- จาก ghost เอา **"ไอเดียและ pattern ของ UI"** มาทำใหม่ในบริบทของ Neo ไม่ยกไฟล์ใหญ่มาทั้งก้อน
- **ห้าม `git merge` สาขา ghost ตรงๆ** เพราะจะลบ `Backend/optimization/`, forecasting candidates zoo และหน้า `/optimize` ของ Neo ทิ้ง (ghost แตกออกจาก commit `1a30719` ก่อนที่ Neo จะเพิ่มของพวกนี้)

---

## 1. สองสาขาต่างกันตรงไหน

| หัวข้อ | Neo | shared-scenario-ghost-plan |
|---|---|---|
| commit ที่ต่างกัน | +7 (ARIMA/GBR/intermittent candidates, CP-SAT engine, selftest, หน้า `/optimize`) | +2 (`e850e3b` PuLP prototype, `0d6adb4` planning workspace 9 views) |
| Optimizer engine | OR-Tools **CP-SAT** รายวัน 7–120 วัน | **PuLP/CBC** รายเดือน 2 เดือน (ก.ย.–ต.ค. 2026) |
| สิ่งที่ตัดสินใจ | grade หลักรายวัน, split วัน changeover, คู่เตา run/clean, VCR campaign | ตันต่อ grade ต่อเดือน, OT, ซื้อ BD, สต็อก RM/FG |
| กฎโรงงาน | 11 คู่ transition + ceiling, min-run, VCR ≥ 8 วัน, อายุเตา 60/50/15, ล้าง 7 วัน, เปลี่ยน grade เฉพาะวันธรรมดา | capacity รวม + OT, min batch, ถัง RM, service target (ไม่มีลำดับ grade / กฎเตา) |
| Objective | max demand ที่ส่งได้ − penalty changeover | min cost (deterministic / stochastic / robust) ด้วยต้นทุนสมมติ USD |
| แหล่งกฎ/ตัวเลข | `plant_config.yaml` (ตัวเลขจากลูกค้า) | hard-code ในไฟล์ ("illustrative assumptions") |
| Endpoint | `POST /api/v1/optimize` | `POST /api/v1/optimization/demo` |
| ไฟล์ backend | `Backend/optimization/` (package) | `Backend/optimization.py` (module) → **ชื่อชนกัน import ไม่ได้พร้อมกัน** |
| หน้า UI | `/optimize`: Gantt รายเตา RX1–RX4, fulfillment, constraint check, ตารางรายวัน | `OptimizationPanel.tsx` + view "Scenario studio": strategy picker, slider 5 ตัว, cost chart, ตารางเดือน/grade |
| Test | `selftest.py` ตรวจคำตอบกับกฎทุกข้อ | `test_optimization.py` (unittest) |
| ของแถมใน ghost | – | PlanningWorkspace (2,275 บรรทัด), ManualPlanStudio drag Gantt (1,647) + `manualPlanning.ts` (609), ScenarioContext, ExecutiveCockpit + FactoryTwin 3D, Logistics globe 3D, CSS 4,700 บรรทัด, deps `three`, `@dnd-kit/core` |

ข้อสังเกตสำคัญจากการอ่านโค้ด ghost
- ทุก view ใหม่ (executive, timeline, logistics) เป็น **mock ฝั่ง client ล้วน** ไม่เรียก backend เลย
- "Ghost plan" ใน ghost = overlay เส้นประของ **แผน mock ตั้งต้น** (`seed`) เทียบกับแผนที่ลากแก้ (`state`) และมี `previewPlan` ตอนลากค้าง; undo/redo เก็บใน context
- `connectedScenario.validScenario` บังคับ `startDate = 2026-09-01` และ `days = 68` ตายตัว → ใช้กับผล CP-SAT ที่ horizon เปลี่ยนได้ไม่ได้ทันที
- `manualPlanning.ts` เขียนกฎโรงงานซ้ำอีกชุดใน TypeScript (ครอบคลุมบางส่วน, ตัวเลขบางตัวต่างจาก `plant_config.yaml`, อนุญาต OT) → ถ้าเอามาจะมี "กฎสองแหล่ง"
- `ManualPlanStudio` prop `source` เป็นค่า `null` เสมอ (ไม่เคยรับผล optimizer จริง)
- `LegacyDashboard.tsx` = `page.tsx` ของ Neo ย้ายเป็น component, ตัดปุ่ม `/optimize` ออก, ใส่ `OptimizationPanel` (PuLP) เข้าไปแทน
- forecasting ใน ghost คือเวอร์ชันเก่ากว่า Neo (ไม่มี candidates zoo) ไม่ใช่การปรับปรุง

---

## 2. ส่วน Optimize: เอาอะไรจากไหน

### 2.1 Backend → ใช้ของ Neo ทั้งหมด

| สิ่งที่ทำ | รายละเอียด |
|---|---|
| คง | `Backend/optimization/{engine.py, schemas.py, plant_config.yaml, sample_plan.py, selftest.py}`, `POST /api/v1/optimize`, deps `ortools`, `pyyaml` |
| ไม่เอา | `Backend/optimization.py`, `test_optimization.py`, `/api/v1/optimization/demo`, dep `pulp` |
| เหตุผล | คนละโจทย์ (รายเดือน vs รายวัน), ต้นทุนสมมติ, อนุญาต OT ซึ่งขัดกับกฎลูกค้า, ชื่อ module ชนกับ package ของ Neo |
| เพิ่มเล็กน้อย (optional, Phase 2) | `GET /api/v1/optimize/config` คืน grades/slot/demand default/holidays จาก `plant_config.yaml` + `sample_plan.py` เพื่อให้หน้าเว็บเลิก hard-code `GRADES` และ `DEMAND_DEFAULT` ใน `samplePlan.ts` |

ถ้าในอนาคตลูกค้าให้ตัวเลขต้นทุน/ราคา BD จริง ค่อยพิจารณาเพิ่ม "ชั้นรายเดือน" (แนว PuLP ของ ghost) เป็น endpoint แยกที่ส่ง demand ต่อเดือนลงมาให้ CP-SAT ทำตารางรายวัน แต่ **ไม่อยู่ในรอบนี้**

### 2.2 หน้า `/optimize` → คงโครงของ Neo แล้วเติมของจาก ghost 6 อย่าง

คง: `Frontend/src/app/optimize/{page.tsx, samplePlan.ts, optimize.css}` (Gantt รายเตา, fulfillment, constraint check, ตารางรายวัน, assumptions, offline fallback)

สิ่งที่หยิบจาก ghost มาทำใหม่ (เรียงตามความคุ้ม)

| # | ไอเดียจาก ghost | ทำใน Neo ยังไง | ขนาดงาน |
|---|---|---|---|
| 1 | ปุ่ม preset (`OptimizationPanel.applyPreset`) | แถบปุ่มเหนือ rail: **Base (demo demand)** / **Demand +20%** / **VCR หนัก** / **RX1-2 ใกล้ครบ 60 วัน** (age 58) → ตั้งค่าแล้ว run ทันที | เล็ก |
| 2 | สถานะ "input เปลี่ยนแต่ยังไม่ได้ solve" (`PlanningWorkspace` unapplied) | เก็บ hash ของ request ล่าสุด; ถ้าต่างจากฟอร์มปัจจุบัน แสดง badge "ค่าถูกแก้ ยังไม่ได้ Run" + ไฮไลต์ปุ่ม Run; KPI/Gantt ขึ้น "ผลเก่า" | เล็ก |
| 3 | กัน response เก่าทับใหม่ (`runId` ref, `PlanningWorkspace:401-421`) | ใส่ counter ใน `run()`; solve ใช้เวลาได้ถึง 30–180 วิ จึงจำเป็น | เล็กมาก |
| 4 | Saved plans (`localStorage` key `ube.planning.saved-runs.v1`, เก็บ 20 รายการ, Open/Delete/Export JSON) | panel "แผนที่บันทึก" ใน rail: บันทึกชื่อ + request + response; เปิดกลับมาดูได้โดยไม่ต้อง solve ใหม่; export JSON | กลาง |
| 5 | **Ghost plan** (overlay แผนตั้งต้น + เทียบ KPI กับ baseline) | ปุ่ม "ตั้งเป็น baseline" บนผลปัจจุบัน; แถว **Baseline** เส้นประเหนือแถว Plant ใน Gantt; KPI tiles โชว์ Δ เทียบ baseline (fulfillment, shortage, changeover, total tons); ตอน solve ใหม่ยังเห็นแผนเก่าจางๆ จนผลใหม่มา | กลาง |
| 6 | **Shared scenario** (ScenarioContext) | ทำเวอร์ชันเบา: `lib/scenarioStore.ts` เก็บ `{demand, source:'forecast'|'manual', model_name, trained_through, updated_at}` ใน `localStorage`; หน้า forecast มีปุ่ม "ส่ง demand ไป optimize"; หน้า `/optimize` ขึ้นป้าย "demand จาก forecast (model X, ถึงเดือน Y)" และปุ่ม "กลับเป็นค่า default" | กลาง |

รายละเอียดข้อ 6 ที่ต้องตัดสินใจตอนทำ
- ชื่อ grade ฝั่ง forecast คือ `UBEPOL BR150`, `UBEPOL BR150L`, `UBEPOL VCR617`, `UBEPOL VCR412`, `UBEPOL BR150B` (ดู `Backend/forecasting/data.py:34-43`) ส่วน optimizer ใช้ `BR150`, `VCR412`, ... → map โดยตัด prefix `UBEPOL `
- `BR360B` ไม่มีโมเดล → ใช้ค่า default/กรอกเอง และบอกบนหน้า
- แปลงรายเดือน → horizon: horizon 28 วัน ใช้เดือนแรก × 28/จำนวนวันของเดือน (horizon ยาวกว่าเดือนให้รวมเดือนถัดไปตามสัดส่วน) แสดงสูตรไว้ใต้ช่อง demand
- ต้องเรียก `/api/v1/forecast` 6 ครั้ง (ต่อ grade) หรือเพิ่ม endpoint รวม `GET /api/v1/forecast/all` ฝั่ง backend (~30 บรรทัด) เลือกอย่างหลังถ้าอยากให้ปุ่มเดียวจบ

### 2.3 ของใน Neo `/optimize` ที่ควรแก้ให้ถูกต้องก่อน (พบจากการอ่าน `page.tsx`)

| ปัญหา | ที่อยู่ | แก้ |
|---|---|---|
| หน้าไม่ส่ง `start_date` (engine รองรับ, ตอนนี้ default = วันจันทร์หน้า) | `page.tsx:50-64` | เพิ่มช่องวันที่เริ่มแผน |
| หน้าไม่ส่ง `holidays`; dropdown "Pick from calendar…" ไม่มี onChange (ปุ่มตาย) | `page.tsx:289-296` | เปลี่ยนเป็นรายการวันที่ (เพิ่ม/ลบ) แล้วส่งไป API; engine รวมกับ `company_holidays` ใน yaml ให้อยู่แล้ว |
| dropdown "Solver" มีตัวเลือกเดียวและไม่ทำอะไร | `page.tsx:299-305` | ลบ หรือทำเป็น label อ่านอย่างเดียว |
| Objective "Balance (adjustable weights)" ไม่มีช่องปรับ weight | `page.tsx:194-203` | เปลี่ยนชื่อเป็น "Balance" และอธิบายสั้นๆ ว่า penalty = 60 (`engine.py:49-53`) |
| Horizon เลือกได้แค่ 14/28/56 แต่ engine รับ 7–120 | `page.tsx:176-187` | ช่องตัวเลข 7–120 หรือเพิ่มตัวเลือก 7/21/42/84 |
| ผล `infeasible` / `unknown` → `days` ว่าง หน้าแสดง Gantt ว่าง + KPI 0 โดยข้อความอยู่แค่ใน Constraint check | `engine.py:_empty_payload`, `page.tsx` ไม่เช็ก `status` | banner สีเตือนบนสุดพร้อม `message` + ปุ่มลัด "ลด horizon" / "เพิ่ม time limit"; คงแผนเก่าเป็น ghost |
| footnote tile Shortage เขียน "grades not scheduled in this plan" ทั้งที่คือยอดขาดรวม | `page.tsx:360-363` | เปลี่ยนเป็น "Σ max(demand − produced, 0)" |
| ปุ่ม Run อยู่ล่างสุดของ rail ต้องเลื่อนหา | `page.tsx:306-318` | ทำแถบ Run ติดด้านบนของ rail (sticky) ร่วมกับ badge ข้อ 2 |

### 2.4 สิ่งที่ **ไม่เอา** จาก ghost ในรอบนี้ (และทางเลือกที่ถูกต้องกว่า)

| ไม่เอา | เหตุผล | ถ้าต้องการจริงในอนาคต |
|---|---|---|
| `ManualPlanStudio` + `manualPlanning.ts` (drag Gantt) | กฎโรงงานซ้ำสองแหล่ง (TS vs yaml) และไม่ตรงกัน, ผูกกับ mock 68 วัน, ไม่รับผล CP-SAT, เพิ่ม `@dnd-kit/core` | ทำ **pins/locks** ใน request (เช่น "บังคับ VCR เริ่ม 19 ต.ค.", "ล้าง RX1-2 วันที่ X") แล้วให้ CP-SAT solve ใหม่ → กฎยังอยู่ที่เดียว |
| `PlanningWorkspace` (shell 9 views, search, drawer) | 2,275 บรรทัดใน closure เดียว, แยก view ไม่ได้ถ้าไม่ refactor, เป็น UX ของ PuLP | เอาแค่ไอเดีย nav bar (ข้อ 3.1) |
| `ExecutiveCockpit`, `LogisticsGlobeStudio`, `WorldGlobe`, `ConnectedExperience` | mock ล้วน ไม่แตะ backend, ต้องการ `three`, รูป `public/images/*` ที่ต้องเช็กสิทธิ์ | – |
| `FactoryTwin.tsx` (3D เตา 4 ตัว) | ไม่จำเป็นต่อการใช้งาน | **ใช้ได้ง่ายถ้าอยากโชว์เดโม**: รับแค่ `reactors[4].{id,status}`; ผล CP-SAT มี `days[d].reactors[].status` (prod/clean/idle) อยู่แล้ว → adapter ~20 บรรทัด + CSS จาก `executive.css:123-162` + dep `three` (~1 วัน) |
| ghost `.gitignore` ที่เอา `Constraint/` ออกจาก ignore | เอกสารลูกค้าห้าม commit | คง `.gitignore` ของ Neo |
| tests `.cjs` ของ ghost | ทดสอบ lib ของ ghost เอง, ต้อง Node 24 / Playwright ที่ไม่ได้ประกาศใน package.json | คง `selftest.py`; ถ้าอยากมี smoke test หน้า `/optimize` ค่อยเขียน Playwright ใหม่สั้นๆ |

---

## 3. หน้าอื่นๆ: ตาม Neo แต่ปรับให้ใช้ง่ายขึ้น

ตอนนี้ Neo มี 2 หน้า: `/` (1,093 บรรทัด: header, presets, What-If simulator หน่วย "units", value-chain flow, `DemandForecastPanel`, `ModelPerformancePanel`, audit trail) และ `/optimize` ซึ่งเชื่อมกันด้วยปุ่มเล็กๆ ใน header กับลิงก์ "← Dashboard"

| # | ปรับ | ทำยังไง | ขนาดงาน |
|---|---|---|---|
| 3.1 | **Nav bar ร่วม** | `components/AppNav.tsx` ใส่ใน `layout.tsx`: Dashboard / Demand Forecast / Production Optimization + จุดสถานะ backend (ย้ายจาก header ของ `page.tsx` และ badge ของ `/optimize` มารวมที่เดียว) สไตล์เดิมของ Neo (slate/blue) | เล็ก |
| 3.2 | **แยกหน้า forecast** (`/forecast`) | ย้าย `<DemandForecastPanel/>` + `<ModelPerformancePanel/>` ออกจาก `page.tsx` ไปหน้าใหม่ (component พร้อมอยู่แล้ว ไม่ต้องแก้ข้างใน) → `/` เหลือ simulator + flow + audit trail; flow การใช้งานกลายเป็น Demand → Forecast → Optimize ตรงกับรอบ IBP | เล็ก–กลาง (ถ้าไม่อยากแยกหน้า ใช้ anchor tabs บน `/` แทนก็ได้) |
| 3.3 | **DemandForecastPanel**: ตารางรายเดือน (point / lower / upper) + แสดง `forecast.basis` และ `interval.level_pct` | หยิบจาก ghost diff (~25 บรรทัด) แต่คงสีและเส้นโค้งของ Neo; เพิ่มปุ่ม "ส่ง demand ไป optimize" (ข้อ 2.2-6) | เล็ก |
| 3.4 | **ป้ายหน่วยบน What-If simulator** | simulator ใช้ "units" และ capacity 10,500 ตามสไลด์ capstone ส่วน optimize ใช้ "ตัน/grade" → ใส่ chip "Illustrative model (units, Slide 15)" ที่ simulator และ "TSL plant rules (tons)" ที่ optimize กันสับสน | เล็กมาก |
| 3.5 | ปุ่ม "Production Optimization" ใน header `/` | ย้ายเข้า nav (3.1) และเพิ่ม CTA ใน value-chain flow ช่อง "3. Production" ให้กดไป `/optimize` พร้อม demand ปัจจุบัน | เล็ก |
| 3.6 | ชื่อ "Model Performance" → ghost ใช้ "Backtest Evidence" | ไม่จำเป็น คงของ Neo | – |

---

## 4. ลำดับการทำ

| Phase | งาน | ประมาณ |
|---|---|---|
| **1. `/optimize` ให้ครบและถูก** | ข้อ 2.3 ทั้งหมด + preset (2.2-1) + unapplied badge (2.2-2) + stale guard (2.2-3) | ~1 วัน |
| **2. เชื่อมข้อมูลและเปรียบเทียบ** | shared demand forecast → optimize (2.2-6, รวม endpoint `forecast/all` ถ้าเลือก) + saved plans (2.2-4) + baseline/ghost overlay (2.2-5) + optional `optimize/config` | ~1.5–2 วัน |
| **3. โครงหน้า** | nav bar (3.1) + แยก `/forecast` (3.2) + ตาราง forecast (3.3) + ป้ายหน่วย (3.4, 3.5) + อัปเดต README | ~0.5–1 วัน |
| ทีหลัง (ถ้าต้องการ) | FactoryTwin 3D บน `/optimize`, pins/locks สำหรับแก้แผนด้วยมือ, ชั้นรายเดือนเมื่อมีตัวเลขต้นทุนจริง | – |

ทุก Phase ปิดด้วย `python Backend/optimization/selftest.py` (ต้องผ่านเหมือนเดิม เพราะไม่แตะ engine) และเปิดหน้า `/optimize` ทั้งแบบ backend รันและไม่รัน (offline fallback ต้องยังทำงาน)

---

## 5. ข้อควรระวัง

- ดูโค้ด ghost เป็น "ต้นแบบ" ผ่าน `git show origin/feature/shared-scenario-ghost-plan:<path>` หรือเปิด worktree แยก ไม่ต้อง checkout ทับ
- กฎโรงงานมีแหล่งเดียวคือ `plant_config.yaml` — ห้ามคัดลอกตัวเลขกฎไปไว้ใน TypeScript
- Response contract ของ `/api/v1/optimize` ไม่เปลี่ยน (หน้าเดิมและ `samplePlan.ts` ยังใช้ได้) การเพิ่มคือ field ฝั่ง request ที่มีอยู่แล้ว (`start_date`, `holidays`) และ endpoint ใหม่แบบ optional เท่านั้น
- ค่าที่เก็บใน `localStorage` (saved plans, shared demand) อยู่เฉพาะ browser เครื่องนั้น — ระบุบนหน้าให้ชัด ไม่ใช่ audit trail ใน DB
- ถ้าจะใส่ `three` ให้โหลดด้วย `next/dynamic({ssr:false})` และรองรับเครื่องที่ไม่มี WebGL ตามที่ `FactoryTwin` ทำไว้แล้ว

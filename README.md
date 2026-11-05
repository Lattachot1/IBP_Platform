# AI-Driven Integrated Business Planning (IBP) Simulation Platform
**Client:** UBE Chemicals (Asia) PCL  
**Theme:** "One Platform, One Data, One Plan"  
**Topic:** Capstone 2026 - Topic 45 | **Team:** CALTLAPSE

---

## 📌 ภาพรวมระบบ (System Overview)

แพลตฟอร์มต้นแบบ (Proof of Concept - PoC) สำหรับระบบ **AI-Driven Integrated Business Planning (IBP)** ออกแบบขึ้นเพื่อแก้ปัญหาการวางแผนแยกส่วนในไฟล์ Excel ของแต่ละแผนก (Sales, Supply Chain, Production, Procurement, Finance) โดยจำลองผลกระทบแบบบูรณาการ (**What-if Scenario Simulation**) ในรอบการตัดสินใจเดียว:

1. **Demand Propagation:** เมื่อ Demand คาดการณ์เปลี่ยนแปลง ระบบคำนวณ Point Forecast พร้อม Confidence Interval (ช่วงความเชื่อมั่น ±5%) ทันที
2. **Constraint & Capacity Evaluation:** คำนวณขีดจำกัดกำลังการผลิต (Normal Capacity 10,500 units) ประเมินคอขวดและปริมาณสินค้าขาดสต็อก (Shortage / Stock-out)
3. **Decision Levers (Overtime - OT):** ประเมิน Trade-off การเปิดกะล่วงเวลา (+1,500 units capacity, +120,000 THB incremental cost) เพื่อกู้คืน Service Level ให้ลูกค้า
4. **Financial Translation:** แปลงผลกระทบเข้าสู่ตัวเลขทางการเงินทันที (Supported Sales Revenue และ Extra OT Cost)
5. **Scenario Versioning & Audit Trail:** บันทึกประวัติและเปรียบเทียบ Scenario ในระบบฐานข้อมูล เพื่อการตัดสินใจแบบ Single Source of Truth

---

## 🏗 โครงสร้างโปรเจกต์ (Monorepo Directory Layout)

```
IBP_Platform/
├── docker-compose.yml             # Full-stack Docker orchestration (MS SQL, db-init, Backend, Frontend)
├── .env.example                   # ตัวอย่างค่า .env (รหัสผ่าน DB, port) — copy เป็น .env
├── README.md                      # คู่มือระบบและคำสั่งเริ่มต้น
├── .github/workflows/ci.yml       # CI: lint, type check, tests, build, docker build ทุก PR
├── init-db/
│   ├── 01-init.sql                # T-SQL Script สร้าง Database IBP_DB, Scenarios Table และ Seed Data
│   ├── 02-app-login.sql           # Login ibp_app (อ่าน/เขียน IBP_DB เท่านั้น) ที่ backend ใช้
│   └── 03-planning.sql            # ตารางวางแผนระดับ product: Products, StockSnapshots, QcLots, SalesOrders, DemandForecasts
├── Backend/                       # Unified Python Backend (FastAPI)
│   ├── Dockerfile                 # Python 3.12-slim container image
│   ├── requirements.txt           # runtime dependencies (requirements-dev.txt = + pytest)
│   ├── main.py                    # สร้าง app: CORS, 422 handler, startup, include routers
│   ├── api/                       # REST endpoints แยกตามกลุ่ม
│   │   ├── health.py              # GET /api/health
│   │   ├── scenarios.py           # /api/simulate, /api/scenarios (+ /save)
│   │   ├── forecast.py            # /api/v1/models, history, forecast, retrain (+ engine state)
│   │   ├── optimize.py            # /api/v1/optimize (+ /evaluate, /catalog)
│   │   ├── products.py            # /api/v1/products (product master: list, create, edit, deactivate)
│   │   └── planning.py            # /api/v1/imports/* (CSV) + อ่าน stock, qc-lots, sales-orders, forecasts
│   ├── simulation.py              # กฎ What-if (capacity/OT/revenue), Scenario models, in-memory store
│   ├── planning_data/             # ข้อมูลวางแผนระดับ product: products.py, imports.py (อ่าน CSV + รายงานแถวที่ผิด), store.py (DB/in-memory), seed.py
│   ├── sample_data/               # ข้อมูลสมมติ (mock) รูปแบบเดียวกับ export จาก SAP — ไม่ใช่ข้อมูลลูกค้า
│   ├── database.py                # MS SQL Access Layer (pymssql) — DB ล่มตอบ 503 ไม่แอบเก็บใน RAM
│   ├── forecasting/               # Demand forecasting engine (data, models, backtest, service)
│   ├── optimization/              # Production Schedule Optimizer: engine.py (CP-SAT) + planning.py (product level) + manual.py (rule check for hand-edited plans) + plant_config.yaml
│   └── tests/                     # pytest (API, database mode, forecast state, optimizer selftest, products)
└── Frontend/
    ├── Dockerfile                 # Multi-stage Next.js standalone container
    ├── package.json               # Next.js 14, React 18, Tailwind CSS, Lucide React, Vitest
    ├── tsconfig.json
    ├── tailwind.config.js
    ├── next.config.mjs            # Standalone output configuration
    └── src/
        ├── app/                   # routing เท่านั้น — แต่ละหน้าแค่ประกอบ component
        │   ├── layout.tsx         # Enterprise theme layout
        │   ├── page.tsx           # Executive Dashboard & What-if Simulator
        │   ├── optimize/          # Production Optimization page (/optimize)
        │   ├── planning-data/     # Planning Data page (/planning-data): product master, CSV import, ข้อมูลในระบบ
        │   └── globals.css        # Tailwind styling & animations
        ├── features/              # โค้ดแยกตาม feature: hook (state + API) + components + tests
        │   ├── simulation/        # What-if dashboard
        │   ├── forecast/          # AI demand forecast panels
        │   ├── optimize/          # Gantt แผนผลิตรายวัน, hand-edit mode, plan form
        │   └── planning-data/     # product master, CSV import (ตรวจก่อนแล้วค่อย import), ตารางข้อมูลวางแผน
        └── lib/                   # apiClient (base URL, timeout, errors), apiError, format
```

---

## 🚀 คู่มือการรันระบบ (Quickstart Guide)

### วิธีที่ 1: รัน Frontend & Backend ทันที (Standalone Mode - ไม่ต้องใช้ DB หรือ Docker)

ถ้าไม่ได้ตั้งค่าฐานข้อมูล Backend จะเก็บ scenario ไว้ใน **In-Memory Store** (หายเมื่อ restart backend) จึงรันและทดสอบบนเครื่องได้ทันที ตัวเลขทุกตัวบนหน้าเว็บคำนวณโดย Backend เท่านั้น:

#### 1.1 รัน Frontend (Next.js - Port 3000)
```powershell
cd Frontend
# ติดตั้ง dependencies (หากยังไม่ได้รัน)
npm install

# รัน Development Server
npm run dev
```
เปิดบราวเซอร์ที่: **`http://localhost:3000`**  
*(หมายเหตุ: ต้องเปิด Backend ด้วย — ถ้า Backend ไม่ทำงาน หน้า Dashboard จะแจ้งว่า offline และไม่ให้ run/save simulation แทนการคำนวณเองในเบราว์เซอร์ กฎการวางแผนจึงมีที่เดียวคือ Backend)*

#### 1.2 รัน Backend Service (Port 8080)
```powershell
cd Backend
pip install -r requirements.txt
python main.py
```
Backend จะเริ่มทำงานที่ **`http://localhost:8080`**
*(หากไม่ได้ตั้งค่าฐานข้อมูล ระบบจะใช้ In-Memory Store — ถ้าตั้งค่า DB ไว้แต่ DB ล่ม API จะตอบ 503 แทนการแอบเก็บไว้ใน RAM)*

#### 1.3 Forecasting Engine (รวมอยู่ใน Backend แล้ว)
Forecasting Engine เดิม (model-service, Port 5000) ถูกรวมเข้ากับ Backend เป็นบริการ Python บริการเดียว
ดู Swagger docs ได้ที่ **`http://localhost:8080/docs`**

---

### วิธีที่ 2: Deploy ด้วย Docker Compose (Full Stack with MS SQL Server)

เมื่อเปิดใช้งาน Docker Desktop บนเครื่องของคุณ:

1. สร้างไฟล์ `.env` จากตัวอย่าง แล้วตั้งรหัสผ่านของตัวเอง (ไฟล์ `.env` ถูก gitignore ไว้ ห้าม commit):
   ```bash
   cp .env.example .env
   ```
2. (ถ้ามี) วางข้อมูล billing ของลูกค้าไว้ที่ `DemandModel/` — Docker จะ mount เข้า backend แบบอ่านอย่างเดียว ไม่ฝังลงใน image ถ้าไม่มี ระบบยังรันได้แต่ Forecast API จะตอบ 503
3. รันทุกเซอร์วิสด้วยคำสั่งเดียว (ครั้งแรกใช้เวลานาน: ดาวน์โหลด image และเทรนโมเดลตอน start หลายนาที):
   ```bash
   docker compose up -d --build
   ```

**Services ที่จะถูกเปิดใช้งาน:**
- **Frontend Dashboard:** `http://localhost:3000`
- **Python Backend API (รวม Forecasting Engine):** `http://localhost:8080` (Swagger docs ที่ `http://localhost:8080/docs`) — เปลี่ยน port ได้ด้วย `BACKEND_PORT` ใน `.env`
- **MS SQL Server 2022:** `127.0.0.1:1433` (เปิดเฉพาะเครื่องนี้), Database: `IBP_DB`
  - `db-init` สร้าง schema + seed (`init-db/01-init.sql`) และ login `ibp_app` ที่ backend ใช้ (อ่าน/เขียน `IBP_DB` เท่านั้น — `init-db/02-app-login.sql`)
  - รหัสผ่านของ `sa` และ `ibp_app` อยู่ใน `.env`
  - `init-db/03-planning.sql` สร้างตารางวางแผนระดับ product (รันซ้ำได้ ฐานข้อมูลเดิมจะได้ตารางใหม่ตอน `docker compose up` ครั้งถัดไป) ตารางสินค้าเริ่มต้นว่าง โหลดสินค้าจากข้อมูล billing ด้วย:
    ```bash
    docker compose exec backend python -m planning_data.seed --source billing
    ```
    (`--dry-run` ดูจำนวนก่อน, `--source mock` ใช้สินค้าสมมติ) สคริปต์เพิ่มเฉพาะสินค้าที่ยังไม่มี ไม่ทับค่าที่ planner แก้ไว้

> ถ้าเครื่องอื่นจะเปิด dashboard ให้ตั้ง `NEXT_PUBLIC_API_URL` ใน `.env` เป็นที่อยู่ของเครื่อง server แล้ว build ใหม่ (`docker compose up -d --build`) เพราะค่านี้ถูกฝังใน frontend ตอน build

---

## 📊 สถานการณ์ตัวอย่างตามโจทย์ Capstone (Slide 15 Illustrative Case)

บนหน้า Dashboard มีปุ่มลัด **Capstone Executive Presets** ให้คุณทดสอบได้ใน 1 คลิก:

| ตัวชี้วัด (Metric) | Preset 1: Base Case | Preset 2: Demand Surge (+20%) | Preset 3: Add Overtime (+20% + OT) |
| :--- | :--- | :--- | :--- |
| **Base Demand** | 10,000 units | 10,000 units | 10,000 units |
| **Demand Change** | 0% | +20% | +20% |
| **Forecast Demand** | 10,000 units | 12,000 units (CI: 11.4k - 12.6k) | 12,000 units (CI: 11.4k - 12.6k) |
| **Capacity Limit** | 10,500 units | 10,500 units (ติดคอขวด) | 12,000 units (เปิดกะ OT) |
| **Production Output** | 10,000 units | 10,500 units | 12,000 units |
| **Shortage Qty** | 0 units | **1,500 units (ขาดสต็อก)** | **0 units (ส่งมอบครบ)** |
| **Service Level (%)** | **100.0%** | **87.5% (ลูกค้าได้รับผลกระทบ)** | **100.0% (ฟื้นฟูระดับบริการ)** |
| **Supported Sales** | 10.0M THB | 10.5M THB | **12.0M THB (+1.5M THB)** |
| **Incremental OT Cost**| 0 THB | 0 THB | **+120,000 THB** |
| **Net Financial Gain** | Baseline | +500,000 THB | **+1,380,000 THB (คุ้มค่าการเปิด OT)** |
| **Constraint Status** | Feasible | ⚠️ Capacity Overload Bottleneck | ✅ Feasible (OT Shift Activated) |

---

## 📡 สรุป API Endpoints

### Python Backend (`:8080` — รวม Forecasting Engine ไว้ภายใน)
- `POST /api/simulate` — คำนวณผลกระทบ Demand, Capacity, Service Level, และ Financials
- `POST /api/v1/optimize` — Production Schedule Optimization (CP-SAT engine อ่านกฎจาก `Backend/optimization/plant_config.yaml` — ถ้าไม่ได้ติดตั้ง ortools จะ fallback เป็น sample plan)
  - `"use_planning_data": true` — วางแผนระดับ product จากข้อมูลวางแผน (สต็อก, lot รอ QC, order ที่ยังเปิด, forecast รายเดือน) แทน `demand` ราย grade (`Backend/optimization/planning.py`):
    - กฎโรงงานทุกข้อยังอยู่ที่ product group; ผลผลิตรายวันของแต่ละ group ถูกแบ่งลง product ใน group
    - ลำดับเป้าหมาย: order ส่งทันวัน (ตัน×วันที่ช้า) → สต็อกไม่ต่ำกว่าขั้นต่ำ → forecast ส่วนที่ยังไม่มี order ผลิตครบภายในสิ้นเดือน (หักสต็อกส่วนเกินราย product) → changeover น้อย → เผื่อสต็อกให้ demand หลังจบแผนตามสัดส่วนยอดขาย
    - ของที่ผลิตเสร็จเข้าสต็อกได้หลัง QC `planning.qc_days` (5 วัน, ตั้งใน `plant_config.yaml`)
    - response เพิ่ม `planning` (สถานะทุก order: วันพร้อมส่ง/ช้ากี่วัน, สต็อกคาดการณ์รายวันราย product, forecast ราย group-เดือน, KPI) และ `days[].products`
- `POST /api/v1/optimize/evaluate` — ตรวจแผนที่แก้ด้วยมือ (campaign/cleaning/pair plan) กับกฎเดียวกันใน `plant_config.yaml` ตอบรูปแบบเดียวกับ solver พร้อม `checks` ระดับ `conflict` และเลขวันที่ผิดกฎ (`Backend/optimization/manual.py`)
- หน้า `/optimize` — Production Optimization (Gantt แผนผลิตรายวัน, วงจร Reactor, Fulfillment, Constraint check) มี Quick scenarios, วันเริ่มแผน/วันหยุดบริษัท, และโหมด **Edit plan**: ลากยืด/หด campaign, ย้ายช่วงล้างเตา, สลับ/แทรก/ลบ campaign โดยแผนที่ optimize แสดงเป็น ghost และ backend ตรวจกฎทุกครั้ง (วันที่ผิดกฎขึ้นสีแดง) มี fallback ข้อมูลในเครื่องเมื่อ backend ไม่รัน
- Self-test ของ optimizer: `cd Backend && python -m optimization.selftest` (ตรวจคำตอบ solver กับกฎทุกข้อ และตรวจว่า evaluator รับแผนของ solver โดยไม่มี conflict; S5 วางแผนระดับ product บน mock data)
- `GET /api/v1/optimize/catalog` — product group จาก `plant_config.yaml` พร้อมสินค้าที่ active ในแต่ละ group (สินค้าที่ group ถูกลบไปแล้วอยู่ใน `unassigned`)
- `GET /api/v1/products` (`?active=true|false`), `GET /api/v1/products/{material_no}`, `POST /api/v1/products`, `PATCH /api/v1/products/{material_no}` — ข้อมูลหลักสินค้า (SAP material) แต่ละตัวอยู่ใน group ของ `plant_config.yaml` และมีสต็อกขั้นต่ำ ไม่มีการลบ: เลิกขายใช้ `PATCH {"is_active": false}` ถ้าไม่ได้ตั้งค่า DB จะใช้สินค้าสมมติจาก `Backend/sample_data/mock/products.csv` (ยังไม่มี login: ใครเข้าถึง backend ได้ก็แก้ได้)
- `POST /api/v1/imports/{stock|qc-lots|sales-orders|forecasts}` — import ไฟล์ CSV (ส่งไฟล์เป็น body, `Content-Type: text/csv`) รูปแบบตาม `Backend/sample_data/README.md`:
  - ทั้งไฟล์หรือไม่เลย: ผิดแม้แถวเดียวตอบ 422 พร้อมรายงานบรรทัดและคอลัมน์ที่ผิด ไม่บันทึกอะไร
  - `?dry_run=true` ตรวจและนับว่าจะเพิ่ม/อัปเดตกี่แถวโดยไม่บันทึก
  - stock แทนที่ทั้ง snapshot ของวันนั้น (วันที่จากคอลัมน์ `Stock Date` หรือ `?stock_date=`) ส่วน qc-lots, sales-orders, forecasts อัปเดตทับตาม key แถวที่ไม่อยู่ในไฟล์คงเดิม
  - material ต้องมีใน product master ก่อน
  ```bash
  curl -X POST "http://localhost:8080/api/v1/imports/sales-orders?dry_run=true" -H "Content-Type: text/csv" --data-binary @Backend/sample_data/mock/sap_sales_orders.csv
  ```
- `GET /api/v1/stock` (`?on=` snapshot ล่าสุดไม่เกินวันนั้น), `GET /api/v1/qc-lots` (`?status=`), `GET /api/v1/sales-orders` (`?status=&due_from=&due_to=`, มี `open_tons`), `GET /api/v1/forecasts` (`?month_from=&month_to=`) — ถ้าไม่ได้ตั้งค่า DB จะเริ่มด้วยข้อมูลสมมติจาก `Backend/sample_data/mock/`
- หน้า `/optimize` โหมด **Planning data — plan per product** (เลือกใน Demand source): วางแผนจากข้อมูลวางแผนแทนตัวเลข demand ราย grade แล้วแสดง KPI ของ order/สต็อก, ตารางสถานะ order (วันพร้อมส่ง/ช้ากี่วัน), กราฟสต็อกคาดการณ์ราย product เทียบขั้นต่ำ, ตาราง forecast ราย group-เดือน และ tooltip บน Gantt บอกผลผลิตราย product (โหมดแก้แผนด้วยมือยังใช้กับแผนแบบนี้ไม่ได้)
- หน้า `/planning-data` — Planning Data (ลิงก์จาก Dashboard): แก้/เพิ่ม/เลิกขายสินค้าใน product master, import CSV ทั้ง 4 แบบโดยกด **Check file** (dry run แสดงบรรทัด/คอลัมน์ที่ผิด) ก่อน **Import**, และดูสต็อก, lot รอ QC, order, forecast ที่อยู่ในระบบ
- `POST /api/scenarios/save` — บันทึกผลลัพธ์ Scenario ลง Database และ Audit Trail
- `GET /api/scenarios` — ดึงประวัติ 10 Scenarios ล่าสุด
- `GET /api/health` — ตรวจสอบสถานะ Backend และ Database
- Swagger docs — `http://localhost:8080/docs`
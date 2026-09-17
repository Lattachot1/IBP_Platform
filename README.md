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
├── docker-compose.yml             # Full-stack Docker orchestration (MS SQL, Backend, Frontend)
├── README.md                      # คู่มือระบบและคำสั่งเริ่มต้น
├── init-db/
│   └── 01-init.sql                # T-SQL Script สร้าง Database IBP_DB, Scenarios Table และ Seed Data
├── Backend/                       # Unified Python Backend (FastAPI)
│   ├── Dockerfile                 # Python 3.12-slim container image
│   ├── requirements.txt           # fastapi, uvicorn, pydantic, pymssql, pandas, statsmodels
│   ├── main.py                    # Simulation & Constraint Engine + REST API (MS SQL & In-Memory Fallback)
│   ├── database.py                # MS SQL Access Layer (pymssql) พร้อม In-Memory Fallback
│   ├── scripts/prepare_data.py    # แปลงไฟล์ Excel ของบริษัทเป็นข้อมูล local (ไม่ commit)
│   ├── artifacts/                 # forecast artifact ที่เทรนแล้ว (JSON, git-ignored)
│   ├── tests/                     # pytest บนข้อมูลสังเคราะห์ (ไม่ใช้ข้อมูลบริษัท)
│   └── forecasting/
│       ├── data.py / models.py / service.py / backtest.py   # Demand Forecast Engine (ตัน/เดือน ต่อ grade)
│       ├── registry.py            # ที่เก็บ engine ที่เทรนแล้วให้ router อื่นใช้
│       ├── price/                 # Sale Price Forecast Engine (USD/ตัน ต่อ grade, ผูกกับราคา BD)
│       │   ├── data.py            # ราคา FOB รายเดือนจาก billing + ราคา BD รายเดือน
│       │   ├── models.py          # Naive, ETS, BD pass-through, Ensemble
│       │   ├── service.py         # backtest, champion, interval, artifact I/O, forecast
│       │   ├── train.py           # CLI: python -m forecasting.price.train
│       │   └── api.py             # /api/v1/price/*, /api/v1/revenue/outlook
│       └── rawmat/                # Butadiene Forecast Engine (port จาก model-service เดิม)
│           ├── models.py          # random walk, drift, ETS(log), mean reversion, seasonal ETS
│           ├── service.py         # backtest h1-4, quantile P2.5-P97.5, artifact เดิม + metrics, scenario path
│           ├── train.py           # CLI: python -m forecasting.rawmat.train
│           ├── api.py             # /api/v1/raw-material-price/* (GET/POST เดิม + history, models, retrain)
│           └── samples/           # artifact 2026-09-13 จาก branch เดิม (fixture + fallback)
└── Frontend/
    ├── Dockerfile                 # Multi-stage Next.js standalone container
    ├── package.json               # Next.js 14, React 18, Tailwind CSS, Lucide React, Recharts
    ├── tsconfig.json
    ├── tailwind.config.js
    ├── next.config.mjs            # Standalone output configuration
    └── src/
        ├── app/
        │   ├── layout.tsx         # Enterprise theme layout
        │   ├── page.tsx           # Single-Page Executive Dashboard & Simulator
        │   └── globals.css        # Tailwind styling & animations
        ├── components/
        │   ├── DemandForecastPanel.tsx / ModelPerformancePanel.tsx   # Demand forecast UI
        │   ├── RawMaterialPanel.tsx      # Butadiene Price Outlook (P10/P50/P90 + backtest table)
        │   ├── SalePricePanel.tsx        # Sale price forecast + BD scenario UI (manual % หรือ BD forecast)
        │   └── RevenueOutlookPanel.tsx   # Demand x Price = FOB revenue outlook ตาม scenario
        └── lib/
            ├── forecastApi.ts     # typed client: demand endpoints
            ├── priceApi.ts        # typed client: price + revenue endpoints
            └── rawmatApi.ts       # typed client: butadiene endpoints
```

---

## 🚀 คู่มือการรันระบบ (Quickstart Guide)

### วิธีที่ 1: รัน Frontend & Backend ทันที (Standalone Mode - ไม่ต้องใช้ DB หรือ Docker)

ระบบได้รับการออกแบบให้มี **In-Memory Fallback Store** และ **Direct Calculation Engine** ทำให้สามารถรันและทดสอบได้ทันทีบนเครื่องของคุณ:

#### 1.1 รัน Frontend (Next.js - Port 3000)
```powershell
cd Frontend
# ติดตั้ง dependencies (หากยังไม่ได้รัน)
npm install

# รัน Development Server
npm run dev
```
เปิดบราวเซอร์ที่: **`http://localhost:3000`**  
*(หมายเหตุ: หน้า Dashboard มีระบบ Direct Simulation Engine ในตัว แม้ยังไม่ได้เปิด Backend หน้าเว็บก็สามารถจำลองสถานการณ์และคำนวณผลลัพธ์ได้อย่างแม่นยำ)*

#### 1.2 รัน Backend Service (Port 8080)
```powershell
cd Backend
pip install -r requirements.txt
python main.py
```
Backend จะเริ่มทำงานที่ **`http://localhost:8080`**
*(หากไม่ได้ตั้งค่าฐานข้อมูล ระบบจะใช้ In-Memory Fallback Store อัตโนมัติ)*

#### 1.3 Forecasting Engine (รวมอยู่ใน Backend แล้ว)
Forecasting Engine เดิม (model-service, Port 5000) ถูกรวมเข้ากับ Backend เป็นบริการ Python บริการเดียว
ดู Swagger docs ได้ที่ **`http://localhost:8080/docs`**

#### 1.4 เตรียมข้อมูลจริงสำหรับ Demand / Sale Price Forecast (ข้อมูลบริษัท ไม่ commit)
```powershell
cd Backend
python scripts/prepare_data.py --billing "<path>/Sale Billing TSL.xlsx" --bd "<path>/BDsea_price_history_~5y_2026-09-11.xlsx"
# -> DemandModel/sale_billing.csv และ data/bd_price_history.xlsx (ทั้งสองโฟลเดอร์ถูก git-ignore)

python -m forecasting.price.train      # backtest report + เขียน artifacts/sale_price_forecast.json
python -m forecasting.rawmat.train     # backtest report + เขียน artifacts/butadiene_forecast.json
python -m pytest                       # ชุดทดสอบบนข้อมูลสังเคราะห์
```
เมื่อ Backend เริ่มทำงาน Demand Engine จะเทรนจาก `DemandModel/` ส่วน Sale Price และ Butadiene Engine จะโหลด artifact
ถ้าไม่มี artifact จะเทรนครั้งเดียวแล้วเขียนไฟล์ให้ (train job → artifact → serve) และถ้าไม่มีไฟล์ BD เลย Butadiene Engine
จะเสิร์ฟ artifact ตัวอย่างวันที่ 2026-09-13 จาก branch เดิมแทน เรียก `POST /api/v1/price/retrain` และ
`POST /api/v1/raw-material-price/retrain` เมื่อข้อมูลเดือนใหม่เข้ามา

---

### วิธีที่ 2: Deploy ด้วย Docker Compose (Full Stack with MS SQL Server)

เมื่อเปิดใช้งาน Docker Desktop บนเครื่องของคุณ สามารถสั่งรันทุกเซอร์วิสพร้อม MS SQL 2022 ด้วยคำสั่งเดียว:

```bash
cp .env.example .env      # แก้ MSSQL_SA_PASSWORD และ DATABASE_URL ใน .env (ไม่มี .env ก็รันได้ด้วยค่า default)
docker compose up -d --build
```

**Services ที่จะถูกเปิดใช้งาน:**
- **Frontend Dashboard:** `http://localhost:3000`
- **Python Backend API (รวม Forecasting Engine):** `http://localhost:8080` (Swagger docs ที่ `http://localhost:8080/docs`)
- **MS SQL Server 2022:** `localhost:1433` (User: `sa`, Password: `YourStrong@Password!`, Database: `IBP_DB`)

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
- `POST /api/scenarios/save` — บันทึกผลลัพธ์ Scenario ลง Database และ Audit Trail
- `GET /api/scenarios` — ดึงประวัติ 10 Scenarios ล่าสุด
- `GET /api/health` — ตรวจสอบสถานะ Backend, Database, Demand Engine และ Price Engine
- Swagger docs — `http://localhost:8080/docs`

### Demand Forecast (`/api/v1`)
- `GET /api/v1/models` — champion ต่อ grade จาก rolling-origin backtest
- `GET /api/v1/history?product_id=` — ยอดขายรายเดือน (ตัน) ของ grade
- `GET /api/v1/forecast?product_id=&horizon_months=&demand_change_pct=` — พยากรณ์ปริมาณพร้อม 80% interval
- `POST /api/v1/retrain` — เทรนใหม่จาก `DemandModel/`

### Sale Price Forecast & Revenue Outlook (`/api/v1`)
- `GET /api/v1/price/models` — champion ต่อ grade พร้อม MAPE (ทั้งหมด / hold-out / naive) และ coverage
- `GET /api/v1/price/history?product_id=` — ราคา FOB และ net รายเดือน (USD/ตัน), ตัน, ราคา BD
- `GET /api/v1/price/forecast?product_id=&horizon_months=1..6&bd_change_pct=&bd_scenario=flat|low|base|high` — พยากรณ์ราคาพร้อม 80% interval ภายใต้ scenario ราคา BD (เดือนแรกใช้ BD จริงล่าสุด scenario มีผลตั้งแต่เดือนที่ 2) `flat` = ตรึง BD ที่ค่าล่าสุดแล้วขยับด้วย `bd_change_pct`, `low/base/high` = เส้นทาง P10/P50/P90 จาก Butadiene Engine
- `POST /api/v1/price/retrain` — เทรนใหม่และเขียน artifact
- `GET /api/v1/revenue/outlook?horizon_months=&bd_change_pct=&demand_change_pct=&bd_scenario=` — รายได้ FOB ต่อ grade = ปริมาณ × ราคา P50 ภายใต้ scenario เดียวกัน

### Butadiene Forecast (`/api/v1/raw-material-price`, สัญญาเดิมของ model-service)
- `GET|POST /api/v1/raw-material-price/forecast` — `symbol` (default PA0033242), `horizon_months` 1..6 → P2.5/P10/P50/P90/P97.5 และ best/base/worst purchase case ต่อเดือน พร้อม MAE แยก horizon และ coverage
- `GET /api/v1/raw-material-price/history` — ราคา BD รายเดือน
- `GET /api/v1/raw-material-price/models` — leaderboard ของ 5 โมเดล MAE h1-h4 / hold-out
- `POST /api/v1/raw-material-price/retrain` — เทรนใหม่และเขียน artifact

## 🛢 Butadiene Forecast (port จาก feature/butadiene-price-forecast)

- **สิ่งที่เก็บจาก branch เดิม:** schema ของ artifact ทุก field, endpoint และ payload เดิม (GET/POST), ตรรกะ validate ลำดับ quantile, หน้าตา UI section และข้อความเตือน; artifact วันที่ 2026-09-13 เก็บเป็น `forecasting/rawmat/samples/` สำหรับ test และ fallback
- **สิ่งที่เพิ่ม:** โค้ดเทรนที่ทำซ้ำได้ (`python -m forecasting.rawmat.train`), backtest 18 folds × 4 เดือน แบบ nested (champion จาก folds ช่วงแรก, 4 folds สุดท้ายเป็น hold-out), MAE แยก h1-h4 แทน MAE เดือนเดียว, coverage ของ P10-P90 บน hold-out, และ **scenario chaining** ให้ Sale Price และ Revenue ใช้เส้นทาง P10/P50/P90 ได้ทันที
- **ผลบนข้อมูลจริง (BD ถึง ส.ค. 2026):** champion คือ Mean reversion (24 เดือน, 15%/เดือน) MAE h1-h4 = 173 / 292 / 345 / 327 USD/t เทียบ random walk 176 / 328 / 401 / 407; hold-out ที่ครอบช่วงราคาพุ่งและร่วงปี 2026 สูงกว่ามาก (562 vs 700) และ coverage P10-P90 อยู่ที่ 38% จึงต้องอ่านเป็นช่วง ไม่ใช่ตัวเลขเดียว

---

## 💵 Sale Price Forecast (fast pilot)

- **เป้าหมาย:** ราคาขาย FOB เฉลี่ยรายเดือนต่อ grade (USD/ตัน ถ่วงน้ำหนักด้วยตัน) ล่วงหน้า 1-6 เดือน
- **ข้อมูล:** billing extract (ตัด void docs, แถวที่ยังไม่ post และตันเป็นศูนย์; แปลง THB/EUR เป็น USD) + ราคา Butadiene FOB SE Asia (Argus PA0033242) รายสัปดาห์เฉลี่ยเป็นรายเดือน
- **โมเดล:** Naive, ETS damped, **BD pass-through** (`p_t = a + b1·BD_{t-1} + b2·BD_{t-2} + c·p_{t-1}`), Ensemble — ราคาขายวิ่งตาม BD แบบ lag 1-2 เดือน
- **การทดสอบ:** rolling-origin backtest 16 folds × 3 เดือน โดยตรึง BD ในอนาคตที่ค่าล่าสุด (ไม่มี leakage); champion เลือกจาก 12 folds แรก และรายงาน 4 folds สุดท้ายเป็น hold-out แยกต่างหาก
- **Interval:** 80% จาก quantile ของ residual สัมพัทธ์ต่อ horizon (ไม่แคบลงตามระยะ) พร้อม hold-out coverage
- **ผลบนข้อมูลจริง (ก.ย. 2026):** pass-through ชนะ naive ทุก grade, MAPE รวม 3.9-7.0% เทียบ naive 6.4-11.1%; hold-out ที่ครอบช่วงราคาพุ่งปี 2026 สูงกว่านั้นและ coverage ต่ำกว่า 80% ซึ่งแสดงบนหน้าจอเสมอ
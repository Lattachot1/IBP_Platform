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
├── docker-compose.yml             # Full-stack Docker orchestration (MS SQL, Model, Backend, Frontend)
├── README.md                      # คู่มือระบบและคำสั่งเริ่มต้น
├── init-db/
│   └── 01-init.sql                # T-SQL Script สร้าง Database IBP_DB, Scenarios Table และ Seed Data
├── model-service/
│   ├── Dockerfile                 # Python 3.10-slim container image
│   ├── requirements.txt           # fastapi, uvicorn, pydantic
│   └── main.py                    # FastAPI Service: POST /api/v1/forecast (Confidence Intervals)
├── backend/
│   ├── Dockerfile                 # Multi-stage Golang container build
│   ├── go.mod                     # Go 1.22 module definition
│   ├── go.sum                     # Checksums for github.com/microsoft/go-mssqldb
│   ├── main.go                    # Go Simulation & Constraint Engine (MS SQL & In-Memory Fallback)
│   └── dev_runner.py              # Optional Python Dev Runner บน Port 8080 สำหรับรันเทสทันที
└── frontend/
    ├── Dockerfile                 # Multi-stage Next.js standalone container
    ├── package.json               # Next.js 14, React 18, Tailwind CSS, Lucide React
    ├── tsconfig.json
    ├── tailwind.config.js
    ├── next.config.mjs            # Standalone output configuration
    └── src/
        └── app/
            ├── layout.tsx         # Enterprise theme layout
            ├── page.tsx           # Single-Page Executive Dashboard & Simulator
            └── globals.css        # Tailwind styling & animations
```

---

## 🚀 คู่มือการรันระบบ (Quickstart Guide)

### วิธีที่ 1: รัน Frontend & Backend ทันที (Standalone Mode - ไม่ต้องใช้ DB หรือ Docker)

ระบบได้รับการออกแบบให้มี **In-Memory Fallback Store** และ **Direct Calculation Engine** ทำให้สามารถรันและทดสอบได้ทันทีบนเครื่องของคุณ:

#### 1.1 รัน Frontend (Next.js - Port 3000)
```powershell
cd frontend
# ติดตั้ง dependencies (หากยังไม่ได้รัน)
npm install

# รัน Development Server
npm run dev
```
เปิดบราวเซอร์ที่: **`http://localhost:3000`**  
*(หมายเหตุ: หน้า Dashboard มีระบบ Direct Simulation Engine ในตัว แม้ยังไม่ได้เปิด Backend หน้าเว็บก็สามารถจำลองสถานการณ์และคำนวณผลลัพธ์ได้อย่างแม่นยำ)*

#### 1.2 รัน Backend Service (Port 8080)
คุณสามารถเลือกใช้ Go Backend หรือ Python Dev Runner:

- **ผ่าน Go (หากมี Go ติดตั้งในเครื่อง):**
  ```powershell
  cd backend
  go run main.go
  ```
- **หรือผ่าน Python Dev Runner (ทดสอบได้ทันทีบนเครื่องของคุณ):**
  ```powershell
  cd backend
  python dev_runner.py
  ```
Backend จะเริ่มทำงานที่ **`http://localhost:8080`**

#### 1.3 รัน Model Service (Python FastAPI - Port 5000 - ตัวเลือกเพิ่มเติม)
```powershell
cd model-service
python main.py
```
Model Service จะเริ่มทำงานที่ **`http://localhost:5000`**

---

### วิธีที่ 2: Deploy ด้วย Docker Compose (Full Stack with MS SQL Server)

เมื่อเปิดใช้งาน Docker Desktop บนเครื่องของคุณ สามารถสั่งรันทุกเซอร์วิสพร้อม MS SQL 2022 ด้วยคำสั่งเดียว:

```bash
docker compose up -d --build
```

**Services ที่จะถูกเปิดใช้งาน:**
- **Frontend Dashboard:** `http://localhost:3000`
- **Go Backend API:** `http://localhost:8080`
- **FastAPI Model Service:** `http://localhost:5000` (Swagger docs ที่ `http://localhost:5000/docs`)
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

### Go Backend (`:8080`)
- `POST /api/simulate` — คำนวณผลกระทบ Demand, Capacity, Service Level, และ Financials
- `POST /api/scenarios/save` — บันทึกผลลัพธ์ Scenario ลง Database และ Audit Trail
- `GET /api/scenarios` — ดึงประวัติ 10 Scenarios ล่าสุด
- `GET /api/health` — ตรวจสอบสถานะ Backend, Database, และ Model Service

### Model Service (`:5000`)
- `POST /api/v1/forecast` — รับ `base_demand` และ `demand_change_pct` ส่งกลับค่า Forecast และ Confidence Interval (±5%)
- `GET /health` — Health check endpoint
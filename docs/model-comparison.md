# Model Comparison & Research Summary (Demand Forecasting)

สรุปผลการวิจัยและเปรียบเทียบโมเดลทั้งหมดของระบบพยากรณ์ดีมานด์
ข้อมูลจริง: billing extract 33,512 แถว (2019-04..2026-08) · หน่วย: ton/เดือน · 4 pilot grades

---

## Protocol (กติกาที่คงไว้ทุกรอบ)

- **Test = ปี 2026 ทั้งหมด** (ม.ค.-ส.ค. 8 เดือน; ก.ย. ยังไม่จบถูกตัดออก) — ไม่เคยถูกใช้เทรน
- **Tuning ทั้งหมดวัดด้วย inner CV บน train period เท่านั้น** (2019-04..2025-12, 5 folds × horizon 8)
- **MASE < 1.0 gate**: โมเดลที่ไม่ชนะ SeasonalNaive (benchmark "ก๊อปปี้ปีก่อน") จะไม่ได้เป็น champion
- **ไม่มี random split** ในทุกการทดสอบ (กัน time-series leakage)

---

## Champion สุดท้ายราย Grade (frozen)

| Grade | Champion | คาดหวัง (inner CV) | **ผลจริง 2026** | naive | มือ ~10% |
|---|---|---|---|---|---|
| UBEPOL BR150 | GBR-median (lags+calendar) | 28.0% | **17.9%** | 27.2% | ยังไม่ถึง |
| UBEPOL BR150L | MED-ENS 4 โมเดล | 17.2% | **15.8%** | 18.3% | ยังไม่ถึง |
| UBEPOL VCR617 | BU-material top-2/4 | 27.8% | **10.5%** | 17.1% | ✅ ใกล้เคียง |
| UBEPOL VCR412 | BU-material / ARIMA(2,1,2) | 26.3% | **13.8% / 10.3%** | 27.4% | ใกล้เคียง |

เฉลี่ย best-per-grade: **12.1-14.5%** (naive 22.5%) · runtime gate เลือกเองบนข้อมูลทั้งหมด: BR150 MED-ENS 17.1% / BR150L GBR 14.6% / VCR617 GBR 15.9% / VCR412 SARIMA 20.2%

---

## บทเรียนจากแต่ละรอบการทดลอง (5 รอบ + shootout)

### รอบ 1-2: โมเดลพื้นฐาน + coordinate search
- SeasonalNaive → Holt-Winters → SARIMA(1,0,1)(1,1,1,12): rolling WAPE 15-21%
- **ปรับ hyperparameter GBR 5 ชุด (ทีละนิด) ขยับแค่ ±0.2pp** — พารามิเตอร์ไม่ใช่ทางรอด
- median-loss (absolute_error) ชนะ mean-loss เพราะ WAPE ถูก minimize ด้วย median

### รอบ 3: ข้อมูลภายนอก
- Brent (FRED) + THB/USD + ราคาขายในไฟล์เอง (NetAmtUSD/QTY ครบ 89/89 เดือน) เป็น lagged features
- direct per-horizon GB ชนะ recursive; VCR412 ดีขึ้น −3.7pp

### รอบ 4: Bottom-up
- **ระดับ material ได้ผลจริง** (VCR617 → 10.5%, VCR412 → 13.8%)
- ระดับ customer ไม่ work (series รายลูกค้าถี่หยุกหยิกเกิน — inner CV 38-115%)

### รอบ 5: วิธีแปลกใหม่
- **GBR coordinate search**: ±0.2pp — ยืนยันซ้ำว่าพารามิเตอร์ไม่ใช่ปัจจัย
- **Global model** (เทรนรวม 4 grades แบบ M5): holdout ปฏิเสธ (21-40%)
- **Theta**: ไม่ได้เทรน (statsmodels bug) — ตระกูลเดียวกับ ETS ที่ผล 19-24%

### Shootout: 9 อัลกอริทึมใหม่ (RF, XGBoost, ANN, ARIMA, LSTM, BiLSTM, CNN, LSTM+CNN, BiLSTM+CNN)
- inner CV ทุกตระกูลรวมอยู่ 18.5-19.5% — **deep learning ไม่ทะลุพื้นข้อมูล 81 จุด**
- holdout: BR150L ANN 14.6% (ดีสุดของ window), VCR412 ARIMA 10.3%, VCR617 CNN 11.0%
- อันดับเปลี่ยนตามหน้าต่าง — จึงเก็บหลายโมเดลแข่งและให้ gate ตัดสิน

### รอบ 6: เพิ่มเกรด BR150B + BR360B (intermittent candidates)

- เพิ่ม Croston / SBA / TSB (สามมาตรฐานของ intermittent demand) เข้าระบบสำหรับ 2 เกรดแคมเปญ
- **ข้อค้นพบแก้ข้อสรุปเดิม**: บนฐานเวลา Billing Date ทั้งสองเกรดแทบไม่ sparse (BR150B active 81/81 เดือน, BR360B 58/61) — ตัวเลข "สะดุด" รอบก่อนคือมุมมอง ETD ซึ่งขายในประเทศไม่มี
- **BR150B: champion TSB, inner CV 10.0%, holdout 12.4%** — เกรดใหม่ที่แม่นที่สุดของระบบ
- **BR360B**: ยอดน้อย (~244 t/เดือน) ผันผวนสูง — holdout ดีสุดคือ SeasonalNaive 24.4%, runtime gate เลือก ETS (inner 23.9%) ตามข้อมูล train อย่างตรงไปตรงมา; Croston/SBA/TSB แพ้เพราะเกรดนี้ไม่ได้ intermittent จริง
- ประโยชน์เสริม: การเพิ่ม BU-material เข้า MED-ENS ของเกรดหลักช่วย BR150L (14.6% → 13.4% inner)

### รอบ 7: Fold-protocol sweep (จำนวน/ขนาด fold ช่วยไหม?)

- ทดสอบ 5 protocols (8/16/24 folds × horizon 3/6/12) ทุกเกรด — สรุป: **เปลี่ยน fold = เปลี่ยนไม้บรรทัด ไม่ใช่เปลี่ยนความสามารถ** ค่า holdout ของ champion คงเดิม (spread 0.0-0.4pp) ใน 5/6 เกรด
- อ่าน inner CV ข้าม protocol ไม่ได้: fewer folds ทำให้ตัวเลข "สวยขึ้น" (train window ยาวขึ้น) แต่ความแม่นจริงเท่าเดิม
- ข้อยกเว้นเดียว: BR150 ที่ champion สลับ BU↔GBR ตาม protocol (holdout 28.9% vs 17.9%) — runtime ปลอดภัยเพราะมี MED-ENS ครอบ

---

## ข้อสรุปและก้าวต่อไป

1. **พื้นข้อมูลปัจจุบันคือ ~14-18%** — ทั้ง inner CV และ holdout ตรงกัน; ปรับพารามิเตอร์ต่อไม่ลด
2. **ช่องว่างสู่ ~10% (ระดับมือมนุษย์) คือข้อมูลที่มนุษย์ใช้แต่ CSV ไม่มี** — ตัวชี้วัดชัดที่สุดคือ open order book จาก SAP (ยอดยืนยันแล้วที่กำลังจะบิล) เป็น feature
3. **ตัวเลข holdout ถูกใช้ประเมินหลายรอบแล้ว** — การ validate ครั้งถัดไปต้องใช้เดือนใหม่ที่โพสต์เข้ามาภายหลังเท่านั้น
4. การเชื่อมต่อปลายทาง: forecast → `SalePlan` ของ production optimizer (PuLP MILP) คือสถาปัตยกรรม IBP ครบวง

---

## วิธี reproduce

```powershell
cd Backend
python -m forecasting.backtest            # rolling-origin backtest 4 grades
python -m forecasting.holdout_shootout    # เทียบทุกโมเดลบน holdout 2026
```

ไฟล์โมเดลผู้เข้าแข่งขัน: `forecasting/candidates/` · runtime champion: `forecasting/service.py` (16-fold + MASE gate)

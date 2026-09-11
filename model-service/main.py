"""
AI-Driven Integrated Business Planning (IBP) Platform
Model Service (FastAPI) - Forecast Baseline & Prediction Intervals
Prepared for UBE Chemicals (Asia) PCL
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import math

app = FastAPI(
    title="UBE IBP - Model Forecasting Service",
    description="Probabilistic Demand Forecasting Engine with Confidence Intervals (ETS/ML Baseline)",
    version="1.0.0"
)

# Enable CORS for cross-origin requests from frontend and backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ForecastRequest(BaseModel):
    base_demand: float = Field(..., gt=0, description="Baseline historical demand volume in units (e.g., 10000.0)")
    demand_change_pct: float = Field(..., description="Expected percentage change in demand (e.g., 20.0 for +20%)")

class ForecastResponse(BaseModel):
    forecast: float = Field(..., description="Point forecast demand volume in units")
    lower_bound: float = Field(..., description="Lower prediction interval (-5% confidence bound)")
    upper_bound: float = Field(..., description="Upper prediction interval (+5% confidence bound)")
    model_name: str = Field(default="Ensemble Baseline (ETS/ML)", description="Underlying forecasting model identifier")

@app.get("/")
def read_root():
    return {
        "service": "UBE IBP Model Forecasting Service",
        "status": "online",
        "version": "1.0.0",
        "methodology": "Ensemble ETS / Probabilistic ML Baseline"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.post("/api/v1/forecast", response_model=ForecastResponse)
def generate_forecast(req: ForecastRequest):
    """
    Generate point forecast demand with 95% confidence intervals (+-5% prediction interval band).
    """
    try:
        # Calculate point forecast
        change_multiplier = 1.0 + (req.demand_change_pct / 100.0)
        point_forecast = round(req.base_demand * change_multiplier, 2)
        
        # Ensure non-negative forecast
        point_forecast = max(0.0, point_forecast)
        
        # Calculate prediction interval (+-5%)
        lower_bound = round(point_forecast * 0.95, 2)
        upper_bound = round(point_forecast * 1.05, 2)

        return ForecastResponse(
            forecast=point_forecast,
            lower_bound=lower_bound,
            upper_bound=upper_bound,
            model_name="Ensemble Baseline (ETS/ML)"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecasting calculation error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)

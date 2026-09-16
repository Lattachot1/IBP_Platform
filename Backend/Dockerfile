# UBE IBP Platform - Unified Python Backend (FastAPI)
# Simulation & Constraint Engine + in-process Forecasting Engine
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080
CMD ["python", "main.py"]

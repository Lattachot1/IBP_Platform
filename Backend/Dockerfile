# UBE IBP Platform - Unified Python Backend (FastAPI)
# Simulation & Constraint Engine + in-process Forecasting Engine
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The billing data is mounted at runtime (docker-compose), never baked in
RUN useradd --create-home --uid 1001 ibp
USER ibp

EXPOSE 8080
CMD ["python", "main.py"]

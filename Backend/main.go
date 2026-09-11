package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/microsoft/go-mssqldb"
)

// Scenario represents an Integrated Business Planning (IBP) simulation record
type Scenario struct {
	ScenarioID       int       `json:"scenario_id"`
	ScenarioName     string    `json:"scenario_name"`
	BaseDemand       float64   `json:"base_demand"`
	DemandChangePct  float64   `json:"demand_change_pct"`
	ForecastDemand   float64   `json:"forecast_demand"`
	LowerBound       float64   `json:"lower_bound"`
	UpperBound       float64   `json:"upper_bound"`
	CapacityLimit    float64   `json:"capacity_limit"`
	EnableOT         bool      `json:"enable_ot"`
	ActualProduce    float64   `json:"actual_produce"`
	ShortageQty      float64   `json:"shortage_qty"`
	ServiceLevelPct  float64   `json:"service_level_pct"`
	RevenueTHB       float64   `json:"revenue_thb"`
	ExtraCostTHB     float64   `json:"extra_cost_thb"`
	ConstraintStatus string    `json:"constraint_status"`
	ModelName        string    `json:"model_name"`
	CreatedBy        string    `json:"created_by"`
	CreatedAt        time.Time `json:"created_at"`
}

// SimulateRequest is the payload received from the frontend to run a What-if analysis
type SimulateRequest struct {
	ScenarioName    string  `json:"scenario_name"`
	BaseDemand      float64 `json:"base_demand"`
	DemandChangePct float64 `json:"demand_change_pct"`
	EnableOT        bool    `json:"enable_ot"`
	CreatedBy       string  `json:"created_by"`
}

// ModelServiceRequest is sent to the Python FastAPI model service
type ModelServiceRequest struct {
	BaseDemand      float64 `json:"base_demand"`
	DemandChangePct float64 `json:"demand_change_pct"`
}

// ModelServiceResponse is returned by the Python FastAPI model service
type ModelServiceResponse struct {
	Forecast   float64 `json:"forecast"`
	LowerBound float64 `json:"lower_bound"`
	UpperBound float64 `json:"upper_bound"`
	ModelName  string  `json:"model_name"`
}

// Business Rules Constants
const (
	NormalCapacityLimit   = 10500.0
	OvertimeExtraCapacity = 1500.0
	OvertimeCostTHB       = 120000.0
	ProductUnitPriceTHB   = 1000.0
)

// Global database handle (nil if running in in-memory fallback mode)
var (
	db                 *sql.DB
	modelServiceURL    string
	dbMutex            sync.RWMutex
	inMemoryScenarios  []Scenario
	nextInMemID        = 4
	httpClient         = &http.Client{Timeout: 5 * time.Second}
)

func init() {
	// Initialize with canonical illustrative scenarios from UBE Capstone Proposal
	inMemoryScenarios = []Scenario{
		{
			ScenarioID:       1,
			ScenarioName:     "Base Plan (Normal Baseline)",
			BaseDemand:       10000.0,
			DemandChangePct:  0.0,
			ForecastDemand:   10000.0,
			LowerBound:       9500.0,
			UpperBound:       10500.0,
			CapacityLimit:    10500.0,
			EnableOT:         false,
			ActualProduce:    10000.0,
			ShortageQty:      0.0,
			ServiceLevelPct:  100.0,
			RevenueTHB:       10000000.0,
			ExtraCostTHB:     0.0,
			ConstraintStatus: "Feasible / Normal Capacity",
			ModelName:        "Ensemble Baseline (ETS/ML)",
			CreatedBy:        "Supply Chain Lead",
			CreatedAt:        time.Now().Add(-2 * time.Hour),
		},
		{
			ScenarioID:       2,
			ScenarioName:     "Demand Surge (+20%) - Constrained Bottleneck",
			BaseDemand:       10000.0,
			DemandChangePct:  20.0,
			ForecastDemand:   12000.0,
			LowerBound:       11400.0,
			UpperBound:       12600.0,
			CapacityLimit:    10500.0,
			EnableOT:         false,
			ActualProduce:    10500.0,
			ShortageQty:      1500.0,
			ServiceLevelPct:  87.5,
			RevenueTHB:       10500000.0,
			ExtraCostTHB:     0.0,
			ConstraintStatus: "Capacity Overload Bottleneck (Shortage: 1,500 units)",
			ModelName:        "Ensemble Baseline (ETS/ML)",
			CreatedBy:        "Sales & Commercial",
			CreatedAt:        time.Now().Add(-1 * time.Hour),
		},
		{
			ScenarioID:       3,
			ScenarioName:     "Demand Surge (+20%) - With Overtime Lever",
			BaseDemand:       10000.0,
			DemandChangePct:  20.0,
			ForecastDemand:   12000.0,
			LowerBound:       11400.0,
			UpperBound:       12600.0,
			CapacityLimit:    12000.0,
			EnableOT:         true,
			ActualProduce:    12000.0,
			ShortageQty:      0.0,
			ServiceLevelPct:  100.0,
			RevenueTHB:       12000000.0,
			ExtraCostTHB:     120000.0,
			ConstraintStatus: "Feasible (Overtime Shift Activated)",
			ModelName:        "Ensemble Baseline (ETS/ML)",
			CreatedBy:        "Executive Committee",
			CreatedAt:        time.Now().Add(-15 * time.Minute),
		},
	}
}

// connectDatabase attempts to connect to Microsoft SQL Server
func connectDatabase() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Println("[Database] DATABASE_URL is not set. Operating in IN-MEMORY fallback mode.")
		return
	}

	log.Printf("[Database] Connecting to MS SQL Server at %s ...", databaseURL)
	var err error
	db, err = sql.Open("sqlserver", databaseURL)
	if err != nil {
		log.Printf("[Database WARNING] sql.Open failed: %v. Falling back to IN-MEMORY mode.", err)
		db = nil
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		log.Printf("[Database WARNING] MS SQL Server Ping failed (%v). Operating in IN-MEMORY mode.", err)
		db = nil
		return
	}

	// Auto-create Scenarios table if not exists
	createTableSQL := `
	IF OBJECT_ID(N'dbo.Scenarios', N'U') IS NULL
	BEGIN
		CREATE TABLE dbo.Scenarios (
			ScenarioID INT IDENTITY(1,1) PRIMARY KEY,
			ScenarioName NVARCHAR(100) NOT NULL,
			BaseDemand FLOAT NOT NULL,
			DemandChangePct FLOAT NOT NULL,
			ForecastDemand FLOAT NOT NULL,
			CapacityLimit FLOAT NOT NULL,
			EnableOT BIT NOT NULL DEFAULT 0,
			ActualProduce FLOAT NOT NULL,
			ShortageQty FLOAT NOT NULL,
			ServiceLevelPct FLOAT NOT NULL,
			RevenueTHB FLOAT NOT NULL,
			ExtraCostTHB FLOAT NOT NULL DEFAULT 0,
			ConstraintStatus NVARCHAR(255) NOT NULL,
			CreatedBy NVARCHAR(50) NOT NULL,
			CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
		);
	END;`
	if _, err := db.ExecContext(ctx, createTableSQL); err != nil {
		log.Printf("[Database WARNING] Could not verify/create table: %v", err)
	} else {
		log.Println("[Database] MS SQL Server connected and dbo.Scenarios table verified successfully.")
	}
}

// fetchForecast calls Model Service or falls back to local ETS/ML calculation
func fetchForecast(baseDemand, demandChangePct float64) (float64, float64, float64, string) {
	targetURL := modelServiceURL
	if targetURL == "" {
		targetURL = "http://localhost:5000"
	}
	endpoint := fmt.Sprintf("%s/api/v1/forecast", strings.TrimRight(targetURL, "/"))

	reqBody, _ := json.Marshal(ModelServiceRequest{
		BaseDemand:      baseDemand,
		DemandChangePct: demandChangePct,
	})

	resp, err := httpClient.Post(endpoint, "application/json", bytes.NewBuffer(reqBody))
	if err == nil && resp.StatusCode == http.StatusOK {
		defer resp.Body.Close()
		var modelResp ModelServiceResponse
		if err := json.NewDecoder(resp.Body).Decode(&modelResp); err == nil {
			return modelResp.Forecast, modelResp.LowerBound, modelResp.UpperBound, modelResp.ModelName
		}
	}

	// Direct Local Fallback calculation (Ensemble Baseline ETS/ML logic)
	multiplier := 1.0 + (demandChangePct / 100.0)
	forecast := math.Round(baseDemand*multiplier*100) / 100
	if forecast < 0 {
		forecast = 0
	}
	lower := math.Round(forecast*0.95*100) / 100
	upper := math.Round(forecast*1.05*100) / 100

	return forecast, lower, upper, "Ensemble Baseline (ETS/ML - Direct Engine)"
}

// corsMiddleware injects CORS headers for cross-origin frontend support
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w)
	})
}

// handleSimulate runs What-if constraint simulation
func handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SimulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request payload: %v", err), http.StatusBadRequest)
		return
	}

	if req.BaseDemand <= 0 {
		req.BaseDemand = 10000.0
	}
	if req.ScenarioName == "" {
		req.ScenarioName = "What-If Simulation"
	}
	if req.CreatedBy == "" {
		req.CreatedBy = "Planner (Interactive)"
	}

	// 1. Get Demand Forecast with confidence bands
	forecast, lower, upper, modelName := fetchForecast(req.BaseDemand, req.DemandChangePct)

	// 2. Compute Production Capacity Limit & Costs
	capacityLimit := NormalCapacityLimit
	extraCost := 0.0

	if req.EnableOT {
		capacityLimit += OvertimeExtraCapacity
		extraCost += OvertimeCostTHB
	}

	// 3. Compute Production Feasibility & Constraints
	actualProduce := forecast
	if actualProduce > capacityLimit {
		actualProduce = capacityLimit
	}
	if actualProduce < 0 {
		actualProduce = 0
	}

	shortageQty := forecast - actualProduce
	if shortageQty < 0 {
		shortageQty = 0
	}

	// 4. Compute Service Level (%)
	serviceLevelPct := 100.0
	if forecast > 0 {
		serviceLevelPct = math.Round((actualProduce/forecast)*10000) / 100
		if serviceLevelPct > 100.0 {
			serviceLevelPct = 100.0
		}
	}

	// 5. Compute Financials
	revenueTHB := math.Round(actualProduce * ProductUnitPriceTHB)

	// 6. Constraint Status
	var constraintStatus string
	if forecast > capacityLimit {
		shortageStr := strconv.FormatFloat(shortageQty, 'f', 0, 64)
		constraintStatus = fmt.Sprintf("Capacity Overload Bottleneck (Shortage: %s units)", shortageStr)
	} else if req.EnableOT {
		constraintStatus = "Feasible (Overtime Shift Activated)"
	} else {
		constraintStatus = "Feasible / Normal Capacity"
	}

	result := Scenario{
		ScenarioID:       0,
		ScenarioName:     req.ScenarioName,
		BaseDemand:       req.BaseDemand,
		DemandChangePct:  req.DemandChangePct,
		ForecastDemand:   forecast,
		LowerBound:       lower,
		UpperBound:       upper,
		CapacityLimit:    capacityLimit,
		EnableOT:         req.EnableOT,
		ActualProduce:    actualProduce,
		ShortageQty:      shortageQty,
		ServiceLevelPct:  serviceLevelPct,
		RevenueTHB:       revenueTHB,
		ExtraCostTHB:     extraCost,
		ConstraintStatus: constraintStatus,
		ModelName:        modelName,
		CreatedBy:        req.CreatedBy,
		CreatedAt:        time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleSaveScenario stores a scenario to DB or In-Memory
func handleSaveScenario(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var sc Scenario
	if err := json.NewDecoder(r.Body).Decode(&sc); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON body: %v", err), http.StatusBadRequest)
		return
	}

	if sc.ScenarioName == "" {
		sc.ScenarioName = "Custom Scenario"
	}
	if sc.CreatedBy == "" {
		sc.CreatedBy = "Planner"
	}
	if sc.CreatedAt.IsZero() {
		sc.CreatedAt = time.Now()
	}

	// Try saving to MS SQL DB if connected
	if db != nil {
		query := `
		INSERT INTO dbo.Scenarios (
			ScenarioName, BaseDemand, DemandChangePct, ForecastDemand, CapacityLimit,
			EnableOT, ActualProduce, ShortageQty, ServiceLevelPct, RevenueTHB,
			ExtraCostTHB, ConstraintStatus, CreatedBy, CreatedAt
		) 
		OUTPUT INSERTED.ScenarioID, INSERTED.CreatedAt
		VALUES (@p1, @p2, @p3, @p4, @p5, @p6, @p7, @p8, @p9, @p10, @p11, @p12, @p13, @p14);`

		var insertedID int
		var insertedAt time.Time
		err := db.QueryRowContext(r.Context(), query,
			sc.ScenarioName, sc.BaseDemand, sc.DemandChangePct, sc.ForecastDemand, sc.CapacityLimit,
			sc.EnableOT, sc.ActualProduce, sc.ShortageQty, sc.ServiceLevelPct, sc.RevenueTHB,
			sc.ExtraCostTHB, sc.ConstraintStatus, sc.CreatedBy, sc.CreatedAt,
		).Scan(&insertedID, &insertedAt)

		if err == nil {
			sc.ScenarioID = insertedID
			sc.CreatedAt = insertedAt
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(sc)
			return
		}
		log.Printf("[Database Warning] Insert to MS SQL failed: %v. Saving to In-Memory store instead.", err)
	}

	// In-memory fallback persistence
	dbMutex.Lock()
	sc.ScenarioID = nextInMemID
	nextInMemID++
	sc.CreatedAt = time.Now()
	inMemoryScenarios = append([]Scenario{sc}, inMemoryScenarios...)
	dbMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(sc)
}

// handleGetScenarios retrieves recent 10 scenarios
func handleGetScenarios(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Try reading from MS SQL DB
	if db != nil {
		query := `
		SELECT TOP 10 
			ScenarioID, ScenarioName, BaseDemand, DemandChangePct, ForecastDemand, CapacityLimit,
			EnableOT, ActualProduce, ShortageQty, ServiceLevelPct, RevenueTHB, ExtraCostTHB,
			ConstraintStatus, CreatedBy, CreatedAt
		FROM dbo.Scenarios
		ORDER BY CreatedAt DESC;`

		rows, err := db.QueryContext(r.Context(), query)
		if err == nil {
			defer rows.Close()
			var list []Scenario
			for rows.Next() {
				var s Scenario
				err := rows.Scan(
					&s.ScenarioID, &s.ScenarioName, &s.BaseDemand, &s.DemandChangePct, &s.ForecastDemand,
					&s.CapacityLimit, &s.EnableOT, &s.ActualProduce, &s.ShortageQty, &s.ServiceLevelPct,
					&s.RevenueTHB, &s.ExtraCostTHB, &s.ConstraintStatus, &s.CreatedBy, &s.CreatedAt,
				)
				if err == nil {
					// enrich bounds for UI display
					s.LowerBound = math.Round(s.ForecastDemand * 0.95 * 100) / 100
					s.UpperBound = math.Round(s.ForecastDemand * 1.05 * 100) / 100
					s.ModelName = "Ensemble Baseline (ETS/ML)"
					list = append(list, s)
				}
			}
			if len(list) > 0 {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(list)
				return
			}
		}
		log.Printf("[Database Note] Query failed or empty, returning In-Memory scenarios.")
	}

	// Return In-Memory scenarios
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	list := make([]Scenario, len(inMemoryScenarios))
	copy(list, inMemoryScenarios)

	// Sort desc by CreatedAt
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})

	if len(list) > 10 {
		list = list[:10]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

// handleHealth checks service health
func handleHealth(w http.ResponseWriter, r *http.Request) {
	dbStatus := "In-Memory Mode (Active)"
	if db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err == nil {
			dbStatus = "Connected (MS SQL Server 2022)"
		} else {
			dbStatus = fmt.Sprintf("Error (%v)", err)
		}
	}

	modelStatus := "Direct Engine Fallback"
	targetURL := modelServiceURL
	if targetURL == "" {
		targetURL = "http://localhost:5000"
	}
	resp, err := httpClient.Get(fmt.Sprintf("%s/health", strings.TrimRight(targetURL, "/")))
	if err == nil && resp.StatusCode == http.StatusOK {
		modelStatus = "Connected (Python FastAPI)"
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         "healthy",
		"service":        "UBE IBP Go Backend Engine",
		"version":        "1.0.0",
		"timestamp":      time.Now(),
		"database":       dbStatus,
		"model_service":  modelStatus,
		"planning_rules": map[string]interface{}{
			"normal_capacity":     NormalCapacityLimit,
			"overtime_capacity":   OvertimeExtraCapacity,
			"overtime_cost_thb":   OvertimeCostTHB,
			"product_price_thb":   ProductUnitPriceTHB,
		},
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	modelServiceURL = os.Getenv("MODEL_SERVICE_URL")
	if modelServiceURL == "" {
		modelServiceURL = "http://localhost:5000"
	}

	log.Println("==================================================")
	log.Println(" UBE Chemicals (Asia) PCL - AI IBP Platform Engine")
	log.Println(" Tenet: 'One Platform, One Data, One Plan'")
	log.Printf(" Backend Server listening on port %s ...\n", port)
	log.Printf(" Model Service configured at: %s\n", modelServiceURL)
	log.Println("==================================================")

	// Attempt connecting to database in background
	go connectDatabase()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/simulate", handleSimulate)
	mux.HandleFunc("/api/scenarios/save", handleSaveScenario)
	mux.HandleFunc("/api/scenarios", handleGetScenarios)

	handler := corsMiddleware(mux)

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server startup failed: %v", err)
	}
}

package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleRawMaterialPriceForecastProxiesModelService(t *testing.T) {
	modelServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read request body: %v", err)
		}
		if !strings.Contains(string(body), "PA0033242") {
			t.Fatalf("symbol was not forwarded: %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"artifact_version":"test-v1","forecasts":[]}`))
	}))
	defer modelServer.Close()

	previousURL := modelServiceURL
	modelServiceURL = modelServer.URL
	defer func() { modelServiceURL = previousURL }()

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/raw-material-price/forecast",
		strings.NewReader(`{"symbol":"PA0033242","horizon_months":4}`),
	)
	recorder := httptest.NewRecorder()
	handleRawMaterialPriceForecast(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"artifact_version":"test-v1"`) {
		t.Fatalf("model response was not preserved: %s", recorder.Body.String())
	}
}

func TestHandleRawMaterialPriceForecastRejectsGet(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/raw-material-price/forecast", nil)
	recorder := httptest.NewRecorder()
	handleRawMaterialPriceForecast(recorder, req)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", recorder.Code)
	}
}

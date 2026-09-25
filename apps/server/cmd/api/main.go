package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/NUMaters/civileng-project/apps/server/internal/gamedata"
)

type healthResponse struct {
	Status string `json:"status"`
}

func main() {
	root, err := gamedata.ResolveRoot()
	if err != nil {
		log.Fatalf("game-data: %v", err)
	}
	bundle, err := gamedata.Load(root)
	if err != nil {
		log.Fatalf("game-data load: %v", err)
	}
	log.Printf("game-data loaded from %s (%d structures)", root, len(bundle.Structures))

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /v1/game-data", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, bundle)
	})
	mux.HandleFunc("GET /v1/game-data/structures", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, bundle.Structures)
	})
	mux.HandleFunc("GET /v1/game-data/rules", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, bundle.Rules)
	})

	addr := envOrDefault("API_ADDR", ":8080")
	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	log.Printf("api server listening on %s", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("api server failed: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode response failed: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

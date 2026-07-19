package main

import (
	"log"
	"net/http"
	"os"

	"github.com/NUMaters/civileng-project/apps/server/internal/game/realtime"
)

func main() {
	session := realtime.NewSessionStore()
	hub := realtime.NewHub(session)
	go hub.Run()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		realtime.ServeWS(hub, w, r)
	})

	addr := envOrDefault("GAME_ADDR", ":8081")
	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	log.Printf("game server listening on %s (ws: /ws)", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("game server failed: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

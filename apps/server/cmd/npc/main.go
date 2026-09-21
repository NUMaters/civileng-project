package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc"
)

func main() {
	addr := envOrDefault("NPC_BACKEND_ADDR", "127.0.0.1:8082")
	if os.Getenv("NPC_BACKEND_TOKEN") == "" && !loopbackOnly(addr) {
		log.Fatal("NPC_BACKEND_TOKEN is required when NPC Backend listens outside loopback")
	}

	mux := http.NewServeMux()
	if err := npc.RegisterBackend(mux); err != nil {
		log.Fatalf("NPC Backend initialization failed: %v", err)
	}
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	server := &http.Server{Addr: addr, Handler: mux}
	log.Printf("NPC Backend listening on %s (internal: /internal/v1/npc/answers)", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("NPC Backend failed: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func loopbackOnly(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

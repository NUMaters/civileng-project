package main

import "testing"

func TestHealthResponseShape(t *testing.T) {
	t.Parallel()

	response := healthResponse{Status: "ok"}
	if response.Status != "ok" {
		t.Fatalf("expected status ok, got %s", response.Status)
	}
}

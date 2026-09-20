package presentation

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestIPRateLimiterBoundsRequestsAndResets(t *testing.T) {
	clock := time.Now()
	limiter := newIPRateLimiter(2, time.Minute)
	limiter.now = func() time.Time { return clock }
	request := httptest.NewRequest("POST", "/api/npc/conversations", nil)
	request.RemoteAddr = "192.0.2.1:12345"
	if !limiter.allow(request) {
		t.Fatal("first request was unexpectedly rejected")
	}
	if !limiter.allow(request) {
		t.Fatal("second request was unexpectedly rejected")
	}
	if limiter.allow(request) {
		t.Fatal("rate limit was not enforced")
	}
	clock = clock.Add(time.Minute)
	if !limiter.allow(request) {
		t.Fatal("rate limit did not reset")
	}
}

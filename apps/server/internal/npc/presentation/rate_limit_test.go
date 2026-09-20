package presentation

import (
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func TestIPRateLimiterBoundsRequestsAndResets(t *testing.T) {
	clock := time.Now()
	limiter := newIPRateLimiter(2, time.Minute, nil)
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

func TestIPRateLimiterUsesForwardedClientOnlyFromTrustedProxy(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	limiter := newIPRateLimiter(1, time.Minute, trusted)
	request := httptest.NewRequest("POST", "/api/npc/conversations", nil)
	request.RemoteAddr = "10.0.0.10:12345"
	request.Header.Set("X-Forwarded-For", "198.51.100.7, 10.0.0.2")
	if !limiter.allow(request) {
		t.Fatal("request through trusted proxy was unexpectedly rejected")
	}
	request.RemoteAddr = "10.0.0.11:12345"
	if limiter.allow(request) {
		t.Fatal("same forwarded client was not rate limited across trusted proxies")
	}
	request.RemoteAddr = "198.51.100.8:12345"
	request.Header.Set("X-Forwarded-For", "198.51.100.7")
	if !limiter.allow(request) {
		t.Fatal("untrusted client header was accepted as the rate limit key")
	}
}

func TestParseTrustedProxyCIDRs(t *testing.T) {
	prefixes, err := ParseTrustedProxyCIDRs("10.0.0.0/8, 2001:db8::/32")
	if err != nil || len(prefixes) != 2 {
		t.Fatalf("prefixes = %v, err = %v", prefixes, err)
	}
	if _, err := ParseTrustedProxyCIDRs("not-a-prefix"); err == nil {
		t.Fatal("invalid prefix was accepted")
	}
}

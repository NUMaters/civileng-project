package presentation

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

type rateWindow struct {
	started time.Time
	count   int
}

// ipRateLimiter is a bounded, per-process safety net. Production deployments
// should additionally enforce limits at the trusted edge/reverse proxy.
type ipRateLimiter struct {
	mu      sync.Mutex
	entries map[string]rateWindow
	limit   int
	window  time.Duration
	now     func() time.Time
	trusted []netip.Prefix
}

// ParseTrustedProxyCIDRs parses the proxy networks allowed to supply
// X-Forwarded-For. An empty value means request headers are never trusted.
func ParseTrustedProxyCIDRs(value string) ([]netip.Prefix, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	values := strings.Split(value, ",")
	prefixes := make([]netip.Prefix, 0, len(values))
	for _, candidate := range values {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(candidate))
		if err != nil {
			return nil, fmt.Errorf("invalid NPC_TRUSTED_PROXY_CIDRS value %q: %w", candidate, err)
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}

func newIPRateLimiter(limit int, window time.Duration, trusted []netip.Prefix) *ipRateLimiter {
	return &ipRateLimiter{entries: make(map[string]rateWindow), limit: limit, window: window, now: time.Now, trusted: trusted}
}

func (l *ipRateLimiter) allow(r *http.Request) bool {
	host := l.clientIP(r)
	current := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, known := l.entries[host]; !known && len(l.entries) >= 1024 {
		host = "__overflow__"
	}
	entry := l.entries[host]
	if entry.started.IsZero() || current.Sub(entry.started) >= l.window {
		entry = rateWindow{started: current}
	}
	if entry.count >= l.limit {
		return false
	}
	entry.count++
	l.entries[host] = entry
	if len(l.entries) > 1024 {
		for key, candidate := range l.entries {
			if current.Sub(candidate.started) >= l.window {
				delete(l.entries, key)
			}
		}
	}
	return true
}

func (l *ipRateLimiter) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || host == "" {
		host = r.RemoteAddr
	}
	remote, err := netip.ParseAddr(host)
	if err != nil || !l.isTrusted(remote) {
		return host
	}
	forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for index := len(forwarded) - 1; index >= 0; index-- {
		candidate, err := netip.ParseAddr(strings.TrimSpace(forwarded[index]))
		if err != nil {
			continue
		}
		if !l.isTrusted(candidate) {
			return candidate.String()
		}
	}
	return host
}

func (l *ipRateLimiter) isTrusted(address netip.Addr) bool {
	for _, prefix := range l.trusted {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

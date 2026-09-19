package presentation

import (
	"net"
	"net/http"
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
}

func newIPRateLimiter(limit int, window time.Duration) *ipRateLimiter {
	return &ipRateLimiter{entries: make(map[string]rateWindow), limit: limit, window: window, now: time.Now}
}

func (l *ipRateLimiter) allow(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || host == "" {
		host = r.RemoteAddr
	}
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

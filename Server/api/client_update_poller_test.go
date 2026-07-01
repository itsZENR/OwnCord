package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/owncord/server/updater"
)

// seqChecker returns a scripted sequence of releases. The first errUntil calls
// return an error; after that, call N returns versions[N] (clamped to the last).
type seqChecker struct {
	mu       sync.Mutex
	versions []string
	errUntil int
	calls    int
}

func (c *seqChecker) CheckForUpdate(_ context.Context) (updater.UpdateInfo, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	call := c.calls
	c.calls++
	if call < c.errUntil {
		return updater.UpdateInfo{}, errors.New("boom")
	}
	idx := call - c.errUntil
	if idx >= len(c.versions) {
		idx = len(c.versions) - 1
	}
	return updater.UpdateInfo{Latest: c.versions[idx], ReleaseNotes: "notes-" + c.versions[idx]}, nil
}

type recBroadcaster struct {
	mu    sync.Mutex
	calls []string
	fired chan struct{}
}

func newRecBroadcaster() *recBroadcaster {
	return &recBroadcaster{fired: make(chan struct{}, 8)}
}

func (b *recBroadcaster) BroadcastClientUpdate(version, _ string) {
	b.mu.Lock()
	b.calls = append(b.calls, version)
	b.mu.Unlock()
	select {
	case b.fired <- struct{}{}:
	default:
	}
}

func (b *recBroadcaster) count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.calls)
}

func (b *recBroadcaster) last() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.calls) == 0 {
		return ""
	}
	return b.calls[len(b.calls)-1]
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestPollerAnnouncesOnceOnVersionIncrease(t *testing.T) {
	checker := &seqChecker{versions: []string{"v1.0.0", "v1.1.0"}}
	bc := newRecBroadcaster()

	stop := startClientUpdatePoller(checker, bc, 5*time.Millisecond, quietLogger())
	defer stop()

	select {
	case <-bc.fired:
	case <-time.After(2 * time.Second):
		t.Fatal("expected a client_update broadcast, got none")
	}

	if got := bc.last(); got != "v1.1.0" {
		t.Fatalf("broadcast version = %q, want v1.1.0", got)
	}

	// Give several more ticks — the same version must NOT be re-announced.
	time.Sleep(60 * time.Millisecond)
	if n := bc.count(); n != 1 {
		t.Fatalf("broadcast count = %d, want 1 (no re-announce of same version)", n)
	}
}

func TestPollerDoesNotAnnounceSeededVersion(t *testing.T) {
	// Latest never increases past the seed — nothing should be broadcast.
	checker := &seqChecker{versions: []string{"v2.3.4"}}
	bc := newRecBroadcaster()

	stop := startClientUpdatePoller(checker, bc, 5*time.Millisecond, quietLogger())
	defer stop()

	time.Sleep(80 * time.Millisecond)
	if n := bc.count(); n != 0 {
		t.Fatalf("broadcast count = %d, want 0 (seeded version must not be announced)", n)
	}
}

func TestPollerToleratesCheckErrors(t *testing.T) {
	// Seed check fails; then v2.0.0 seeds on the first tick; v2.1.0 announces.
	checker := &seqChecker{versions: []string{"v2.0.0", "v2.1.0"}, errUntil: 1}
	bc := newRecBroadcaster()

	stop := startClientUpdatePoller(checker, bc, 5*time.Millisecond, quietLogger())
	defer stop()

	select {
	case <-bc.fired:
	case <-time.After(2 * time.Second):
		t.Fatal("expected a broadcast after error recovery, got none")
	}
	if got := bc.last(); got != "v2.1.0" {
		t.Fatalf("broadcast version = %q, want v2.1.0", got)
	}
}

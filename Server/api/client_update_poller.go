package api

// Background poller that watches GitHub for a newer desktop client release and
// broadcasts a client_update to all connected clients the first time each new
// version is seen. This lets already-connected clients learn about an update
// immediately instead of waiting for an app restart.

import (
	"context"
	"log/slog"
	"time"

	"github.com/owncord/server/updater"
	"golang.org/x/mod/semver"
)

// defaultClientUpdatePollInterval is how often the poller checks for a new
// client release.
const defaultClientUpdatePollInterval = 15 * time.Minute

// clientUpdateChecker is the subset of *updater.Updater the poller needs.
type clientUpdateChecker interface {
	CheckForUpdate(ctx context.Context) (updater.UpdateInfo, error)
}

// clientUpdateBroadcaster is the subset of *ws.Hub the poller needs.
type clientUpdateBroadcaster interface {
	BroadcastClientUpdate(version, notes string)
}

// startClientUpdatePoller launches the poller goroutine and returns a stop
// function that halts it.
func startClientUpdatePoller(
	checker clientUpdateChecker,
	bcaster clientUpdateBroadcaster,
	interval time.Duration,
	log *slog.Logger,
) (stop func()) {
	stopCh := make(chan struct{})
	go runClientUpdatePoller(checker, bcaster, interval, log, stopCh)
	return func() { close(stopCh) }
}

// runClientUpdatePoller seeds the last-seen release on startup (without
// announcing it), then broadcasts once each time the latest release version
// increases. Errors are logged and skipped with a circuit breaker so a flaky
// GitHub connection never crashes or spams the server.
func runClientUpdatePoller(
	checker clientUpdateChecker,
	bcaster clientUpdateBroadcaster,
	interval time.Duration,
	log *slog.Logger,
	stopCh <-chan struct{},
) {
	// lastAnnounced holds the highest release version already accounted for,
	// normalized with a leading "v". Empty until the first successful check.
	var lastAnnounced string

	// Seed immediately so a release that already exists at startup is not
	// re-announced on every restart. A failure here just leaves seeding to the
	// first tick.
	if info, err := checker.CheckForUpdate(context.Background()); err == nil {
		if v := ensureV(info.Latest); semver.IsValid(v) {
			lastAnnounced = v
		}
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	consecutiveFailures := 0
	const maxConsecutiveFailures = 5

	for {
		select {
		case <-ticker.C:
			if consecutiveFailures >= maxConsecutiveFailures {
				log.Error("client update poller: circuit breaker open, skipping tick",
					"consecutive_failures", consecutiveFailures)
				consecutiveFailures = maxConsecutiveFailures - 1
				continue
			}

			info, err := checker.CheckForUpdate(context.Background())
			if err != nil {
				log.Warn("client update poller: check failed", "error", err)
				consecutiveFailures++
				continue
			}
			consecutiveFailures = 0

			latest := ensureV(info.Latest)
			if !semver.IsValid(latest) {
				continue
			}

			if lastAnnounced == "" {
				// Seeding was deferred (startup check failed); seed now.
				lastAnnounced = latest
				continue
			}

			if semver.Compare(latest, lastAnnounced) > 0 {
				lastAnnounced = latest
				log.Info("client update poller: announcing new client release", "version", info.Latest)
				bcaster.BroadcastClientUpdate(info.Latest, info.ReleaseNotes)
			}
		case <-stopCh:
			return
		}
	}
}

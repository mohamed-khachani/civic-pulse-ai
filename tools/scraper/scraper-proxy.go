package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	maxHTMLSize = 25 << 20 // 25 MiB
	maxRetries  = 5

	// Standard desktop Chrome User-Agent.
	userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
		"AppleWebKit/537.36 (KHTML, like Gecko) " +
		"Chrome/131.0.0.0 Safari/537.36"
)

type Config struct {
	File1     string
	File2     string
	OutputDir string
	LogDir    string
	Interval  time.Duration
	Timeout   time.Duration
	ProxyURL  string
}

type Source struct {
	Name string
	File string
}

type Stats struct {
	Total   int
	Success int
	Skipped int
	Failed  int
}

type Failure struct {
	Source string
	URL    string
	Error  string
}

type FailureStore struct {
	mu    sync.Mutex
	items []Failure
}

func (f *FailureStore) Add(source, rawURL string, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.items = append(f.items, Failure{
		Source: source,
		URL:    rawURL,
		Error:  err.Error(),
	})
}

func (f *FailureStore) Save(path string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)

	if err := writer.Write([]string{
		"source", "url", "error",
	}); err != nil {
		return err
	}

	for _, item := range f.items {
		if err := writer.Write([]string{
			item.Source,
			item.URL,
			item.Error,
		}); err != nil {
			return err
		}
	}

	writer.Flush()
	return writer.Error()
}

// ==========================================
// LOGGING
// ==========================================

func setupLogging(logDir string) (*os.File, error) {
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, err
	}

	filename := fmt.Sprintf(
		"scraper_%s.log",
		time.Now().Format("2006-01-02_15-04-05"),
	)

	path := filepath.Join(logDir, filename)

	file, err := os.OpenFile(
		path,
		os.O_CREATE|os.O_WRONLY|os.O_APPEND,
		0644,
	)
	if err != nil {
		return nil, err
	}

	log.SetOutput(io.MultiWriter(os.Stdout, file))
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)

	log.Printf("Log file: %s", path)

	return file, nil
}

// ==========================================
// HTTP CLIENT
// ==========================================

func newClient(timeout time.Duration, proxyAddress string) (*http.Client, error) {
	transport := &http.Transport{
		MaxIdleConns:          20,
		MaxIdleConnsPerHost:   4,
		MaxConnsPerHost:       4,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: timeout,
		ForceAttemptHTTP2:     true,

		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
	}

	if proxyAddress != "" {
		u, err := url.Parse(proxyAddress)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy: %w", err)
		}
		switch u.Scheme {
		case "http", "https", "socks5", "socks5h":
			if u.Scheme == "socks5h" {
				u.Scheme = "socks5"
			}
			transport.Proxy = http.ProxyURL(u)
		default:
			return nil, fmt.Errorf("unsupported proxy scheme %q", u.Scheme)
		}
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: transport,

		CheckRedirect: func(
			req *http.Request,
			via []*http.Request,
		) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}

			// Only follow redirects within the original host.
			if len(via) > 0 &&
				!strings.EqualFold(
					req.URL.Hostname(),
					via[0].URL.Hostname(),
				) {
				return errors.New("cross-host redirect refused")
			}

			return nil
		},
	}, nil
}

// ==========================================
// URL LOADING
// ==========================================

func loadURLs(filename string) ([]string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	var result []string
	seen := make(map[string]struct{})

	for scanner.Scan() {
		rawURL := strings.TrimSpace(scanner.Text())

		if rawURL == "" || strings.HasPrefix(rawURL, "#") {
			continue
		}

		parsed, err := url.Parse(rawURL)
		if err != nil ||
			(parsed.Scheme != "http" && parsed.Scheme != "https") ||
			parsed.Hostname() == "" ||
			parsed.User != nil {
			log.Printf("[WARN] Invalid URL skipped: %s", rawURL)
			continue
		}

		if _, exists := seen[rawURL]; exists {
			continue
		}

		seen[rawURL] = struct{}{}
		result = append(result, rawURL)
	}

	return result, scanner.Err()
}

func hashURL(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return hex.EncodeToString(sum[:])
}

func outputPath(dir, rawURL string) string {
	return filepath.Join(dir, hashURL(rawURL)+".html")
}

func alreadyDownloaded(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Size() > 0
}

// ==========================================
// RATE LIMITING
// ==========================================

// This limiter schedules request STARTS.
// Each worker owns its own limiter.
//
// A request may not start until at least
// interval has elapsed since its previous start.
type RateLimiter struct {
	interval time.Duration
	next     time.Time
}

func NewRateLimiter(interval time.Duration) *RateLimiter {
	return &RateLimiter{
		interval: interval,
	}
}

func (r *RateLimiter) Wait(ctx context.Context) error {
	now := time.Now()

	if !r.next.IsZero() && now.Before(r.next) {
		if err := sleepContext(ctx, time.Until(r.next)); err != nil {
			return err
		}
	}

	r.next = time.Now().Add(r.interval)
	return nil
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return ctx.Err()
	}

	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// ==========================================
// RETRY POLICY
// ==========================================

func retryable(status int) bool {
	switch status {
	case 429, 500, 502, 503, 504:
		return true
	default:
		return false
	}
}

func retryDelay(resp *http.Response, attempt int) time.Duration {
	if resp != nil {
		header := strings.TrimSpace(
			resp.Header.Get("Retry-After"),
		)

		if seconds, err := strconv.Atoi(header); err == nil && seconds >= 0 {
			return time.Duration(seconds) * time.Second
		}

		if date, err := http.ParseTime(header); err == nil {
			if delay := time.Until(date); delay > 0 {
				return delay
			}
		}
	}

	// Exponential backoff:
	// ~2s, 4s, 8s, 16s, 32s.
	base := time.Duration(1<<uint(attempt+1)) * time.Second
	jitter := time.Duration(rand.Intn(1000)) * time.Millisecond

	return base + jitter
}

// ==========================================
// HTML DOWNLOAD
// ==========================================

func downloadHTML(
	ctx context.Context,
	client *http.Client,
	limiter *RateLimiter,
	rawURL string,
	destination string,
) (int, int64, error) {

	var lastErr error
	lastStatus := 0

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if err := limiter.Wait(ctx); err != nil {
			return lastStatus, 0, err
		}

		req, err := http.NewRequestWithContext(
			ctx,
			http.MethodGet,
			rawURL,
			nil,
		)
		if err != nil {
			return 0, 0, err
		}

		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")

		resp, err := client.Do(req)

		if err != nil {
			lastErr = err
			lastStatus = 0
		} else {
			lastStatus = resp.StatusCode

			if resp.StatusCode == http.StatusOK {
				contentType := strings.ToLower(
					resp.Header.Get("Content-Type"),
				)

				if contentType != "" &&
					!strings.Contains(contentType, "text/html") &&
					!strings.Contains(contentType, "application/xhtml+xml") {
					resp.Body.Close()
					return lastStatus, 0,
						fmt.Errorf("unexpected Content-Type: %s", contentType)
				}

				// Atomic write: incomplete files are never
				// treated as successfully downloaded.
				tmp, err := os.CreateTemp(
					filepath.Dir(destination),
					".download-*.part",
				)
				if err != nil {
					resp.Body.Close()
					return lastStatus, 0, err
				}

				n, copyErr := io.Copy(
					tmp,
					io.LimitReader(resp.Body, maxHTMLSize+1),
				)

				bodyErr := resp.Body.Close()
				closeErr := tmp.Close()

				if copyErr != nil || bodyErr != nil ||
					closeErr != nil || n > maxHTMLSize || n == 0 {
					os.Remove(tmp.Name())

					switch {
					case copyErr != nil:
						return lastStatus, n, copyErr
					case bodyErr != nil:
						return lastStatus, n, bodyErr
					case closeErr != nil:
						return lastStatus, n, closeErr
					case n > maxHTMLSize:
						return lastStatus, n,
							errors.New("HTML exceeds maximum size")
					default:
						return lastStatus, n,
							errors.New("empty HTML response")
					}
				}

				if err := os.Rename(tmp.Name(), destination); err != nil {
					os.Remove(tmp.Name())
					return lastStatus, n, err
				}

				return lastStatus, n, nil
			}

			lastErr = fmt.Errorf("HTTP %d", resp.StatusCode)

			if !retryable(resp.StatusCode) {
				resp.Body.Close()
				return lastStatus, 0, lastErr
			}

			delay := retryDelay(resp, attempt)
			resp.Body.Close()

			if attempt < maxRetries {
				log.Printf(
					"[RETRY] status=%d attempt=%d/%d delay=%s url=%s",
					lastStatus,
					attempt+1,
					maxRetries,
					delay,
					rawURL,
				)

				if err := sleepContext(ctx, delay); err != nil {
					return lastStatus, 0, err
				}
			}

			continue
		}

		// Network error.
		if attempt < maxRetries {
			delay := retryDelay(nil, attempt)

			log.Printf(
				"[RETRY] network attempt=%d/%d delay=%s url=%s error=%v",
				attempt+1,
				maxRetries,
				delay,
				rawURL,
				lastErr,
			)

			if err := sleepContext(ctx, delay); err != nil {
				return lastStatus, 0, err
			}
		}
	}

	return lastStatus, 0, fmt.Errorf(
		"all attempts exhausted: %w",
		lastErr,
	)
}

// ==========================================
// WORKER
// ==========================================

func runWorker(
	ctx context.Context,
	client *http.Client,
	source Source,
	cfg Config,
	failures *FailureStore,
	wg *sync.WaitGroup,
) {
	defer wg.Done()

	urls, err := loadURLs(source.File)
	if err != nil {
		log.Printf("[%s] ERROR reading file: %v", source.Name, err)
		return
	}

	dir := filepath.Join(cfg.OutputDir, source.Name)

	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("[%s] ERROR creating directory: %v", source.Name, err)
		return
	}

	stats := Stats{Total: len(urls)}
	limiter := NewRateLimiter(cfg.Interval)
	started := time.Now()

	log.Printf(
		"[%s] START | file=%s urls=%d interval=%s",
		source.Name,
		source.File,
		len(urls),
		cfg.Interval,
	)

	for i, rawURL := range urls {
		if ctx.Err() != nil {
			log.Printf("[%s] STOPPED", source.Name)
			break
		}

		destination := outputPath(dir, rawURL)

		if alreadyDownloaded(destination) {
			stats.Skipped++
			continue
		}

		requestStart := time.Now()

		status, bytes, err := downloadHTML(
			ctx,
			client,
			limiter,
			rawURL,
			destination,
		)

		if ctx.Err() != nil {
			log.Printf("[%s] INTERRUPTED", source.Name)
			break
		}

		elapsed := time.Since(requestStart)

		if err != nil {
			stats.Failed++
			failures.Add(source.Name, rawURL, err)

			log.Printf(
				"[%s] FAIL | %d/%d | status=%d | duration=%s | url=%s | error=%v",
				source.Name,
				i+1,
				stats.Total,
				status,
				elapsed.Round(time.Millisecond),
				rawURL,
				err,
			)

			if status == http.StatusForbidden || status == http.StatusTooManyRequests {
				log.Printf("[%s] STOP | HTTP %d indicates access restriction/rate limit; not continuing this source", source.Name, status)
				break
			}
			continue
		}

		stats.Success++

		log.Printf(
			"[%s] OK | %d/%d | status=%d | bytes=%d | duration=%s | url=%s",
			source.Name,
			i+1,
			stats.Total,
			status,
			bytes,
			elapsed.Round(time.Millisecond),
			rawURL,
		)
	}

	log.Printf(
		"[%s] FINISHED | total=%d success=%d skipped=%d failed=%d elapsed=%s",
		source.Name,
		stats.Total,
		stats.Success,
		stats.Skipped,
		stats.Failed,
		time.Since(started).Round(time.Second),
	)
}

func redactProxy(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "configured"
	}
	u.User = nil
	return u.String()
}

// ==========================================
// MAIN
// ==========================================

func main() {
	var cfg Config

	flag.StringVar(&cfg.File1, "file1", "urls_1.txt", "First URL file")
	flag.StringVar(&cfg.File2, "file2", "urls_2.txt", "Second URL file")
	flag.StringVar(&cfg.OutputDir, "output", "downloads", "HTML output directory")
	flag.StringVar(&cfg.LogDir, "logs", "logs", "Log directory")
	flag.DurationVar(&cfg.Interval, "interval", time.Second, "Minimum interval between requests per worker")
	flag.DurationVar(&cfg.Timeout, "timeout", 30*time.Second, "HTTP request timeout")
	flag.StringVar(&cfg.ProxyURL, "proxy", "", "Proxy URL, e.g. socks5://127.0.0.1:1080 or http://127.0.0.1:3128")
	flag.Parse()

	if cfg.Interval <= 0 || cfg.Timeout <= 0 {
		log.Fatal("interval and timeout must be positive")
	}

	logFile, err := setupLogging(cfg.LogDir)
	if err != nil {
		log.Fatal(err)
	}
	defer logFile.Close()

	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	client, err := newClient(cfg.Timeout, cfg.ProxyURL)
	if err != nil {
		log.Fatal(err)
	}
	defer client.CloseIdleConnections()

	sources := []Source{
		{Name: "source1", File: cfg.File1},
		{Name: "source2", File: cfg.File2},
	}

	failures := &FailureStore{}

	log.Println("========================================")
	log.Println("HTML SCRAPER STARTED")
	log.Println("========================================")
	log.Printf("Source 1: %s", cfg.File1)
	log.Printf("Source 2: %s", cfg.File2)
	log.Printf("Output: %s", cfg.OutputDir)
	log.Printf("Interval per source: %s", cfg.Interval)
	log.Printf("Maximum combined rate: %.2f req/s", 2/cfg.Interval.Seconds())
	log.Printf("Request timeout: %s", cfg.Timeout)
	log.Printf("Max retries: %d", maxRetries)
	if cfg.ProxyURL != "" {
		log.Printf("Proxy enabled: %s", redactProxy(cfg.ProxyURL))
	}

	start := time.Now()

	var wg sync.WaitGroup

	for _, source := range sources {
		wg.Add(1)

		go runWorker(
			ctx,
			client,
			source,
			cfg,
			failures,
			&wg,
		)
	}

	wg.Wait()

	reportPath := filepath.Join(cfg.LogDir, "failures.csv")

	if err := failures.Save(reportPath); err != nil {
		log.Printf("ERROR saving failure report: %v", err)
	} else {
		log.Printf("Failure report: %s", reportPath)
	}

	log.Printf(
		"ALL WORKERS FINISHED | total_elapsed=%s",
		time.Since(start).Round(time.Second),
	)
}

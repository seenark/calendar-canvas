package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"

	"github.com/seenark/calendar-canvas/apps/server/internal/api"
	"github.com/seenark/calendar-canvas/apps/server/internal/auth"
	"github.com/seenark/calendar-canvas/apps/server/internal/config"
	"github.com/seenark/calendar-canvas/apps/server/internal/static"
	"github.com/seenark/calendar-canvas/apps/server/internal/store"
)

const googleIssuer = "https://accounts.google.com"

var googleEndpoint = oauth2.Endpoint{
	AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
	TokenURL: "https://oauth2.googleapis.com/token",
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			if err := healthcheck(config.Port()); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			return
		default:
			fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
			os.Exit(2)
		}
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := serve(cfg); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func serve(cfg config.Config) error {
	gin.SetMode(gin.ReleaseMode)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	conn, err := store.Open(cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer conn.Close()

	svc, err := auth.New(ctx, cfg, googleIssuer, googleEndpoint, store.New(conn))
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.NewRouter(static.FS(), cfg, svc),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", srv.Addr)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func healthcheck(port string) error {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort("127.0.0.1", port) + "/api/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned %s", resp.Status)
	}
	return nil
}

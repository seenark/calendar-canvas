package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/seenark/calendar-canvas/apps/server/internal/passhash"
)

const minSessionSecretBytes = 32

type Config struct {
	Port               string
	AppBaseURL         string
	DatabasePath       string
	GoogleClientID     string
	GoogleClientSecret string
	SessionSecret      []byte
	AdminUsername      string
	AdminPasswordHash  *passhash.Hash
}

// AdminEnabled reports whether Admin sign-in is configured.
func (c Config) AdminEnabled() bool {
	return c.AdminUsername != "" && c.AdminPasswordHash != nil
}

// SecureCookies reports whether cookies must carry the Secure flag.
func (c Config) SecureCookies() bool {
	return strings.HasPrefix(c.AppBaseURL, "https://")
}

// Port is read apart from Load so the healthcheck subcommand needs no other configuration.
func Port() string {
	return port(os.Getenv)
}

func Load() (Config, error) {
	return parse(os.Getenv)
}

func port(get func(string) string) string {
	if v := get("PORT"); v != "" {
		return v
	}
	return "8080"
}

func parse(get func(string) string) (Config, error) {
	cfg := Config{
		Port:               port(get),
		DatabasePath:       get("DATABASE_PATH"),
		GoogleClientID:     get("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: get("GOOGLE_CLIENT_SECRET"),
		SessionSecret:      []byte(get("SESSION_SECRET")),
		AdminUsername:      get("ADMIN_USERNAME"),
	}

	var errs []error
	for _, r := range []struct{ name, value string }{
		{"DATABASE_PATH", cfg.DatabasePath},
		{"GOOGLE_CLIENT_ID", cfg.GoogleClientID},
		{"GOOGLE_CLIENT_SECRET", cfg.GoogleClientSecret},
	} {
		if r.value == "" {
			errs = append(errs, fmt.Errorf("%s is required", r.name))
		}
	}

	base, err := parseBaseURL(get("APP_BASE_URL"))
	if err != nil {
		errs = append(errs, err)
	}
	cfg.AppBaseURL = base

	if len(cfg.SessionSecret) < minSessionSecretBytes {
		errs = append(errs, fmt.Errorf("SESSION_SECRET must be at least %d bytes", minSessionSecretBytes))
	}

	if raw := get("ADMIN_PASSWORD_HASH"); raw != "" {
		hash, err := passhash.Parse(raw)
		if err != nil {
			errs = append(errs, fmt.Errorf("ADMIN_PASSWORD_HASH is invalid: %w", err))
		}
		cfg.AdminPasswordHash = hash
	}

	if err := errors.Join(errs...); err != nil {
		return Config{}, fmt.Errorf("invalid configuration:\n%w", err)
	}
	return cfg, nil
}

func parseBaseURL(raw string) (string, error) {
	if raw == "" {
		return "", errors.New("APP_BASE_URL is required")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("APP_BASE_URL must be an http(s) origin such as https://cal.example.com, got %q", raw)
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

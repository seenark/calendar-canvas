package config

import (
	"strings"
	"testing"
)

func env(overrides map[string]string) func(string) string {
	m := map[string]string{
		"APP_BASE_URL":         "https://Cal.example.com/",
		"DATABASE_PATH":        "/data/app.db",
		"GOOGLE_CLIENT_ID":     "id",
		"GOOGLE_CLIENT_SECRET": "secret",
		"SESSION_SECRET":       strings.Repeat("s", 32),
		"ALLOWED_EMAILS":       "you@gmail.com",
	}
	for k, v := range overrides {
		m[k] = v
	}
	return func(k string) string { return m[k] }
}

func TestParseValid(t *testing.T) {
	cfg, err := parse(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AppBaseURL != "https://cal.example.com" || cfg.Port != "8080" || !cfg.SecureCookies() {
		t.Errorf("unexpected config %+v", cfg)
	}
}

func TestParseRejectsEmptyAllowedEmails(t *testing.T) {
	for _, v := range []string{"", " , ,"} {
		_, err := parse(env(map[string]string{"ALLOWED_EMAILS": v}))
		if err == nil || !strings.Contains(err.Error(), "ALLOWED_EMAILS is required") {
			t.Errorf("ALLOWED_EMAILS=%q: err = %v, want ALLOWED_EMAILS is required", v, err)
		}
	}
}

func TestParseReportsEveryProblem(t *testing.T) {
	_, err := parse(func(string) string { return "" })
	if err == nil {
		t.Fatal("want error")
	}
	for _, name := range []string{"APP_BASE_URL", "DATABASE_PATH", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "ALLOWED_EMAILS"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error does not mention %s: %v", name, err)
		}
	}
}

func TestParseRejectsShortSessionSecretAndBadBaseURL(t *testing.T) {
	if _, err := parse(env(map[string]string{"SESSION_SECRET": strings.Repeat("s", 31)})); err == nil {
		t.Error("31-byte SESSION_SECRET accepted")
	}
	for _, u := range []string{"cal.example.com", "ftp://cal.example.com", "https://cal.example.com/app"} {
		if _, err := parse(env(map[string]string{"APP_BASE_URL": u})); err == nil {
			t.Errorf("APP_BASE_URL %q accepted", u)
		}
	}
}

func TestSecureCookiesOnlyForHTTPS(t *testing.T) {
	cfg, err := parse(env(map[string]string{"APP_BASE_URL": "http://192.168.1.5:8080"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SecureCookies() {
		t.Error("http base URL must not set Secure")
	}
}

func TestAllowlist(t *testing.T) {
	cfg, err := parse(env(map[string]string{"ALLOWED_EMAILS": " You@Gmail.com , other@x.org "}))
	if err != nil {
		t.Fatal(err)
	}
	for email, want := range map[string]bool{"you@gmail.com": true, "YOU@GMAIL.COM": true, "other@x.org": true, "evil@x.org": false} {
		if got := cfg.AllowedEmails.Allows(email); got != want {
			t.Errorf("Allows(%q) = %v, want %v", email, got, want)
		}
	}

	cfg, err = parse(env(map[string]string{"ALLOWED_EMAILS": "*"}))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.AllowedEmails.Allows("anyone@anywhere.dev") {
		t.Error("* must allow every account")
	}
}

package auth

import (
	"strings"
	"testing"
	"time"
)

func TestValidReturn(t *testing.T) {
	for p, want := range map[string]bool{
		"/":                 true,
		"/m/2026-11":        true,
		"/d/2026-03-14?x=1": true,
		"":                  false,
		"m/2026-11":         false,
		"//evil.example":    false,
		"/\\evil.example":   false,
		"https://evil.test": false,
		"/a\nb":             false,
	} {
		if got := validReturn(p); got != want {
			t.Errorf("validReturn(%q) = %v, want %v", p, got, want)
		}
	}
}

func TestStateCookieRoundTripAndTamper(t *testing.T) {
	secret := []byte(strings.Repeat("k", 32))
	now := time.Now()
	st := loginState{State: "s", Verifier: "v", Nonce: "n", Return: "/m/2026-11", Exp: now.Add(time.Minute).Unix()}
	value, err := signState(secret, st)
	if err != nil {
		t.Fatal(err)
	}

	got, err := verifyState(secret, value, now)
	if err != nil || got != st {
		t.Fatalf("round trip = %+v, %v", got, err)
	}
	if _, err := verifyState([]byte(strings.Repeat("x", 32)), value, now); err == nil {
		t.Error("accepted a cookie signed with another secret")
	}
	body, sig, _ := strings.Cut(value, ".")
	if _, err := verifyState(secret, body+"x."+sig, now); err == nil {
		t.Error("accepted a tampered payload")
	}
	if _, err := verifyState(secret, value, now.Add(2*time.Minute)); err == nil {
		t.Error("accepted an expired cookie")
	}
}

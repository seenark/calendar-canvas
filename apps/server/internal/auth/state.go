package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// loginState is what the signed state cookie carries between the start and callback requests.
type loginState struct {
	State    string `json:"s"`
	Verifier string `json:"v"`
	Nonce    string `json:"n"`
	Return   string `json:"r"`
	Exp      int64  `json:"e"`
}

func signState(secret []byte, st loginState) (string, error) {
	payload, err := json.Marshal(st)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(mac(secret, body)), nil
}

func verifyState(secret []byte, value string, now time.Time) (loginState, error) {
	body, sig, ok := strings.Cut(value, ".")
	if !ok {
		return loginState{}, errors.New("malformed state cookie")
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, mac(secret, body)) {
		return loginState{}, errors.New("bad state cookie signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return loginState{}, errors.New("malformed state cookie")
	}
	var st loginState
	if err := json.Unmarshal(payload, &st); err != nil {
		return loginState{}, errors.New("malformed state cookie")
	}
	if now.Unix() > st.Exp {
		return loginState{}, errors.New("state cookie expired")
	}
	return st, nil
}

func mac(secret []byte, body string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(body))
	return h.Sum(nil)
}

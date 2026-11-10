package api

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"golang.org/x/oauth2"
)

const (
	testClientID     = "test-client"
	testClientSecret = "test-secret"
	testKeyID        = "k1"
)

type profile struct {
	Sub      string
	Email    string
	Name     string
	Verified bool
}

type authRequest struct {
	nonce       string
	challenge   string
	redirectURI string
}

// fakeIssuer is a minimal OIDC provider that signs ID tokens with a test RSA key.
type fakeIssuer struct {
	*httptest.Server
	t      *testing.T
	key    *rsa.PrivateKey
	mu     sync.Mutex
	codes  map[string]authRequest
	user   profile
	nonce  string
	nextID int
}

func newFakeIssuer(t *testing.T) *fakeIssuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIssuer{
		t:     t,
		key:   key,
		codes: map[string]authRequest{},
		user:  profile{Sub: "sub-1", Email: "you@gmail.com", Name: "You", Verified: true},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", f.discovery)
	mux.HandleFunc("/jwks", f.jwks)
	mux.HandleFunc("/auth", f.authorize)
	mux.HandleFunc("/token", f.token)
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

func (f *fakeIssuer) endpoint() oauth2.Endpoint {
	return oauth2.Endpoint{AuthURL: f.URL + "/auth", TokenURL: f.URL + "/token"}
}

func (f *fakeIssuer) setUser(p profile) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.user = p
}

// setNonce makes the next ID tokens carry this nonce instead of the one the client sent.
func (f *fakeIssuer) setNonce(n string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nonce = n
}

func (f *fakeIssuer) discovery(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]any{
		"issuer":                                f.URL,
		"authorization_endpoint":                f.URL + "/auth",
		"token_endpoint":                        f.URL + "/token",
		"jwks_uri":                              f.URL + "/jwks",
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
	})
}

func (f *fakeIssuer) jwks(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
		{Key: &f.key.PublicKey, KeyID: testKeyID, Algorithm: string(jose.RS256), Use: "sig"},
	}})
}

func (f *fakeIssuer) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("client_id") != testClientID || q.Get("response_type") != "code" ||
		q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" ||
		q.Get("state") == "" || q.Get("nonce") == "" ||
		strings.Join(strings.Fields(q.Get("scope")), " ") != "openid email profile" {
		f.t.Errorf("unexpected authorization request: %v", q)
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.nextID++
	code := "code-" + strconv.Itoa(f.nextID)
	f.codes[code] = authRequest{q.Get("nonce"), q.Get("code_challenge"), q.Get("redirect_uri")}
	f.mu.Unlock()

	back, err := url.Parse(q.Get("redirect_uri"))
	if err != nil {
		http.Error(w, "bad redirect_uri", http.StatusBadRequest)
		return
	}
	bq := back.Query()
	bq.Set("code", code)
	bq.Set("state", q.Get("state"))
	back.RawQuery = bq.Encode()
	http.Redirect(w, r, back.String(), http.StatusFound)
}

func (f *fakeIssuer) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	id, secret, basic := r.BasicAuth()
	if !basic {
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	f.mu.Lock()
	req, ok := f.codes[r.PostForm.Get("code")]
	delete(f.codes, r.PostForm.Get("code"))
	user, nonce := f.user, f.nonce
	f.mu.Unlock()

	verifier := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if id != testClientID || secret != testClientSecret || !ok ||
		r.PostForm.Get("grant_type") != "authorization_code" ||
		r.PostForm.Get("redirect_uri") != req.redirectURI ||
		base64.RawURLEncoding.EncodeToString(verifier[:]) != req.challenge {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	if nonce == "" {
		nonce = req.nonce
	}

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: f.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", testKeyID),
	)
	if err != nil {
		f.t.Error(err)
		return
	}
	now := time.Now()
	idToken, err := jwt.Signed(signer).Claims(map[string]any{
		"iss":            f.URL,
		"aud":            testClientID,
		"sub":            user.Sub,
		"iat":            now.Unix(),
		"exp":            now.Add(time.Hour).Unix(),
		"nonce":          nonce,
		"email":          user.Email,
		"email_verified": user.Verified,
		"name":           user.Name,
	}).Serialize()
	if err != nil {
		f.t.Error(err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token": "access",
		"token_type":   "Bearer",
		"expires_in":   3600,
		"id_token":     idToken,
	})
}

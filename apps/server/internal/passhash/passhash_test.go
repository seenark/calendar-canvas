package passhash

import (
	"fmt"
	"strings"
	"testing"
)

func TestGenerateParseVerify(t *testing.T) {
	phc, err := Generate("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(phc, "$argon2id$v=19$m=65536,t=3,p=2$") {
		t.Fatalf("hash = %q", phc)
	}
	h, err := Parse(phc)
	if err != nil {
		t.Fatal(err)
	}
	if !h.Verify("correct horse") || h.Verify("wrong") || h.Verify("") {
		t.Error("Verify accepted a wrong password or rejected the right one")
	}
	if len(h.salt) != saltBytes || len(h.key) != keyBytes {
		t.Errorf("salt %d bytes, key %d bytes", len(h.salt), len(h.key))
	}
}

func TestParseRejectsMalformed(t *testing.T) {
	for _, s := range []string{
		"",
		"plain-password",
		"$argon2i$v=19$m=65536,t=3,p=2$c2FsdA$a2V5",
		"$argon2id$v=18$m=65536,t=3,p=2$c2FsdA$a2V5",
		"$argon2id$v=19$m=0,t=3,p=2$c2FsdA$a2V5",
		"$argon2id$v=19$m=65536,t=3,p=2$!!$a2V5",
		"$argon2id$v=19$m=65536,t=3,p=2$c2FsdA$",
		"$argon2id$v=19$m=65536,t=3,p=2$c2FsdA",
	} {
		if _, err := Parse(s); err == nil {
			t.Errorf("Parse(%q) accepted", s)
		}
	}
}

func phcWith(params string, saltLen, keyLen int) string {
	return fmt.Sprintf("$argon2id$v=19$%s$%s$%s", params, b64.EncodeToString(make([]byte, saltLen)), b64.EncodeToString(make([]byte, keyLen)))
}

func TestParseEnforcesBounds(t *testing.T) {
	for _, tc := range []struct {
		name string
		phc  string
		ok   bool
	}{
		{"smallest", phcWith("m=1,t=1,p=1", 8, 16), true},
		{"largest", phcWith("m=1048576,t=10,p=16", 64, 64), true},
		{"memory over 1 GiB", phcWith("m=1048577,t=3,p=2", 16, 32), false},
		{"zero passes", phcWith("m=65536,t=0,p=2", 16, 32), false},
		{"too many passes", phcWith("m=65536,t=11,p=2", 16, 32), false},
		{"zero lanes", phcWith("m=65536,t=3,p=0", 16, 32), false},
		{"too many lanes", phcWith("m=65536,t=3,p=17", 16, 32), false},
		{"lanes overflow uint8", phcWith("m=65536,t=3,p=258", 16, 32), false},
		{"short salt", phcWith("m=65536,t=3,p=2", 7, 32), false},
		{"long salt", phcWith("m=65536,t=3,p=2", 65, 32), false},
		{"short key", phcWith("m=65536,t=3,p=2", 16, 15), false},
		{"long key", phcWith("m=65536,t=3,p=2", 16, 65), false},
		{"trailing text after parameters", phcWith("m=65536,t=3,p=2,x=1", 16, 32), false},
		{"trailing text after version", strings.Replace(phcWith("m=65536,t=3,p=2", 16, 32), "v=19", "v=19x", 1), false},
		{"trailing field", phcWith("m=65536,t=3,p=2", 16, 32) + "$extra", false},
	} {
		_, err := Parse(tc.phc)
		if (err == nil) != tc.ok {
			t.Errorf("%s: Parse error = %v, want ok=%v", tc.name, err, tc.ok)
		}
	}
}

func TestFingerprintDiffersPerHash(t *testing.T) {
	a, _ := Parse(phcWith("m=1,t=1,p=1", 8, 16))
	b, _ := Parse(phcWith("m=2,t=1,p=1", 8, 16))
	if len(a.Fingerprint()) != 16 || a.Fingerprint() == b.Fingerprint() {
		t.Errorf("fingerprints %q, %q", a.Fingerprint(), b.Fingerprint())
	}
}

package passhash

import (
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

package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/seenark/calendar-canvas/apps/server/internal/passhash"
)

func TestHashPasswordOutputVerifies(t *testing.T) {
	var out bytes.Buffer
	if err := hashPassword(strings.NewReader("s3cret pass\r\n"), &out); err != nil {
		t.Fatal(err)
	}
	h, err := passhash.Parse(strings.TrimSpace(out.String()))
	if err != nil {
		t.Fatal(err)
	}
	if !h.Verify("s3cret pass") || h.Verify("s3cret pass\r") {
		t.Error("hash does not verify the piped password")
	}
}

func TestHashPasswordRejectsEmptyInput(t *testing.T) {
	for _, in := range []string{"", "\n"} {
		if err := hashPassword(strings.NewReader(in), &bytes.Buffer{}); err == nil {
			t.Errorf("input %q accepted", in)
		}
	}
}

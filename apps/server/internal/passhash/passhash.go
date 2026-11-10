// Package passhash creates and verifies argon2id hashes in the PHC string format.
package passhash

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	memoryKiB = 64 * 1024
	passes    = 3
	lanes     = 2
	saltBytes = 16
	keyBytes  = 32
)

var errMalformed = errors.New("not an argon2id PHC string like $argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>")

var b64 = base64.RawStdEncoding

// Hash is a parsed argon2id hash.
type Hash struct {
	memory, passes uint32
	lanes          uint8
	salt, key      []byte
}

// Generate hashes password with a fresh random salt.
func Generate(password string) (string, error) {
	salt := make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, passes, memoryKiB, lanes, keyBytes)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, memoryKiB, passes, lanes, b64.EncodeToString(salt), b64.EncodeToString(key)), nil
}

// Parse reads a PHC string produced by Generate.
func Parse(phc string) (*Hash, error) {
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return nil, errMalformed
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return nil, fmt.Errorf("unsupported argon2 version %q", parts[2])
	}
	h := &Hash{}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &h.memory, &h.passes, &h.lanes); err != nil ||
		h.memory == 0 || h.passes == 0 || h.lanes == 0 {
		return nil, fmt.Errorf("invalid argon2 parameters %q", parts[3])
	}
	var err error
	if h.salt, err = b64.DecodeString(parts[4]); err != nil || len(h.salt) == 0 {
		return nil, errMalformed
	}
	if h.key, err = b64.DecodeString(parts[5]); err != nil || len(h.key) == 0 {
		return nil, errMalformed
	}
	return h, nil
}

// Verify reports whether password matches the hash.
func (h *Hash) Verify(password string) bool {
	key := argon2.IDKey([]byte(password), h.salt, h.passes, h.memory, h.lanes, uint32(len(h.key)))
	return subtle.ConstantTimeCompare(key, h.key) == 1
}

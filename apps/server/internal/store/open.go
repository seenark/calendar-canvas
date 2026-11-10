//go:generate go run github.com/sqlc-dev/sqlc/cmd/sqlc@latest generate -f ../../sqlc.yaml

package store

import (
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"

	"github.com/seenark/calendar-canvas/apps/server/db"
)

const pragmas = "_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"

// Open opens the SQLite file with the required pragmas and applies pending migrations.
func Open(path string) (*sql.DB, error) {
	conn, err := sql.Open("sqlite", "file:"+path+"?"+pragmas)
	if err != nil {
		return nil, err
	}
	goose.SetBaseFS(db.Migrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		conn.Close()
		return nil, err
	}
	if err := goose.Up(conn, "migrations"); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migrate database: %w", err)
	}
	return conn, nil
}

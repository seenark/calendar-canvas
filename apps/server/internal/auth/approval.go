package auth

// ApprovalStatus is where a User stands with the Admin. Only the Admin changes it.
type ApprovalStatus string

const (
	StatusPending  ApprovalStatus = "pending"
	StatusApproved ApprovalStatus = "approved"
	StatusBlocked  ApprovalStatus = "blocked"
)

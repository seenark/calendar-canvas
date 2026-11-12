package api

// Wire types of the Shares API. tygo turns this file into apps/web/src/api/types.ts.

// PublicUser is what one User may learn about another: never the email.
type PublicUser struct {
	ID        string  `json:"id"`
	Name      *string `json:"name" tstype:"string | null,required"`
	AvatarURL *string `json:"avatarUrl" tstype:"string | null,required"`
}

type CandidatesResponse struct {
	Users []PublicUser `json:"users"`
}

// ShareViewer is a Viewer on the Owner's side of a Share; Status is the Invitation state.
type ShareViewer struct {
	ID     string     `json:"id"`
	Viewer PublicUser `json:"viewer"`
	Status string     `json:"status" tstype:"'pending' | 'accepted'"`
}

// SharedCalendar is an accepted Share seen from the Viewer.
type SharedCalendar struct {
	ID    string     `json:"id"`
	Owner PublicUser `json:"owner"`
}

// Invitation is a pending Share seen from the Viewer.
type Invitation struct {
	ID        string     `json:"id"`
	Owner     PublicUser `json:"owner"`
	CreatedAt int64      `json:"createdAt"`
}

type SharesResponse struct {
	Viewers     []ShareViewer    `json:"viewers"`
	Calendars   []SharedCalendar `json:"calendars"`
	Invitations []Invitation     `json:"invitations"`
}

type CreateShareRequest struct {
	ViewerID string `json:"viewerId" binding:"required"`
}

type CreateShareResponse struct {
	ID string `json:"id"`
}

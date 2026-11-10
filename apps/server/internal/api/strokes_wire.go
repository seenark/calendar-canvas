package api

// Wire types of the Strokes API. tygo turns this file into apps/web/src/api/types.ts.

const (
	OpAdd     = "add"
	OpDelete  = "delete"
	OpRestore = "restore"
)

// Stroke is a stored Stroke as returned by GET /api/months/:yyyy-mm. Points is base64 of points encoding v1.
type Stroke struct {
	ID         string     `json:"id"`
	Seq        int64      `json:"seq"`
	Day        string     `json:"day"`
	Kind       string     `json:"kind" tstype:"'pen' | 'eraser'"`
	Color      *string    `json:"color" tstype:"string | null,required"`
	Size       float64    `json:"size"`
	Points     string     `json:"points"`
	BBox       [4]float64 `json:"bbox" tstype:"BBox"`
	CreatedAt  int64      `json:"createdAt"`
	ReceivedAt int64      `json:"receivedAt"`
}

type MonthResponse struct {
	Strokes []Stroke `json:"strokes"`
}

// StrokeInput is a Stroke as sent by the client; the server assigns seq and receivedAt.
type StrokeInput struct {
	ID        string    `json:"id" binding:"required,uuid"`
	Day       string    `json:"day" binding:"required,datetime=2006-01-02"`
	Kind      string    `json:"kind" binding:"required,oneof=pen eraser" tstype:"'pen' | 'eraser'"`
	Color     *string   `json:"color" tstype:"string | null,required"`
	Size      float64   `json:"size" binding:"gt=0,lte=0.2"`
	Points    string    `json:"points" binding:"required"`
	BBox      []float64 `json:"bbox" binding:"len=4,dive,gte=-0.2,lte=1.2" tstype:"BBox"`
	CreatedAt int64     `json:"createdAt" binding:"gte=0"`
}

// Op is one entry of a batch. Add carries Stroke; Delete and Restore carry ID.
type Op struct {
	Op     string       `json:"op" binding:"required,oneof=add delete restore"`
	Stroke *StrokeInput `json:"stroke,omitempty"`
	ID     string       `json:"id,omitempty" binding:"omitempty,uuid"`
}

type OpsRequest struct {
	Ops []Op `json:"ops" binding:"required,min=1,max=200,dive"`
}

// OpResult answers one Op: Seq for an add, Missing when a delete or restore names an unknown id.
type OpResult struct {
	ID      string `json:"id"`
	Seq     int64  `json:"seq,omitempty"`
	Missing bool   `json:"missing,omitempty"`
}

type OpsResponse struct {
	Results []OpResult `json:"results"`
}

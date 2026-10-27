// Package social habla con Supabase: cuentas (correo o Google), círculos de
// amigos o de pareja, eventos compartidos y citas. Lo privado no pasa por
// aquí: sigue en el dispositivo.
package social

import "time"

type Profile struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Color string `json:"color"`
}

type Member struct {
	UserID   string  `json:"user_id"`
	Role     string  `json:"role"`
	JoinedAt string  `json:"joined_at"`
	Profile  Profile `json:"profiles"`
}

type Circle struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"` // friends | couple
	Color     string   `json:"color"`
	Owner     string   `json:"owner"`
	CreatedAt string   `json:"created_at"`
	Members   []Member `json:"circle_members"`
}

type Event struct {
	ID         string  `json:"id,omitempty"`
	CircleID   string  `json:"circle_id"`
	CreatedBy  string  `json:"created_by,omitempty"`
	Title      string  `json:"title"`
	Notes      string  `json:"notes"`
	Date       string  `json:"date"`
	Start      *string `json:"start"`
	Minutes    int     `json:"minutes"`
	ProposalID *string `json:"proposal_id,omitempty"`
	UpdatedAt  string  `json:"updated_at,omitempty"`
	UpdatedBy  string  `json:"updated_by,omitempty"`
}

type Option struct {
	ID         string  `json:"id,omitempty"`
	ProposalID string  `json:"proposal_id,omitempty"`
	Date       string  `json:"date"`
	Start      *string `json:"start"`
	Minutes    int     `json:"minutes"`
	ProposedBy string  `json:"proposed_by,omitempty"`
	CreatedAt  string  `json:"created_at,omitempty"`
}

type Proposal struct {
	ID          string   `json:"id"`
	CircleID    string   `json:"circle_id"`
	ProposedBy  string   `json:"proposed_by"`
	Title       string   `json:"title"`
	Notes       string   `json:"notes"`
	Status      string   `json:"status"` // open | accepted | declined | cancelled
	EventID     *string  `json:"event_id"`
	RespondedBy *string  `json:"responded_by"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
	Options     []Option `json:"date_options"`
}

// User es la persona con la sesión abierta.
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// Snapshot es todo lo que la app conoce de la parte compartida (se guarda en
// caché para verlo sin conexión).
type Snapshot struct {
	Configured bool       `json:"configured"`
	SignedIn   bool       `json:"signedIn"`
	User       *User      `json:"user,omitempty"`
	Profile    *Profile   `json:"profile,omitempty"`
	Circles    []Circle   `json:"circles"`
	Events     []Event    `json:"events"`
	Proposals  []Proposal `json:"proposals"`
	LastSync   time.Time  `json:"lastSync"`
	Error      string     `json:"error,omitempty"`
}

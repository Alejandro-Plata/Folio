package core

import (
	"context"
	"errors"

	"folio/internal/agenda"
	"folio/internal/social"
)

// Cuenta, círculos y citas (Supabase). Los eventos de los círculos se ven en
// la agenda como tareas con ID «c:‹id del evento›».

const circlePrefix = "c:"

func isCircleID(id string) bool {
	return len(id) > len(circlePrefix) && id[:len(circlePrefix)] == circlePrefix
}

// ctx: cada petición ya tiene su límite de tiempo en el cliente HTTP.
func ctx() context.Context { return context.Background() }

// circleTasks convierte los eventos en caché en tareas de la agenda.
func (s *Service) circleTasks(from, to string) []agenda.Task {
	me := s.social.Me()
	var out []agenda.Task
	for _, e := range s.social.Events(from, to) {
		c := s.social.Circle(e.CircleID)
		if c == nil {
			continue
		}
		ref := &agenda.CircleRef{ID: c.ID, Name: c.Name, Kind: c.Kind, Color: c.Color, Mine: e.CreatedBy == me}
		for _, m := range c.Members {
			if m.UserID == e.CreatedBy {
				ref.By = m.Profile.Name
			}
		}
		if e.ProposalID != nil {
			ref.ProposalID = *e.ProposalID
		}
		t := agenda.Task{ID: circlePrefix + e.ID, Title: e.Title, TypeID: "circle:" + c.ID, Date: e.Date, Minutes: e.Minutes, Notes: e.Notes, Circle: ref}
		if e.Start != nil {
			t.Start = *e.Start
		}
		out = append(out, t)
	}
	return out
}

func (s *Service) cachedEvent(id string) (social.Event, bool) {
	for _, e := range s.social.Snapshot().Events {
		if e.ID == id {
			return e, true
		}
	}
	return social.Event{}, false
}

func (s *Service) saveCircleTask(t agenda.Task) (agenda.Task, error) {
	if t.Repeat != nil {
		return agenda.Task{}, errors.New("los eventos del círculo no se repiten: créalos día a día")
	}
	e := social.Event{CircleID: t.Circle.ID, Title: t.Title, Notes: t.Notes, Date: t.Date, Minutes: t.Minutes}
	if isCircleID(t.ID) {
		e.ID = t.ID[len(circlePrefix):]
	}
	if t.Start != "" {
		st := t.Start
		e.Start = &st
	}
	saved, err := s.social.SaveEvent(ctx(), e)
	if err != nil {
		return agenda.Task{}, err
	}
	for _, x := range s.circleTasks(saved.Date, saved.Date) {
		if x.ID == circlePrefix+saved.ID {
			return x, nil
		}
	}
	return agenda.Task{ID: circlePrefix + saved.ID, Title: saved.Title, Date: saved.Date, Circle: t.Circle}, nil
}

// SignUpResult: si hay que confirmar el correo antes de entrar.
type SignUpResult struct {
	NeedsConfirm bool            `json:"needsConfirm"`
	Snapshot     social.Snapshot `json:"snapshot"`
}

func (s *Service) SocialStatus() social.Snapshot           { return s.social.Snapshot() }
func (s *Service) SocialRestore() (social.Snapshot, error) { return s.social.Restore(ctx()) }
func (s *Service) SocialRefresh() (social.Snapshot, error) { return s.social.Refresh(ctx()) }
func (s *Service) SocialSignIn(email, password string) (social.Snapshot, error) {
	return s.social.SignIn(ctx(), email, password)
}
func (s *Service) SocialSignUp(email, password, name string) (SignUpResult, error) {
	needs, snap, err := s.social.SignUp(ctx(), email, password, name)
	return SignUpResult{NeedsConfirm: needs, Snapshot: snap}, err
}
func (s *Service) SocialRecover(email string) error { return s.social.Recover(ctx(), email) }
func (s *Service) SocialGoogleURL(redirect string) (string, error) {
	return s.social.GoogleURL(redirect)
}
func (s *Service) SocialGoogleFinish(code string) (social.Snapshot, error) {
	return s.social.GoogleFinish(ctx(), code)
}
func (s *Service) SocialSignOut() { s.social.SignOut(ctx()) }
func (s *Service) SocialUpdateProfile(name, color string) (social.Snapshot, error) {
	return s.social.UpdateProfile(ctx(), name, color)
}
func (s *Service) SocialDeleteAccount() error { return s.social.DeleteAccount(ctx()) }

func (s *Service) SocialCreateCircle(name, kind, color string) (social.Snapshot, error) {
	return s.social.CreateCircle(ctx(), name, kind, color)
}
func (s *Service) SocialUpdateCircle(id, name, color string) (social.Snapshot, error) {
	return s.social.UpdateCircle(ctx(), id, name, color)
}
func (s *Service) SocialDeleteCircle(id string) (social.Snapshot, error) {
	return s.social.DeleteCircle(ctx(), id)
}
func (s *Service) SocialInvite(circleID string) (string, error) {
	return s.social.Invite(ctx(), circleID)
}
func (s *Service) SocialJoin(code string) (social.Snapshot, error) { return s.social.Join(ctx(), code) }
func (s *Service) SocialLeave(circleID string) (social.Snapshot, error) {
	return s.social.Leave(ctx(), circleID)
}
func (s *Service) SocialRemoveMember(circleID, userID string) (social.Snapshot, error) {
	return s.social.RemoveMember(ctx(), circleID, userID)
}
func (s *Service) SocialProposeDate(circleID, title, notes string, options []social.Option) (social.Snapshot, error) {
	return s.social.ProposeDate(ctx(), circleID, title, notes, options)
}
func (s *Service) SocialCounter(proposalID string, options []social.Option) (social.Snapshot, error) {
	return s.social.Counter(ctx(), proposalID, options)
}
func (s *Service) SocialAccept(optionID string) (social.Snapshot, error) {
	return s.social.Accept(ctx(), optionID)
}
func (s *Service) SocialCloseProposal(proposalID, status string) (social.Snapshot, error) {
	return s.social.Close(ctx(), proposalID, status)
}

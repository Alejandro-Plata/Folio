package core

import (
	"errors"
	"strings"
	"testing"
)

type probe struct{}

type payload struct{ A string }

func (probe) Sum(a, b int) int                { return a + b }
func (probe) Fail() error                     { return errors.New("falla") }
func (probe) Echo(x payload) (payload, error) { return x, nil }
func (probe) Nothing()                        {}
func (probe) Both(s string) (string, error)   { return strings.ToUpper(s), nil }

func TestDispatch(t *testing.T) {
	cases := []struct {
		method, args, want string
		wantErr            string
	}{
		{"Sum", `[2,3]`, `5`, ""},
		{"Echo", `[{"A":"hola"}]`, `{"A":"hola"}`, ""},
		{"Both", `["ab"]`, `"AB"`, ""},
		{"Nothing", `[]`, `null`, ""},
		{"Nothing", ``, `null`, ""},
		{"Fail", `[]`, "", "falla"},
		{"Sum", `[1]`, "", "espera 2 argumentos"},
		{"Sum", `["a","b"]`, "", "argumento 1"},
		{"Sum", `no json`, "", "argumentos no válidos"},
		{"NoExiste", `[]`, "", "función desconocida"},
	}
	for _, c := range cases {
		got, err := Dispatch(probe{}, c.method, c.args)
		if c.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("%s(%s): error %v, se esperaba %q", c.method, c.args, err, c.wantErr)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("%s(%s) = %q, %v; se esperaba %q", c.method, c.args, got, err, c.want)
		}
	}
}

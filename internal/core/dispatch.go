package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
)

var errorType = reflect.TypeOf((*error)(nil)).Elem()

// Dispatch llama a target.method(args...) con los argumentos en un array JSON
// y devuelve el primer resultado (no error) en JSON. Lo usa Android, donde un
// único punto de entrada evita escribir un envoltorio por función.
func Dispatch(target any, method, argsJSON string) (string, error) {
	m := reflect.ValueOf(target).MethodByName(method)
	if !m.IsValid() {
		return "", fmt.Errorf("función desconocida: %s", method)
	}
	var raw []json.RawMessage
	if argsJSON != "" && argsJSON != "null" {
		if err := json.Unmarshal([]byte(argsJSON), &raw); err != nil {
			return "", fmt.Errorf("argumentos no válidos para %s: %w", method, err)
		}
	}
	t := m.Type()
	if t.IsVariadic() || len(raw) != t.NumIn() {
		return "", fmt.Errorf("%s espera %d argumentos y recibió %d", method, t.NumIn(), len(raw))
	}
	in := make([]reflect.Value, t.NumIn())
	for i := range in {
		p := reflect.New(t.In(i))
		if err := json.Unmarshal(raw[i], p.Interface()); err != nil {
			return "", fmt.Errorf("argumento %d de %s: %w", i+1, method, err)
		}
		in[i] = p.Elem()
	}
	var result any
	for _, v := range m.Call(in) {
		if v.Type().Implements(errorType) {
			if !v.IsNil() {
				return "", v.Interface().(error)
			}
			continue
		}
		result = v.Interface()
	}
	b, err := json.Marshal(result)
	if err != nil {
		return "", errors.New("no se pudo serializar la respuesta de " + method)
	}
	return string(b), nil
}

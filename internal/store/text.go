package store

import (
	"encoding/json"
	"strings"
)

// plainTextOf extrae el texto de un documento ProseMirror (para la vista previa
// y la comparación de versiones que vienen de fuera).
func plainTextOf(content []byte) string {
	var doc map[string]any
	if json.Unmarshal(content, &doc) != nil {
		return ""
	}
	var b strings.Builder
	var walk func(n map[string]any)
	walk = func(n map[string]any) {
		if t, ok := n["text"].(string); ok {
			b.WriteString(t)
		}
		kids, _ := n["content"].([]any)
		for _, k := range kids {
			if m, ok := k.(map[string]any); ok {
				walk(m)
			}
		}
		switch n["type"] {
		case "paragraph", "heading", "listItem", "taskItem", "tableCell", "tableHeader", "blockquote", "codeBlock":
			b.WriteByte('\n')
		}
	}
	walk(doc)
	return b.String()
}

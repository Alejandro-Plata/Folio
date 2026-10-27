package docx

import "strings"

// LatexToText convierte LaTeX matemático habitual en texto Unicode legible
// (x², √(a+b), α ≤ β…) para que las ecuaciones se lean bien en Word.
func LatexToText(src string) string {
	p := &latexParser{s: []rune(src)}
	return strings.Join(strings.Fields(p.seq(0)), " ")
}

var latexSymbols = map[string]string{
	"alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ",
	"eta": "η", "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν",
	"xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ", "phi": "φ", "varphi": "φ",
	"chi": "χ", "psi": "ψ", "omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ",
	"Pi": "Π", "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
	"cdot": "·", "times": "×", "div": "÷", "pm": "±", "mp": "∓", "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥",
	"neq": "≠", "ne": "≠", "approx": "≈", "equiv": "≡", "sim": "∼", "propto": "∝", "infty": "∞",
	"sum": "∑", "prod": "∏", "int": "∫", "iint": "∬", "oint": "∮", "partial": "∂", "nabla": "∇",
	"rightarrow": "→", "to": "→", "leftarrow": "←", "Rightarrow": "⇒", "Leftarrow": "⇐", "leftrightarrow": "↔",
	"Leftrightarrow": "⇔", "implies": "⇒", "iff": "⇔", "mapsto": "↦",
	"in": "∈", "notin": "∉", "subset": "⊂", "subseteq": "⊆", "supset": "⊃", "cup": "∪", "cap": "∩",
	"emptyset": "∅", "varnothing": "∅", "forall": "∀", "exists": "∃", "neg": "¬", "land": "∧", "lor": "∨",
	"angle": "∠", "perp": "⊥", "parallel": "∥", "degree": "°", "circ": "∘", "ldots": "…", "cdots": "⋯", "dots": "…",
	"mathbb{R}": "ℝ", "quad": "  ", "qquad": "    ", ",": " ", ";": " ", ":": " ", "!": "", " ": " ",
	"sin": "sin", "cos": "cos", "tan": "tan", "log": "log", "ln": "ln", "lim": "lim", "exp": "exp",
	"max": "max", "min": "min", "det": "det", "left": "", "right": "", "displaystyle": "",
	"{": "{", "}": "}", "%": "%", "$": "$", "#": "#", "&": "&", "_": "_", "\\": " ",
}

var blackboard = map[rune]string{'R': "ℝ", 'N': "ℕ", 'Z': "ℤ", 'Q': "ℚ", 'C': "ℂ"}

var supMap = map[rune]rune{
	'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
	'+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ', 'a': 'ᵃ',
	'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'k': 'ᵏ', 'm': 'ᵐ', 't': 'ᵗ', '−': '⁻', '°': '°',
}

var subMap = map[rune]rune{
	'0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
	'+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ',
	'n': 'ₙ', 'o': 'ₒ', 'x': 'ₓ', 'm': 'ₘ', 't': 'ₜ', 'r': 'ᵣ', 'u': 'ᵤ', 'v': 'ᵥ',
}

type latexParser struct {
	s []rune
	i int
}

// seq lee hasta el final o hasta la llave de cierre del grupo actual.
func (p *latexParser) seq(depth int) string {
	var out strings.Builder
	for p.i < len(p.s) {
		c := p.s[p.i]
		switch c {
		case '}':
			if depth > 0 {
				p.i++
				return out.String()
			}
			p.i++
		case '{':
			p.i++
			out.WriteString(p.seq(depth + 1))
		case '^', '_':
			p.i++
			arg := p.arg()
			if c == '^' {
				out.WriteString(script(arg, supMap, "^"))
			} else {
				out.WriteString(script(arg, subMap, "_"))
			}
		case '\\':
			out.WriteString(p.command())
		case '-':
			out.WriteRune('−')
			p.i++
		case '~':
			out.WriteRune(' ')
			p.i++
		default:
			out.WriteRune(c)
			p.i++
		}
	}
	return out.String()
}

// arg lee un argumento: un grupo {…}, un comando o un solo carácter.
func (p *latexParser) arg() string {
	for p.i < len(p.s) && p.s[p.i] == ' ' {
		p.i++
	}
	if p.i >= len(p.s) {
		return ""
	}
	switch p.s[p.i] {
	case '{':
		p.i++
		return p.seq(1)
	case '\\':
		return p.command()
	}
	c := p.s[p.i]
	p.i++
	if c == '-' {
		return "−"
	}
	return string(c)
}

func (p *latexParser) command() string {
	p.i++ // '\'
	start := p.i
	for p.i < len(p.s) && isLetter(p.s[p.i]) {
		p.i++
	}
	if p.i == start && p.i < len(p.s) {
		p.i++ // comando de un símbolo: \, \{ \\ …
	}
	name := string(p.s[start:p.i])
	switch name {
	case "frac", "dfrac", "tfrac":
		num, den := p.arg(), p.arg()
		return wrap(num) + "/" + wrap(den)
	case "sqrt":
		idx := ""
		if p.i < len(p.s) && p.s[p.i] == '[' {
			end := p.i
			for end < len(p.s) && p.s[end] != ']' {
				end++
			}
			idx = string(p.s[p.i+1 : min(end, len(p.s))])
			p.i = min(end+1, len(p.s))
		}
		root := "√"
		switch idx {
		case "":
		case "3":
			root = "∛"
		case "4":
			root = "∜"
		default:
			root = script(idx, supMap, "") + "√"
		}
		a := p.arg()
		if len([]rune(a)) == 1 {
			return root + a
		}
		return root + "(" + a + ")"
	case "text", "mathrm", "textrm", "mathit", "textbf", "mathbf", "operatorname", "mbox":
		return p.arg()
	case "mathbb":
		a := p.arg()
		if r := []rune(a); len(r) == 1 {
			if v, ok := blackboard[r[0]]; ok {
				return v
			}
		}
		return a
	case "vec":
		return p.arg() + "⃗"
	case "bar", "overline":
		return p.arg() + "̄"
	case "hat":
		return p.arg() + "̂"
	case "begin", "end":
		p.arg()
		return " "
	}
	if v, ok := latexSymbols[name]; ok {
		if isLetter(rune(name[0])) && v != "" && isLetter([]rune(v)[0]) && len(v) > 1 {
			return v + " " // sin, cos, log…
		}
		return v
	}
	return name
}

func wrap(s string) string {
	if len([]rune(strings.TrimSpace(s))) <= 1 || !strings.ContainsAny(s, "+−-·×/ ") {
		return s
	}
	return "(" + s + ")"
}

func script(s string, m map[rune]rune, fallback string) string {
	var out strings.Builder
	for _, r := range s {
		v, ok := m[r]
		if !ok {
			if len([]rune(s)) == 1 {
				return fallback + s
			}
			return fallback + "(" + s + ")"
		}
		out.WriteRune(v)
	}
	return out.String()
}

func isLetter(r rune) bool { return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') }

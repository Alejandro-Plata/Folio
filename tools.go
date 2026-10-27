//go:build tools

package main

// Mantiene golang.org/x/mobile en go.mod: gomobile bind lo exige para generar el .aar de Android.
import _ "golang.org/x/mobile/bind"

; Instalador de Folio para Windows 10/11: un único .exe que instala la app para
; el usuario actual (sin permisos de administrador), crea los accesos del menú
; Inicio y del escritorio, la registra en «Aplicaciones instaladas» y la abre.
;
; Windows no permite que un programa se ancle solo a la barra de tareas; Folio
; explica cómo hacerlo la primera vez que se abre.
;
; Compilar (desde la raíz del proyecto): ./build.sh installer
;   makensis -DVERSION=1.0.0 -DBIN=build/bin/folio.exe -DOUT=build/bin/Folio-Setup-1.0.0.exe build/windows/installer/folio-setup.nsi

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef BIN
  !error "Falta -DBIN=ruta/al/folio.exe"
!endif
!ifndef OUT
  !define OUT "Folio-Setup-${VERSION}.exe"
!endif

!define APP "Folio"
!define EXE "Folio.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"
!define WEBVIEW2_ID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
BrandingText "${APP} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow
AutoCloseWindow true

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "${APP}"
VIAddVersionKey /LANG=0 "FileDescription" "Instalador de ${APP}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "CompanyName" "${APP}"
VIAddVersionKey /LANG=0 "LegalCopyright" "© 2026"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Folio está instalado"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Se abrirá en un momento."

; Sin asistente: al abrir el instalador se instala directamente.
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Section "Folio"
  SetOutPath "$INSTDIR"
  StrCpy $R9 0

  ; Si Folio está abierto, el ejecutable no se puede sustituir.
  copy:
  ClearErrors
  File "/oname=${EXE}" "${BIN}"
  ; Motor de dictado sin conexión (whisper.cpp), junto al ejecutable
  !ifdef WHISPER
    File "/oname=whisper-cli.exe" "${WHISPER}"
  !endif
  ${If} ${Errors}
    ; Actualización desde la app (instalación silenciosa): Folio se está cerrando, se espera hasta 20 s
    ${If} ${Silent}
    ${AndIf} $R9 < 20
      IntOp $R9 $R9 + 1
      Sleep 1000
      Goto copy
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Folio está abierto. Ciérralo y pulsa Reintentar." /SD IDCANCEL IDRETRY copy
    Abort "Instalación cancelada."
  ${EndIf}

  WriteUninstaller "$INSTDIR\Desinstalar.exe"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "Editor de documentos para docentes"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "Editor de documentos para docentes"

  ; «Configuración > Aplicaciones > Aplicaciones instaladas»
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Desinstalar.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

  ; Folio usa WebView2, que viene con Windows 11 (y con Windows 10 actualizado).
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_ID}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_ID}" "pv"
  ${EndIf}
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    MessageBox MB_YESNO|MB_ICONINFORMATION "Folio necesita Microsoft Edge WebView2, que no está instalado en este equipo.$\n$\n¿Abrir la página de descarga de Microsoft?" /SD IDNO IDNO launch
    ExecShell "open" "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    Goto done
  ${EndIf}

  launch:
  Exec '"$INSTDIR\${EXE}"'
  done:
SectionEnd

Section "Uninstall"
  ; Los documentos (Documentos\Folio) y los ajustes del usuario no se tocan.
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\whisper-cli.exe"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd

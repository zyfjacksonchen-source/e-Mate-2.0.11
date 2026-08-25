!ifndef BUILD_UNINSTALLER
  Var /GLOBAL emateUpdateRequest
  Var /GLOBAL emateUpdateToken
  Var /GLOBAL emateUpdateOutput
  Var /GLOBAL emateUpdateAction
  Var /GLOBAL emateUpdateCandidate
  Var /GLOBAL emateUpdateCanonical

  !macro emateRunUpdateTransaction OPERATION
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-update-transaction.ps1" -Operation "${OPERATION}" -RequestPath "$emateUpdateRequest" -Token "$emateUpdateToken" -InstallerPath "$EXEPATH" -InstallDirectory "$INSTDIR" -InstallMode "$installMode" -OutputPath "$emateUpdateOutput"'
    Pop $R8
    Pop $R9
    ${if} $R8 != 0
      DetailPrint "e-Mate update transaction ${OPERATION} failed: $R9"
      SetErrorLevel 1
      Quit
    ${endif}
  !macroend

  # Presence of both private values selects the transaction. `${isUpdated}` is
  # installer state only; a manual/fresh invocation falls through unchanged.
  !macro customUpdateInstallShouldRun OUT_VAR
    StrCpy ${OUT_VAR} "false"
    ${StdUtils.GetParameter} $emateUpdateRequest "emate-update-request" ""
    ${StdUtils.GetParameter} $emateUpdateToken "emate-update-token" ""
    ${if} $emateUpdateRequest != ""
    ${orIf} $emateUpdateToken != ""
      ${if} $emateUpdateRequest == ""
      ${orIf} $emateUpdateToken == ""
        DetailPrint "The private e-Mate update request is incomplete."
        SetErrorLevel 1
        Quit
      ${endif}
      StrCpy ${OUT_VAR} "true"
    ${endif}
  !macroend

  !macro customUpdateInstall
    InitPluginsDir
    File /oname=$PLUGINSDIR\windows-update-transaction.ps1 "${BUILD_RESOURCES_DIR}\windows-update-transaction.ps1"
    StrCpy $emateUpdateOutput "$PLUGINSDIR\windows-update-result.ini"
    !insertmacro emateRunUpdateTransaction "Prepare"
    ReadINIStr $emateUpdateAction "$emateUpdateOutput" "update" "action"
    ReadINIStr $emateUpdateCandidate "$emateUpdateOutput" "update" "candidate"
    ReadINIStr $emateUpdateCanonical "$emateUpdateOutput" "update" "canonical"

    ${if} $emateUpdateAction == "stage"
      StrCpy $INSTDIR "$emateUpdateCandidate"
      SetOutPath $INSTDIR
      !ifdef UNINSTALLER_ICON
        File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
      !endif
      !insertmacro installApplicationFiles
    ${elseIf} $emateUpdateAction != "resume"
      DetailPrint "Unexpected e-Mate update prepare action: $emateUpdateAction"
      SetErrorLevel 1
      Quit
    ${endif}

    StrCpy $INSTDIR "$emateUpdateCanonical"
    !insertmacro emateRunUpdateTransaction "Apply"
    ReadINIStr $emateUpdateAction "$emateUpdateOutput" "update" "action"
    ${if} $emateUpdateAction == "rolled-back"
      ${StdUtils.ExecShellAsUser} $R8 "$emateUpdateCanonical\${APP_EXECUTABLE_FILENAME}" "open" ""
      Goto emateUpdateInstallFinished
    ${endif}

    ${if} $emateUpdateAction == "launch"
      ${StdUtils.ExecShellAsUser} $R8 "$emateUpdateCanonical\${APP_EXECUTABLE_FILENAME}" "open" '--updated --emate-update-request="$emateUpdateRequest" --emate-update-token=$emateUpdateToken'
    ${elseIf} $emateUpdateAction != "monitor"
    ${andIf} $emateUpdateAction != "committed"
      DetailPrint "Unexpected e-Mate update apply action: $emateUpdateAction"
      SetErrorLevel 1
      Quit
    ${endif}

    ${if} $emateUpdateAction != "committed"
      !insertmacro emateRunUpdateTransaction "Monitor"
      ReadINIStr $emateUpdateAction "$emateUpdateOutput" "update" "action"
      ${if} $emateUpdateAction == "rolled-back"
        ${StdUtils.ExecShellAsUser} $R8 "$emateUpdateCanonical\${APP_EXECUTABLE_FILENAME}" "open" ""
        Goto emateUpdateInstallFinished
      ${elseIf} $emateUpdateAction != "committed"
      ${andIf} $emateUpdateAction != "forward-only"
        DetailPrint "Unexpected e-Mate update monitor action: $emateUpdateAction"
        SetErrorLevel 1
        Quit
      ${endif}
    ${endif}

    StrCpy $INSTDIR "$emateUpdateCanonical"
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    !insertmacro registryAddInstallInfo
    !insertmacro addStartMenuLink "false"
    !insertmacro addDesktopLink "false"
    !ifmacrodef registerFileAssociations
      !insertmacro registerFileAssociations
    !endif
    !ifmacrodef customInstall
      !insertmacro customInstall
    !endif

    emateUpdateInstallFinished:
  !macroend
!endif

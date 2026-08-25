!ifndef BUILD_UNINSTALLER
  Var /GLOBAL emateUpdateRequest
  Var /GLOBAL emateUpdateToken
  Var /GLOBAL emateUpdateOutput
  Var /GLOBAL emateUpdateAction
  Var /GLOBAL emateUpdateCandidate
  Var /GLOBAL emateUpdateCanonical
  Var /GLOBAL emateUpdateSha256
  Var /GLOBAL emateUpdateSignature
  Var /GLOBAL emateUpdatePublisher
  Var /GLOBAL emateUpdateCurrentVersion

  !macro emateRunUpdateTransaction OPERATION
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\windows-update-transaction.ps1" -Operation "${OPERATION}" -RequestPath "$emateUpdateRequest" -Token "$emateUpdateToken" -InstallerPath "$EXEPATH" -InstallDirectory "$INSTDIR" -InstallMode "$installMode" -TargetVersion "${VERSION}" -BaseContractPath "$PLUGINSDIR\base-contract.json" -OutputPath "$emateUpdateOutput"'
    Pop $R8
    Pop $R9
    ${if} $R8 != 0
      DetailPrint "e-Mate update transaction ${OPERATION} failed: $R9"
      SetErrorLevel 1
      Quit
    ${endif}
  !macroend

  # A complete private receipt is the only silent authority. Existing installs
  # without one must cross the visible manual-SHA confirmation before the same
  # transaction owner is allowed to mint a request.
  !macro customUpdateInstallShouldRun OUT_VAR
    StrCpy ${OUT_VAR} "false"
    InitPluginsDir
    File /oname=$PLUGINSDIR\windows-update-transaction.ps1 "${BUILD_RESOURCES_DIR}\windows-update-transaction.ps1"
    File /oname=$PLUGINSDIR\base-contract.json "${PROJECT_DIR}\base-contract.json"
    StrCpy $emateUpdateOutput "$PLUGINSDIR\windows-update-result.ini"
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
      Goto emateUpdateSelectionFinished
    ${endif}

    # A fresh install must retain electron-builder's native path, including
    # machines where Windows PowerShell is unavailable or restricted.
    ${ifNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      Goto emateUpdateSelectionFinished
    ${endif}
    IfSilent emateAutomaticWithoutReceipt emateInteractiveManualUpdate
    emateAutomaticWithoutReceipt:
      DetailPrint "An automatic e-Mate update requires a private update receipt."
      SetErrorLevel 1
      Quit

    emateInteractiveManualUpdate:
      !insertmacro emateRunUpdateTransaction "Inspect"
    ReadINIStr $emateUpdateAction "$emateUpdateOutput" "update" "action"
    ${if} $emateUpdateAction == "fresh"
      Goto emateUpdateSelectionFinished
    ${elseIf} $emateUpdateAction != "manual"
      DetailPrint "Unexpected e-Mate update inspection action: $emateUpdateAction"
      SetErrorLevel 1
      Quit
    ${endif}

      ReadINIStr $emateUpdateCurrentVersion "$emateUpdateOutput" "update" "currentVersion"
      ReadINIStr $emateUpdateSha256 "$emateUpdateOutput" "update" "sha256"
      ReadINIStr $emateUpdateSignature "$emateUpdateOutput" "update" "signatureStatus"
      ReadINIStr $emateUpdatePublisher "$emateUpdateOutput" "update" "publisher"
      ${if} $emateUpdateSignature == "unsigned"
        StrCpy $R6 "签名状态: 未签名（必须先与官网下载页、R2 清单中的 SHA-256 核对）"
      ${elseIf} $emateUpdateSignature == "valid"
        StrCpy $R6 "签名状态: Authenticode 有效；发布者: $emateUpdatePublisher"
      ${else}
        DetailPrint "Unexpected e-Mate installer signature state: $emateUpdateSignature"
        SetErrorLevel 1
        Quit
      ${endif}
      MessageBox MB_ICONEXCLAMATION|MB_YESNO|MB_DEFBUTTON2 "将 e-Mate $emateUpdateCurrentVersion 更新为 ${VERSION}，并保留会话、项目和本地数据。$\r$\n$\r$\n发布来源: e-Mate 官方下载页 / R2 不可变安装包（请自行核对）$\r$\nSHA-256: $emateUpdateSha256$\r$\n$R6$\r$\n$\r$\n是否确认安装 ${VERSION}？" IDYES emateManualUpdateConfirmed IDNO emateManualUpdateCancelled
    emateManualUpdateCancelled:
      SetErrorLevel 2
      Quit
    emateManualUpdateConfirmed:
      !insertmacro CHECK_APP_RUNNING
      !insertmacro emateRunUpdateTransaction "Bootstrap"
      ReadINIStr $emateUpdateAction "$emateUpdateOutput" "update" "action"
      ReadINIStr $emateUpdateRequest "$emateUpdateOutput" "update" "request"
      ReadINIStr $emateUpdateToken "$emateUpdateOutput" "update" "token"
      ${if} $emateUpdateAction != "bootstrap"
      ${orIf} $emateUpdateRequest == ""
      ${orIf} $emateUpdateToken == ""
        DetailPrint "The manual e-Mate update bootstrap did not return a private receipt."
        SetErrorLevel 1
        Quit
      ${endif}
      StrCpy ${OUT_VAR} "true"

    emateUpdateSelectionFinished:
  !macroend

  !macro customUpdateInstall
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

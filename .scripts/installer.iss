; ==========================================================================
; LEGACY Inno Setup installer script — kept for reference.
; Windows builds now use electron-builder NSIS packaging (see CI workflows).
; ==========================================================================
#define MyAppName "ncSender"
#define MyAppPublisher "Francis Creation"
#define MyAppURL "https://github.com/siganberg/ncSender"
#define MyAppExeName "ncSender.exe"

[Setup]
AppId={{B5E3F2A1-7C4D-4E8F-9A2B-1D3E5F7A9B0C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=ncSender_{#MyAppVersion}_windows_x64_setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\src\NcSender.Desktop\Assets\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "package\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

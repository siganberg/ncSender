namespace NcSender.Server.Infrastructure;

public static class PathUtils
{
    /// <summary>
    /// Returns the platform-specific user data directory for ncSender.
    /// Windows:  %APPDATA%\ncSender
    /// macOS:    ~/Library/Application Support/ncSender
    /// Linux:    ~/.config/ncSender
    /// </summary>
    public static string GetUserDataDir()
    {
        string basePath;

        if (OperatingSystem.IsWindows())
        {
            basePath = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        }
        else if (OperatingSystem.IsMacOS())
        {
            basePath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Library", "Application Support");
        }
        else
        {
            // Linux / other Unix
            basePath = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME")
                ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config");
        }

        return Path.Combine(basePath, "ncSender");
    }

    public static string GetSettingsPath() => Path.Combine(GetUserDataDir(), "settings.json");

    public static string GetGcodeFilesDir() => Path.Combine(GetUserDataDir(), "gcode-files");

    public static string GetGcodeCacheDir() => Path.Combine(GetUserDataDir(), "gcode-cache");

    public static string GetLogsDir() => Path.Combine(GetUserDataDir(), "logs");

    public static string GetPluginsDir() =>
        Environment.GetEnvironmentVariable("DEV_PLUGINS_DIR") ?? Path.Combine(GetUserDataDir(), "plugins");

    /// <summary>
    /// Plugin settings directory — separate from plugin install dir so settings survive install/uninstall.
    /// Shared with V1: ~/Library/Application Support/ncSender/plugin-config/{pluginId}/config.json
    /// </summary>
    public static string GetPluginConfigDir() => Path.Combine(GetUserDataDir(), "plugin-config");

    public static string GetMacrosDir() => Path.Combine(GetUserDataDir(), "macros");

    public static string GetCommandHistoryPath() => Path.Combine(GetUserDataDir(), "command-history.json");

    public static string GetToolsPath() => Path.Combine(GetUserDataDir(), "tools.json");

    public static string GetFirmwareDir(string protocol) => Path.Combine(GetUserDataDir(), protocol);

    public static string GetFirmwarePath(string protocol) => Path.Combine(GetFirmwareDir(protocol), "firmware.json");

    public static string GetAlarmsPath(string protocol) => Path.Combine(GetFirmwareDir(protocol), "alarms.json");

    /// <summary>
    /// Ensures all required data directories exist.
    /// </summary>
    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(GetGcodeFilesDir());
        Directory.CreateDirectory(GetGcodeCacheDir());
        Directory.CreateDirectory(GetLogsDir());
        Directory.CreateDirectory(GetMacrosDir());
    }
}

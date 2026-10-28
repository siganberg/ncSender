using System.Runtime.CompilerServices;
using NcSender.Server.Infrastructure;

namespace NcSender.Server.Tests;

// Every test run gets its own data directory: the tests must never touch the
// real one (the G-code cache, settings, the Grbl tool file).
internal static class TestDataDir
{
    [ModuleInitializer]
    internal static void Init() =>
        PathUtils.DataDirOverride = Path.Combine(Path.GetTempPath(), $"ncsender-tests-{Guid.NewGuid():N}");
}

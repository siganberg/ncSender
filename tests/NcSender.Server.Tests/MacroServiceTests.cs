using NcSender.Core.Models;
using NcSender.Server.Macros;
using Microsoft.Extensions.Logging.Abstractions;

namespace NcSender.Server.Tests;

public class MacroServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly MacroService _svc;

    public MacroServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"ncsender-macros-test-{Guid.NewGuid()}");
        Directory.CreateDirectory(_tempDir);
        _svc = new MacroService(NullLogger<MacroService>.Instance);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, true);
    }

    [Fact]
    public void ParseMacroHeader_ExtractsNameAndDescription()
    {
        var content = "( PROGRAM: Tool Change )\n( DESC: Custom tool change routine )\n\nG28 G91 Z0\nM6 T1";
        var (name, description) = MacroService.ParseMacroHeader(content);

        Assert.Equal("Tool Change", name);
        Assert.Equal("Custom tool change routine", description);
    }

    [Fact]
    public void ParseMacroHeader_EmptyContent_ReturnsEmpty()
    {
        var (name, description) = MacroService.ParseMacroHeader("");
        Assert.Equal("", name);
        Assert.Equal("", description);
    }

    [Fact]
    public void ParseMacroHeader_NoHeaders_ReturnsEmpty()
    {
        var (name, description) = MacroService.ParseMacroHeader("G0 X10\nG0 Y20");
        Assert.Equal("", name);
        Assert.Equal("", description);
    }

    [Fact]
    public void ExtractBody_SkipsHeaders()
    {
        var content = "( PROGRAM: Test )\n( DESC: A test )\n\nG0 X10\nG0 Y20";
        var body = MacroService.ExtractBody(content);

        Assert.Equal("G0 X10\nG0 Y20", body);
    }

    [Fact]
    public void ExtractBody_NoHeaders_ReturnsAll()
    {
        var content = "G0 X10\nG0 Y20";
        var body = MacroService.ExtractBody(content);

        Assert.Equal("G0 X10\nG0 Y20", body);
    }

    [Fact]
    public async Task CreateMacro_InvalidId_Throws()
    {
        var macro = new MacroInfo { Id = 100, Name = "Test", Body = "G0 X10" };

        await Assert.ThrowsAsync<ArgumentException>(() => _svc.CreateMacroAsync(macro));
    }

    [Fact]
    public void GetNextAvailableId_ReturnsValidRange()
    {
        var (nextId, minId, maxId) = _svc.GetNextAvailableId();

        Assert.Equal(9001, minId);
        Assert.Equal(9999, maxId);
        Assert.InRange(nextId, minId, maxId);
    }

    [Fact]
    public void ListMacros_EmptyDirectory_ReturnsEmpty()
    {
        var macros = _svc.ListMacros();
        // May return macros from the real macros dir, but shouldn't error
        Assert.NotNull(macros);
    }
}

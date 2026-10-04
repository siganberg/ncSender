using NcSender.Core.Interfaces;
using NcSender.Core.Models;
using NcSender.Server.Connection;
using NcSender.Server.Protocols.FluidNc;
using NcSender.Server.Protocols.GrblHal;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace NcSender.Server.Tests;

// GitHub #66: FluidNC never prints [TLO:], so a tool length change made by a
// firmware macro or plugin (G43.1) only shows up in the WCO of the status
// report. The handler keeps that WCO and reads the TLO back from it; between
// WCO reports it rebuilds WCO from G5x + G92 + that TLO.
public class FluidNcWcoTests
{
    private static MachineState Fluid(string? wco, bool inReport) => new()
    {
        Workspace = "G54",
        G54 = "-100.000,-50.000,-20.000",
        G92Offset = "0.000,0.000,0.000",
        WCO = wco,
        WcoInReport = inReport,
    };

    [Fact]
    public void Reported_wco_is_kept_and_tlo_read_from_it()
    {
        var s = Fluid("-100.000,-50.000,-28.792", inReport: true);
        new FluidNcProtocol().PostProcessStatus(s, "Idle");
        Assert.Equal("-100.000,-50.000,-28.792", s.WCO);
        Assert.Equal(-8.792, s.Tlo, 3);
    }

    [Fact]
    public void Reports_without_wco_keep_the_new_tlo()
    {
        var p = new FluidNcProtocol();
        var s = Fluid("-100.000,-50.000,-28.792", inReport: true);
        p.PostProcessStatus(s, "Idle");
        s.WcoInReport = false;               // the next reports carry no WCO
        p.PostProcessStatus(s, "Idle");
        Assert.Equal("-100.000,-50.000,-28.792", s.WCO);
    }

    [Fact]
    public void G92_is_not_counted_as_tlo()
    {
        var s = Fluid("-90.000,-50.000,-25.000", inReport: true);
        s.G92Offset = "10.000,0.000,-5.000";
        new FluidNcProtocol().PostProcessStatus(s, "Idle");
        Assert.Equal(0, s.Tlo, 3);
    }

    [Fact]
    public void Without_a_reported_wco_it_is_still_synthesized()
    {
        var s = Fluid(null, inReport: false);
        s.Tlo = -3;
        new FluidNcProtocol().PostProcessStatus(s, "Idle");
        Assert.Equal("-100.000,-50.000,-23.000", s.WCO);
    }

    [Fact]
    public void Workspace_switch_between_wco_reports_is_synthesized_at_once()
    {
        var p = new FluidNcProtocol();
        var s = Fluid("-100.000,-50.000,-28.792", inReport: true);
        p.PostProcessStatus(s, "Idle");
        s.G55 = "0.000,0.000,-10.000"; s.Workspace = "G55"; s.WcoInReport = false;
        p.PostProcessStatus(s, "Idle");
        Assert.Equal("0.000,0.000,-18.792", s.WCO);
    }

    [Fact]
    public void Parser_flags_whether_the_report_carried_wco()
    {
        var settings = new Mock<ISettingsManager>();
        settings.Setup(x => x.GetSetting<int>(It.IsAny<string>(), It.IsAny<int>())).Returns(100);
        var c = new CncController(NullLogger<CncController>.Instance, settings.Object,
            new IProtocolHandler[] { new GrblHalProtocol(), new FluidNcProtocol() }, new Mock<IDongleDeviceService>().Object);
        c.ParseStatusReport("<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:1.000,2.000,3.000>");
        Assert.True(c.LastStatus.WcoInReport);
        c.ParseStatusReport("<Idle|MPos:0.000,0.000,0.000|FS:0,0>");
        Assert.False(c.LastStatus.WcoInReport);
        Assert.Equal("1.000,2.000,3.000", c.LastStatus.WCO);   // last WCO kept, as before
    }

    // grblHAL: WCO comes from the status report and nothing rewrites it.
    [Fact]
    public void GrblHal_wco_is_untouched()
    {
        var s = Fluid("-100.000,-50.000,-28.792", inReport: true);
        s.Tlo = 5;
        ((IProtocolHandler)new GrblHalProtocol()).PostProcessStatus(s, "Idle");
        Assert.Equal("-100.000,-50.000,-28.792", s.WCO);
        Assert.Equal(5, s.Tlo);
        s.WcoInReport = false;
        ((IProtocolHandler)new GrblHalProtocol()).PostProcessStatus(s, "Idle");
        Assert.Equal("-100.000,-50.000,-28.792", s.WCO);
    }
}

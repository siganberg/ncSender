using NcSender.Server.Firmware;

namespace NcSender.Server.Tests;

public class FirmwareBoardTests
{
    [Fact]
    public void ParseBoard_ReadsTheBoardLineOfDollarI()
    {
        var response = "[VER:1.1f.20260525:]\n[OPT:VNMZHS2,128,1024,4,32]\n[FIRMWARE:grblHAL]\n[BOARD:SuperLongBoard Ext]\n[AUX IO:7,4,1,0]\nok";
        Assert.Equal("SuperLongBoard Ext", FirmwareService.ParseBoard(response));
    }

    [Theory]
    [InlineData("[VER:1.1h.20190825:]\n[OPT:V,15,128]\nok")]
    [InlineData("[BOARD:]\nok")]
    [InlineData("")]
    public void ParseBoard_NoBoard_IsNull(string response)
    {
        Assert.Null(FirmwareService.ParseBoard(response));
    }
}

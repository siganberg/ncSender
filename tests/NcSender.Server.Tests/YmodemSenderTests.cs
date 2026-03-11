using NcSender.Server.ControllerFiles;

namespace NcSender.Server.Tests;

public class YmodemSenderTests
{
    [Fact]
    public void CalculateCrc16_EmptyData_ReturnsZero()
    {
        var data = new byte[128];
        var crc = YmodemSender.CalculateCrc16(data);
        Assert.Equal(0, crc);
    }

    [Fact]
    public void CalculateCrc16_KnownValues()
    {
        // "123456789" with CRC-16/XMODEM (poly 0x1021, init 0x0000) = 0x31C3
        var data = "123456789"u8.ToArray();
        var crc = YmodemSender.CalculateCrc16(data);
        Assert.Equal(0x31C3, crc);
    }

    [Fact]
    public void CalculateCrc16_DifferentData_DifferentCrc()
    {
        var data1 = new byte[] { 0x01, 0x02, 0x03 };
        var data2 = new byte[] { 0x04, 0x05, 0x06 };

        var crc1 = YmodemSender.CalculateCrc16(data1);
        var crc2 = YmodemSender.CalculateCrc16(data2);

        Assert.NotEqual(crc1, crc2);
    }

    [Fact]
    public void BuildHeaderBlock_EmptyFilename_Returns133Bytes()
    {
        var block = YmodemSender.BuildHeaderBlock("", 0);
        Assert.Equal(133, block.Length); // 3 header + 128 data + 2 CRC
    }

    [Fact]
    public void BuildHeaderBlock_WithFilename_ContainsSOH()
    {
        var block = YmodemSender.BuildHeaderBlock("test.gcode", 1024);
        Assert.Equal(0x01, block[0]); // SOH
        Assert.Equal(0x00, block[1]); // Block number 0
        Assert.Equal(0xFF, block[2]); // Complement
    }

    [Fact]
    public void BuildHeaderBlock_ContainsFilename()
    {
        var block = YmodemSender.BuildHeaderBlock("test.gcode", 1024);
        // Filename starts at byte 3 (after SOH, blocknum, complement)
        var nameBytes = System.Text.Encoding.ASCII.GetBytes("test.gcode");
        for (var i = 0; i < nameBytes.Length; i++)
        {
            Assert.Equal(nameBytes[i], block[3 + i]);
        }
    }

    [Fact]
    public void BuildHeaderBlock_ContainsFileSize()
    {
        var block = YmodemSender.BuildHeaderBlock("test.gcode", 12345);
        // Filesize follows filename + null separator
        var nameLen = "test.gcode".Length;
        var sizeOffset = 3 + nameLen + 1; // after SOH header + name + null
        var sizeStr = System.Text.Encoding.ASCII.GetString(block, sizeOffset, 5);
        Assert.Equal("12345", sizeStr);
    }

    [Fact]
    public void BuildDataBlock_Returns1029Bytes()
    {
        var data = new byte[1024];
        var block = YmodemSender.BuildDataBlock(1, data);
        Assert.Equal(1029, block.Length); // 3 header + 1024 data + 2 CRC
    }

    [Fact]
    public void BuildDataBlock_ContainsSTX()
    {
        var data = new byte[1024];
        var block = YmodemSender.BuildDataBlock(1, data);
        Assert.Equal(0x02, block[0]); // STX
        Assert.Equal(0x01, block[1]); // Block number
        Assert.Equal(0xFE, block[2]); // ~0x01
    }

    [Fact]
    public void BuildDataBlock_SequenceNumber_Wraps()
    {
        var data = new byte[1024];
        var block = YmodemSender.BuildDataBlock(0xFF, data);
        Assert.Equal(0xFF, block[1]);
        Assert.Equal(0x00, block[2]); // ~0xFF
    }

    [Fact]
    public void BuildDataBlock_ContainsCRC()
    {
        var data = new byte[1024];
        data[0] = 0x41; // 'A'
        var block = YmodemSender.BuildDataBlock(1, data);
        var expectedCrc = YmodemSender.CalculateCrc16(data);
        Assert.Equal((byte)(expectedCrc >> 8), block[1027]);
        Assert.Equal((byte)(expectedCrc & 0xFF), block[1028]);
    }

    [Fact]
    public void BuildDataBlock_DataPreserved()
    {
        var data = new byte[1024];
        for (var i = 0; i < 1024; i++)
            data[i] = (byte)(i % 256);

        var block = YmodemSender.BuildDataBlock(1, data);

        for (var i = 0; i < 1024; i++)
            Assert.Equal(data[i], block[3 + i]);
    }
}

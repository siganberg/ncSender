using NcSender.Core.Interfaces;

namespace NcSender.Server.ControllerFiles;

public class YmodemSender
{
    private const byte SOH = 0x01;
    private const byte STX = 0x02;
    private const byte EOT = 0x04;
    private const byte ACK = 0x06;
    private const byte NAK = 0x15;
    private const byte CAN = 0x18;
    private const byte CRC_MODE = (byte)'C';

    private readonly ICncController _controller;
    private readonly ILogger _logger;

    public YmodemSender(ICncController controller, ILogger logger)
    {
        _controller = controller;
        _logger = logger;
    }

    public async Task SendAsync(string filename, byte[] fileData, Action<double>? onProgress = null, CancellationToken ct = default)
    {
        var transport = _controller.Transport;
        if (transport is null)
            throw new InvalidOperationException("No transport available");

        _controller.EnterRawMode();

        try
        {
            // Wait for receiver to send 'C' (CRC mode)
            await Task.Delay(100, ct);

            // Send block 0: filename + filesize
            var headerBlock = BuildHeaderBlock(filename, fileData.Length);
            await transport.WriteRawAsync(headerBlock, ct);
            await Task.Delay(100, ct);

            // Send data blocks
            var blockNumber = 1;
            var offset = 0;
            var totalBlocks = (fileData.Length + 1023) / 1024;

            while (offset < fileData.Length)
            {
                ct.ThrowIfCancellationRequested();

                var remaining = fileData.Length - offset;
                var blockSize = Math.Min(1024, remaining);
                var data = new byte[1024];
                Buffer.BlockCopy(fileData, offset, data, 0, blockSize);

                var block = BuildDataBlock((byte)(blockNumber & 0xFF), data);
                await transport.WriteRawAsync(block, ct);
                await Task.Delay(50, ct);

                offset += blockSize;
                blockNumber++;

                onProgress?.Invoke((double)offset / fileData.Length * 100);
            }

            // Send EOT
            await transport.WriteRawAsync([EOT], ct);
            await Task.Delay(100, ct);

            // Send empty block 0 to end transfer
            var emptyHeader = BuildHeaderBlock("", 0);
            await transport.WriteRawAsync(emptyHeader, ct);
            await Task.Delay(100, ct);

            onProgress?.Invoke(100);
            _logger.LogInformation("Ymodem transfer complete: {Filename} ({Size} bytes)", filename, fileData.Length);
        }
        finally
        {
            _controller.ExitRawMode();
        }
    }

    internal static byte[] BuildHeaderBlock(string filename, int fileSize)
    {
        var data = new byte[128];
        var nameBytes = System.Text.Encoding.ASCII.GetBytes(filename);
        Buffer.BlockCopy(nameBytes, 0, data, 0, Math.Min(nameBytes.Length, 100));

        if (fileSize > 0)
        {
            var sizeStr = fileSize.ToString();
            var sizeBytes = System.Text.Encoding.ASCII.GetBytes(sizeStr);
            var sizeOffset = nameBytes.Length + 1; // null separator
            Buffer.BlockCopy(sizeBytes, 0, data, sizeOffset, Math.Min(sizeBytes.Length, 128 - sizeOffset));
        }

        var crc = CalculateCrc16(data);
        var block = new byte[3 + 128 + 2];
        block[0] = SOH;
        block[1] = 0x00; // block number
        block[2] = 0xFF; // complement
        Buffer.BlockCopy(data, 0, block, 3, 128);
        block[131] = (byte)(crc >> 8);
        block[132] = (byte)(crc & 0xFF);

        return block;
    }

    internal static byte[] BuildDataBlock(byte blockNumber, byte[] data)
    {
        var crc = CalculateCrc16(data);
        var block = new byte[3 + 1024 + 2];
        block[0] = STX;
        block[1] = blockNumber;
        block[2] = (byte)(~blockNumber);
        Buffer.BlockCopy(data, 0, block, 3, 1024);
        block[1027] = (byte)(crc >> 8);
        block[1028] = (byte)(crc & 0xFF);

        return block;
    }

    internal static ushort CalculateCrc16(byte[] data)
    {
        ushort crc = 0;
        foreach (var b in data)
        {
            crc ^= (ushort)(b << 8);
            for (var i = 0; i < 8; i++)
            {
                if ((crc & 0x8000) != 0)
                    crc = (ushort)((crc << 1) ^ 0x1021);
                else
                    crc <<= 1;
            }
        }
        return crc;
    }
}

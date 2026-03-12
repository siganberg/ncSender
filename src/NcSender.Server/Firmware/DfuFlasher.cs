using System.Text.RegularExpressions;
using LibUsbDotNet.LibUsb;
using LibUsbDotNet.Main;
#pragma warning disable CA1822 // Methods could be static - keeping instance methods for clarity

namespace NcSender.Server.Firmware;

/// <summary>
/// STM32 DFU (Device Firmware Update) flasher.
/// Implements USB DFU 1.1 with ST DfuSe extensions.
/// Ported from V1 Node.js DFU.js / DFUFlasher.js.
/// </summary>
public sealed partial class DfuFlasher : IDisposable
{
    // STMicroelectronics DFU Device Identifiers
    private const int STM32_DFU_VID = 0x0483;
    private const int STM32_DFU_PID = 0xDF11;
    private const int CHUNK_SIZE = 2048;

    // USB DFU Class Request Codes (per DFU 1.1 spec)
    private const byte DFU_DNLOAD = 0x01;
    private const byte DFU_GETSTATUS = 0x03;
    private const byte DFU_CLRSTATUS = 0x04;
    private const byte DFU_GETSTATE = 0x05;
    private const byte DFU_ABORT = 0x06;

    // USB DFU Device States
    private const byte STATE_IDLE = 2;
    private const byte STATE_DNBUSY = 4;
    private const byte STATE_DNLOAD_IDLE = 5;
    private const byte STATE_MANIFEST = 7;
    private const byte STATE_ERROR = 10;

    // DFU Status
    private const byte STATUS_OK = 0x00;

    // ST DfuSe Command Codes
    private const byte DFUSE_SET_ADDRESS = 0x21;
    private const byte DFUSE_ERASE_SECTOR = 0x41;

    private readonly ILogger _logger;
    private UsbContext? _context;
    private IUsbDevice? _device;
    private byte _interfaceNumber;
    private List<MemoryRegion>? _memoryLayout;

    public DfuFlasher(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Flash firmware from Intel HEX content.
    /// </summary>
    public async Task FlashAsync(string hexContent, Action<string>? onInfo = null, Action<int, int>? onProgress = null)
    {
        try
        {
            onInfo?.Invoke("Connecting to DFU device...");
            Connect();
            onInfo?.Invoke("Connected to STM32 DFU device");

            onInfo?.Invoke("Parsing firmware file...");
            var blocks = ParseIntelHex(hexContent);

            if (blocks.Count == 0)
                throw new InvalidOperationException("No data blocks found in HEX file");

            var firstAddr = blocks[0].Address;
            var totalSize = blocks.Sum(b => b.Data.Length);
            onInfo?.Invoke($"Firmware: {totalSize} bytes at 0x{firstAddr:X8}");

            ResetToIdle();
            onInfo?.Invoke("Device ready");

            await EraseFlashAsync(firstAddr, totalSize, onInfo, onProgress);

            foreach (var block in blocks)
            {
                onInfo?.Invoke($"Programming 0x{block.Address:X8} ({block.Data.Length} bytes)");
                await WriteDataAsync(block.Address, block.Data, onProgress);
            }

            Finalize(firstAddr, onInfo);

            onInfo?.Invoke("Firmware update complete!");
        }
        finally
        {
            Disconnect();
        }
    }

    private void Connect()
    {
        _context = new UsbContext();
        _device = _context.Find(d => d.VendorId == STM32_DFU_VID && d.ProductId == STM32_DFU_PID);

        if (_device is null)
            throw new InvalidOperationException("No STM32 DFU device found. Ensure device is in DFU/bootloader mode.");

        _device.Open();
        UsbDevice.ControlTransferTimeout = 30000; // 30s for large sector erase operations
        _device.SetConfiguration(1);
        _device.ClaimInterface(0);
        _interfaceNumber = 0;

        // Try to parse memory layout from device descriptor
        ParseMemoryLayoutFromDevice();

        _logger.LogInformation("Connected to STM32 DFU device");
    }

    private void Disconnect()
    {
        if (_device is not null)
        {
            try
            {
                _device.ReleaseInterface(0);
                _device.Close();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "DFU disconnect warning");
            }
            _device = null;
        }

        _context?.Dispose();
        _context = null;
    }

    private void ParseMemoryLayoutFromDevice()
    {
        _memoryLayout = [];

        try
        {
            // Read interface string descriptor (index 4 typically holds DfuSe memory layout)
            // Format: @name/0xADDRESS/sectors*size[BKM][rwea],...
            var str = _device!.GetStringDescriptor(4);
            if (!string.IsNullOrEmpty(str) && str.StartsWith('@'))
            {
                ParseMemoryLayout(str);
                _logger.LogInformation("Parsed DfuSe memory layout from device: {Descriptor}", str);
                return;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not read DfuSe memory layout descriptor");
        }

        // Default STM32F4xx memory layout (covers most boards including SLB)
        _logger.LogInformation("Using default STM32F4xx memory layout");
        _memoryLayout.Add(new MemoryRegion(0x08000000, 0x08004000, 0x4000, true));   // 4x16K
        _memoryLayout.Add(new MemoryRegion(0x08004000, 0x08008000, 0x4000, true));
        _memoryLayout.Add(new MemoryRegion(0x08008000, 0x0800C000, 0x4000, true));
        _memoryLayout.Add(new MemoryRegion(0x0800C000, 0x08010000, 0x4000, true));
        _memoryLayout.Add(new MemoryRegion(0x08010000, 0x08020000, 0x10000, true));  // 1x64K
        _memoryLayout.Add(new MemoryRegion(0x08020000, 0x08100000, 0x20000, true));  // 7x128K
    }

    [GeneratedRegex(@"/\s*(0x[0-9a-fA-F]+)\s*/([^/]+)")]
    private static partial Regex RegionPattern();

    [GeneratedRegex(@"(\d+)\s*\*\s*(\d+)\s*([BKM ])\s*([a-g])")]
    private static partial Regex SectorPattern();

    private void ParseMemoryLayout(string descriptor)
    {
        _memoryLayout = [];
        foreach (Match regionMatch in RegionPattern().Matches(descriptor))
        {
            var baseAddr = Convert.ToUInt32(regionMatch.Groups[1].Value, 16);
            var sectorDefs = regionMatch.Groups[2].Value;

            foreach (Match sectorMatch in SectorPattern().Matches(sectorDefs))
            {
                var count = int.Parse(sectorMatch.Groups[1].Value);
                var sizeNum = int.Parse(sectorMatch.Groups[2].Value);
                var sizeUnit = sectorMatch.Groups[3].Value[0];
                var props = sectorMatch.Groups[4].Value[0] - 'a' + 1;

                var multiplier = sizeUnit switch { 'K' => 1024, 'M' => 1048576, _ => 1 };
                var sectorSize = (uint)(sizeNum * multiplier);

                _memoryLayout.Add(new MemoryRegion(
                    baseAddr,
                    baseAddr + sectorSize * (uint)count,
                    sectorSize,
                    (props & 0x2) != 0));

                baseAddr += sectorSize * (uint)count;
            }
        }
    }

    private MemoryRegion? FindRegion(uint address) =>
        _memoryLayout?.FirstOrDefault(r => address >= r.Start && address < r.End);

    private static (uint Start, uint End) GetSectorBounds(uint addr, MemoryRegion region)
    {
        var sectorIdx = (addr - region.Start) / region.SectorSize;
        return (region.Start + sectorIdx * region.SectorSize,
                region.Start + (sectorIdx + 1) * region.SectorSize);
    }

    private async Task EraseFlashAsync(uint startAddr, int size, Action<string>? onInfo, Action<int, int>? onProgress)
    {
        onInfo?.Invoke($"Erasing {size} bytes starting at 0x{startAddr:X8}");

        var region = FindRegion(startAddr)
            ?? throw new InvalidOperationException($"No memory region found for address 0x{startAddr:X8}");

        var bounds = GetSectorBounds(startAddr, region);
        var currentAddr = bounds.Start;
        var endBounds = GetSectorBounds((uint)(startAddr + size - 1), region);
        var endAddr = endBounds.End;

        var totalBytes = (int)(endAddr - currentAddr);
        var erasedBytes = 0;

        while (currentAddr < endAddr)
        {
            var currentRegion = FindRegion(currentAddr);
            if (currentRegion is null)
            {
                currentAddr += region.SectorSize;
                continue;
            }

            if (!currentRegion.CanErase)
            {
                erasedBytes = Math.Min(erasedBytes + (int)(currentRegion.End - currentAddr), totalBytes);
                currentAddr = currentRegion.End;
                onProgress?.Invoke(erasedBytes, totalBytes);
                continue;
            }

            var sector = GetSectorBounds(currentAddr, currentRegion);
            onInfo?.Invoke($"Erasing sector at 0x{sector.Start:X8}");

            EraseSector(sector.Start);

            currentAddr = sector.End;
            erasedBytes += (int)currentRegion.SectorSize;
            onProgress?.Invoke(Math.Min(erasedBytes, totalBytes), totalBytes);

            await Task.Yield(); // Allow other work between sectors
        }

        onInfo?.Invoke("Erase complete");
    }

    private async Task WriteDataAsync(uint startAddr, byte[] data, Action<int, int>? onProgress)
    {
        var totalSize = data.Length;
        var offset = 0;
        var addr = startAddr;

        while (offset < totalSize)
        {
            var remaining = totalSize - offset;
            var chunkSize = Math.Min(remaining, CHUNK_SIZE);
            var chunk = new byte[chunkSize];
            Array.Copy(data, offset, chunk, 0, chunkSize);

            SetAddress(addr);
            DownloadBlock(chunk, 2);

            var status = WaitForState(s => s == STATE_DNLOAD_IDLE);
            if (status.Status != STATUS_OK)
                throw new InvalidOperationException($"Write failed at 0x{addr:X8}: status={status.Status}");

            offset += chunkSize;
            addr += (uint)chunkSize;
            onProgress?.Invoke(offset, totalSize);

            await Task.Yield();
        }

        _logger.LogInformation("Wrote {Size} bytes", totalSize);
    }

    private void Finalize(uint startAddr, Action<string>? onInfo)
    {
        onInfo?.Invoke("Finalizing and resetting device...");

        ResetToIdle();
        SetAddress(startAddr);
        DownloadBlock([], 0);

        try
        {
            WaitForState(s => s == STATE_MANIFEST);
        }
        catch
        {
            // Device may disconnect during manifest - this is normal
            _logger.LogInformation("Device reset (expected disconnect)");
        }
    }

    // --- Low-level DFU protocol ---

    private DfuStatus GetStatus()
    {
        var buf = new byte[6];
        var setup = new UsbSetupPacket(0xA1, DFU_GETSTATUS, 0, _interfaceNumber, 6);
        _device!.ControlTransfer(setup, buf, 0, 6);
        return new DfuStatus(buf);
    }

    private byte GetState()
    {
        var buf = new byte[1];
        var setup = new UsbSetupPacket(0xA1, DFU_GETSTATE, 0, _interfaceNumber, 1);
        _device!.ControlTransfer(setup, buf, 0, 1);
        return buf[0];
    }

    private void ClearStatus()
    {
        var setup = new UsbSetupPacket(0x21, DFU_CLRSTATUS, 0, 0, 0);
        _device!.ControlTransfer(setup);
    }

    private void Abort()
    {
        var setup = new UsbSetupPacket(0x21, DFU_ABORT, 0, 0, 0);
        _device!.ControlTransfer(setup);
    }

    private void DownloadBlock(byte[] data, int blockNum)
    {
        var setup = new UsbSetupPacket(0x21, DFU_DNLOAD, blockNum, 0, data.Length);
        if (data.Length > 0)
            _device!.ControlTransfer(setup, data, 0, data.Length);
        else
            _device!.ControlTransfer(setup);
    }

    private DfuStatus WaitForState(Func<byte, bool> checkFn, int maxRetries = 50)
    {
        var retries = 0;
        DfuStatus status;

        while (true)
        {
            try
            {
                status = GetStatus();
            }
            catch (Exception ex) when (retries < maxRetries)
            {
                // USB transfer can fail transiently during long operations (erase/write)
                retries++;
                _logger.LogDebug("GetStatus retry {Retry}/{Max}: {Error}", retries, maxRetries, ex.Message);
                Thread.Sleep(100);
                continue;
            }

            if (checkFn(status.State) || status.State == STATE_ERROR)
                return status;

            Thread.Sleep(Math.Max(status.PollTimeout, 10));
        }
    }

    private void ResetToIdle()
    {
        Abort();
        var state = GetState();

        if (state == STATE_ERROR)
        {
            ClearStatus();
            state = GetState();
        }

        if (state != STATE_IDLE)
            throw new InvalidOperationException($"Failed to reset to idle. Current state: {state}");
    }

    private void SendDfuseCommand(byte cmd, uint address)
    {
        var payload = new byte[5];
        payload[0] = cmd;
        BitConverter.TryWriteBytes(payload.AsSpan(1), address);

        DownloadBlock(payload, 0);
        var status = WaitForState(s => s != STATE_DNBUSY);

        if (status.Status != STATUS_OK)
            throw new InvalidOperationException($"DfuSe command 0x{cmd:X2} failed at 0x{address:X8}");
    }

    private void SetAddress(uint address)
    {
        SendDfuseCommand(DFUSE_SET_ADDRESS, address);
        GetStatus();
    }

    private void EraseSector(uint address)
    {
        SendDfuseCommand(DFUSE_ERASE_SECTOR, address);
        GetStatus();
    }

    // --- Intel HEX parser ---

    private static List<FirmwareBlock> ParseIntelHex(string hexContent)
    {
        var blocks = new Dictionary<uint, List<byte>>();
        uint baseAddress = 0;
        uint currentBlockStart = 0;
        List<byte>? currentBlock = null;

        foreach (var rawLine in hexContent.Split('\n', '\r'))
        {
            var line = rawLine.Trim();
            if (line.Length < 11 || line[0] != ':') continue;

            var byteCount = Convert.ToByte(line[1..3], 16);
            var address = Convert.ToUInt16(line[3..7], 16);
            var recordType = Convert.ToByte(line[7..9], 16);

            switch (recordType)
            {
                case 0x00: // Data record
                {
                    var fullAddress = baseAddress + address;
                    var data = new byte[byteCount];
                    for (var i = 0; i < byteCount; i++)
                        data[i] = Convert.ToByte(line[(9 + i * 2)..(11 + i * 2)], 16);

                    if (currentBlock is not null && fullAddress == currentBlockStart + (uint)currentBlock.Count)
                    {
                        currentBlock.AddRange(data);
                    }
                    else
                    {
                        currentBlock = [..data];
                        currentBlockStart = fullAddress;
                        blocks[currentBlockStart] = currentBlock;
                    }
                    break;
                }
                case 0x01: // EOF
                    break;
                case 0x02: // Extended segment address
                    baseAddress = (uint)(Convert.ToUInt16(line[9..13], 16) << 4);
                    currentBlock = null;
                    break;
                case 0x04: // Extended linear address
                    baseAddress = (uint)(Convert.ToUInt16(line[9..13], 16) << 16);
                    currentBlock = null;
                    break;
            }
        }

        return blocks
            .OrderBy(kvp => kvp.Key)
            .Select(kvp => new FirmwareBlock(kvp.Key, kvp.Value.ToArray()))
            .ToList();
    }

    public void Dispose()
    {
        Disconnect();
    }

    private record MemoryRegion(uint Start, uint End, uint SectorSize, bool CanErase);
    private record FirmwareBlock(uint Address, byte[] Data);

    private readonly struct DfuStatus(byte[] data)
    {
        public readonly byte Status = data[0];
        public readonly int PollTimeout = data[1] | (data[2] << 8) | (data[3] << 16);
        public readonly byte State = data[4];
    }
}

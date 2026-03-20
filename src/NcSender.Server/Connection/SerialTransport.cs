using System.Diagnostics;
using System.IO.Ports;
using System.Runtime.InteropServices;
using System.Text;
using NcSender.Core.Interfaces;
using Serilog;

namespace NcSender.Server.Connection;

public class SerialTransport : IConnectionTransport
{
    private static readonly Serilog.ILogger Logger = Log.ForContext<SerialTransport>();

    private readonly string _portPath;
    private readonly int _baudRate;
    private readonly StringBuilder _lineBuffer = new();
    private CancellationTokenSource? _readCts;
    private Thread? _readThread;

    // Windows: use SerialPort. Linux/macOS: use raw fd via P/Invoke.
    private SerialPort? _port;
    private int _fd = -1;
    private bool _useNativeIO;
    private volatile bool _isConnected;

    public bool IsConnected => _isConnected;
    public string TransportType => "usb";
    public string PortPath => _portPath;

    public event Action<string>? LineReceived;
    public event Action<Exception?>? ConnectionLost;

    public SerialTransport(string portPath, int baudRate)
    {
        _portPath = portPath;
        _baudRate = baudRate;
    }

    public Task ConnectAsync(CancellationToken ct = default)
    {
        Logger.Debug("Opening serial port {Path} at {BaudRate} baud", _portPath, _baudRate);

        _useNativeIO = !OperatingSystem.IsWindows();

        if (_useNativeIO)
            OpenNative();
        else
            OpenSerialPort();

        _isConnected = true;

        _readCts = new CancellationTokenSource();
        _readThread = new Thread(() => ReadLoop(_readCts.Token))
        {
            Name = "SerialRead",
            IsBackground = true
        };
        _readThread.Start();

        return Task.CompletedTask;
    }

    private void OpenNative()
    {
        // Configure port via stty BEFORE opening our fd.
        // This sets raw mode and baud rate so our fd inherits correct settings.
        var sttyArgs = $"-F {_portPath} {_baudRate} raw -echo -echoe -echok -hupcl cs8 -cstopb cread clocal -crtscts";
        try
        {
            using var stty = Process.Start(new ProcessStartInfo
            {
                FileName = "stty",
                Arguments = sttyArgs,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            stty?.WaitForExit(3000);
        }
        catch (Exception ex)
        {
            Logger.Warning("stty failed, falling back to SerialPort: {Error}", ex.Message);
            _useNativeIO = false;
            OpenSerialPort();
            return;
        }

        // Open fd with O_RDWR | O_NOCTTY | O_NONBLOCK (matches node.js serialport)
        _fd = Posix.Open(_portPath, Posix.O_RDWR | Posix.O_NOCTTY | Posix.O_NONBLOCK);
        if (_fd < 0)
        {
            var errno = Marshal.GetLastWin32Error();
            Logger.Warning("Native open failed (errno={Errno}), falling back to SerialPort", errno);
            _useNativeIO = false;
            OpenSerialPort();
            return;
        }

        // Clear O_NONBLOCK — we want blocking reads (matches node.js serialport behavior)
        var flags = Posix.Fcntl(_fd, Posix.F_GETFL, 0);
        if (flags >= 0)
            Posix.Fcntl(_fd, Posix.F_SETFL, flags & ~Posix.O_NONBLOCK);

        // Assert DTR
        var dtrBits = Posix.TIOCM_DTR | Posix.TIOCM_RTS;
        Posix.Ioctl(_fd, Posix.TIOCMBIS, ref dtrBits);

        Logger.Debug("Serial port opened via native fd={Fd}", _fd);
    }

    private void OpenSerialPort()
    {
        _port = new SerialPort(_portPath, _baudRate)
        {
            DtrEnable = true,
            RtsEnable = true,
            ReadBufferSize = 65536,
            ReadTimeout = 1000,
            WriteTimeout = 5000
        };
        _port.Open();
    }

    public Task DisconnectAsync()
    {
        _isConnected = false;
        _readCts?.Cancel();

        if (_useNativeIO)
        {
            var fd = _fd;
            _fd = -1;
            if (fd >= 0)
                Posix.Close(fd);
        }
        else
        {
            var port = _port;
            _port = null;
            try { if (port?.IsOpen == true) port.Close(); } catch { }
            try { port?.Dispose(); } catch { }
        }

        if (_readThread is not null)
        {
            _readThread.Join(TimeSpan.FromSeconds(2));
            _readThread = null;
        }

        _readCts?.Dispose();
        _readCts = null;

        return Task.CompletedTask;
    }

    public Task WriteAsync(string data, CancellationToken ct = default)
    {
        if (!_isConnected)
        {
            ConnectionLost?.Invoke(new IOException("Serial port is not open"));
            throw new InvalidOperationException("Serial port is not open");
        }

        try
        {
            if (_useNativeIO && _fd >= 0)
            {
                var bytes = Encoding.ASCII.GetBytes(data);
                NativeWrite(bytes);
            }
            else if (_port is { IsOpen: true })
            {
                _port.Write(data);
            }
            else
            {
                throw new InvalidOperationException("Serial port is not open");
            }
        }
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
            throw;
        }
        return Task.CompletedTask;
    }

    public Task WriteRawAsync(byte[] data, CancellationToken ct = default)
    {
        if (!_isConnected)
        {
            ConnectionLost?.Invoke(new IOException("Serial port is not open"));
            throw new InvalidOperationException("Serial port is not open");
        }

        try
        {
            if (_useNativeIO && _fd >= 0)
            {
                NativeWrite(data);
            }
            else if (_port is { IsOpen: true })
            {
                _port.Write(data, 0, data.Length);
            }
            else
            {
                throw new InvalidOperationException("Serial port is not open");
            }
        }
        catch (Exception ex)
        {
            ConnectionLost?.Invoke(ex);
            throw;
        }
        return Task.CompletedTask;
    }

    private unsafe void NativeWrite(byte[] data)
    {
        fixed (byte* ptr = data)
        {
            int written = 0;
            while (written < data.Length)
            {
                var result = Posix.Write(_fd, ptr + written, (nint)(data.Length - written));
                if (result < 0)
                {
                    var errno = Marshal.GetLastWin32Error();
                    throw new IOException($"Serial write failed (errno={errno})");
                }
                written += (int)result;
            }
        }
    }

    private void ReadLoop(CancellationToken ct)
    {
        var buffer = new byte[4096];

        try
        {
            while (!ct.IsCancellationRequested && _isConnected)
            {
                int bytesRead;
                try
                {
                    if (_useNativeIO && _fd >= 0)
                    {
                        bytesRead = NativeRead(buffer);
                    }
                    else if (_port is { IsOpen: true })
                    {
                        bytesRead = _port.Read(buffer, 0, buffer.Length);
                    }
                    else
                    {
                        break;
                    }
                }
                catch (TimeoutException)
                {
                    continue;
                }
                catch (IOException)
                {
                    break;
                }
                catch (InvalidOperationException)
                {
                    break;
                }

                if (bytesRead <= 0)
                {
                    if (_useNativeIO) break; // EOF or error
                    continue;
                }

                var data = Encoding.ASCII.GetString(buffer, 0, bytesRead);
                ProcessIncomingData(data);
            }
        }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
                ConnectionLost?.Invoke(ex);
        }

        if (!ct.IsCancellationRequested && _isConnected)
            ConnectionLost?.Invoke(new IOException("Serial port read loop ended unexpectedly"));
    }

    private unsafe int NativeRead(byte[] buffer)
    {
        fixed (byte* ptr = buffer)
        {
            var result = Posix.Read(_fd, ptr, (nint)buffer.Length);
            if (result < 0)
            {
                var errno = Marshal.GetLastWin32Error();
                if (errno == 11 /* EAGAIN */ || errno == 4 /* EINTR */)
                    return 0;
                throw new IOException($"Serial read failed (errno={errno})");
            }
            return (int)result;
        }
    }

    private void ProcessIncomingData(string data)
    {
        foreach (var ch in data)
        {
            if (ch == '\n')
            {
                var line = _lineBuffer.ToString().TrimEnd('\r');
                _lineBuffer.Clear();
                if (line.Length > 0)
                    LineReceived?.Invoke(line);
            }
            else if (ch == '<')
            {
                if (_lineBuffer.Length > 0)
                {
                    var partial = _lineBuffer.ToString().TrimEnd('\r');
                    _lineBuffer.Clear();
                    if (partial.Length > 0)
                        LineReceived?.Invoke(partial);
                }
                _lineBuffer.Append(ch);
            }
            else if (ch == '>' && _lineBuffer.Length > 0 && _lineBuffer[0] == '<')
            {
                _lineBuffer.Append(ch);
                var line = _lineBuffer.ToString();
                _lineBuffer.Clear();
                LineReceived?.Invoke(line);
            }
            else
            {
                _lineBuffer.Append(ch);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }

    // --- POSIX interop (Linux/macOS) ---
    private static class Posix
    {
        public const int O_RDWR = 0x02;
        public const int O_NOCTTY = 0x100;
        public const int O_NONBLOCK = 0x800;
        public const int F_GETFL = 3;
        public const int F_SETFL = 4;
        public const int TIOCMBIS = 0x5416;
        public const int TIOCM_DTR = 0x002;
        public const int TIOCM_RTS = 0x004;

        [DllImport("libc", EntryPoint = "open", SetLastError = true)]
        public static extern int Open([MarshalAs(UnmanagedType.LPStr)] string path, int flags);

        [DllImport("libc", EntryPoint = "close", SetLastError = true)]
        public static extern int Close(int fd);

        [DllImport("libc", EntryPoint = "read", SetLastError = true)]
        public static extern unsafe nint Read(int fd, byte* buf, nint count);

        [DllImport("libc", EntryPoint = "write", SetLastError = true)]
        public static extern unsafe nint Write(int fd, byte* buf, nint count);

        [DllImport("libc", EntryPoint = "fcntl", SetLastError = true)]
        public static extern int Fcntl(int fd, int cmd, int arg);

        [DllImport("libc", EntryPoint = "ioctl", SetLastError = true)]
        public static extern int Ioctl(int fd, nuint request, ref int value);
    }
}

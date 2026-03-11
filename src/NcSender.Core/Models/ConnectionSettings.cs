namespace NcSender.Core.Models;

public class ConnectionSettings
{
    public string Type { get; set; } = "usb";
    public string UsbPort { get; set; } = "";
    public int BaudRate { get; set; } = 115200;
    public string Ip { get; set; } = "192.168.5.1";
    public int Port { get; set; } = 23;
    public string Protocol { get; set; } = "telnet";
    public int ServerPort { get; set; } = 8090;
}

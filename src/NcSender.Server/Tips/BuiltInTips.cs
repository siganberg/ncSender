using NcSender.Core.Models;

namespace NcSender.Server.Tips;

/// <summary>
/// Tips that ship with the app (ids 1-99) so the dialog has content on a
/// machine that has never been online. Remote tips start at id 100. Core
/// features only; plugin features do not belong here.
/// </summary>
internal static class BuiltInTips
{
    public static readonly IReadOnlyList<TipItem> Items = new List<TipItem>
    {
        // Built-in tips may still carry media: absolute URLs are fetched and
        // cached like remote ones, and the text stands on its own offline.
        new()
        {
            Id = 1,
            Title = "Zero an axis by holding its card",
            Body = "Press and hold the X, Y or Z card in the position display to zero that axis at the current position. The XY card zeroes both at once.\n\nDouble-tap a card to type a value instead of zeroing.",
            Media = new TipMedia
            {
                Type = "video",
                Src = "https://raw.githubusercontent.com/siganberg/ncSender.tips/main/media/zero-axis.mp4",
                Poster = "https://raw.githubusercontent.com/siganberg/ncSender.tips/main/media/zero-axis-poster.jpg",
            },
        },
        new()
        {
            Id = 2,
            Title = "A pulsing Home button means the machine is not homed",
            Body = "When homing is enabled on the controller and the machine has not been homed since power-on, the Home button pulses. Home first: soft limits, parking and tool changes all rely on a known position.",
        },
        new()
        {
            Id = 3,
            Title = "Trace the job outline before cutting",
            Body = "Trace moves the spindle around the bounding box of the loaded job at a safe height. Watch it once and you will know the stock, clamps and dust boot are all clear before the spindle starts.",
            Edition = "pro",
            Media = new TipMedia
            {
                Type = "video",
                Src = "https://raw.githubusercontent.com/siganberg/ncSender.tips/main/media/trace-outline.mp4",
                Poster = "https://raw.githubusercontent.com/siganberg/ncSender.tips/main/media/trace-outline-poster.jpg",
            },
        },
        new()
        {
            Id = 4,
            Title = "Hold a slot to load or unload a tool",
            Body = "In the tool legend, hold a slot button for one second to run a tool change to that tool. If the slot holds the tool already in the spindle, the same hold unloads it instead.\n\nA short tap expands the slot to show the bit assigned to it.",
        },
        new()
        {
            Id = 5,
            Title = "Unlock keeps trying for you",
            Body = "After an alarm, one press of Unlock retries the reset for up to 30 seconds. Release the E-stop or clear the limit switch in the meantime and the dialog closes on its own.",
        },
    };
}

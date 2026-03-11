using System.Globalization;
using NcSender.Core.Models;

namespace NcSender.Server.GcodeAnalysis;

public static class ResumeSequenceGenerator
{
    public static List<string> Generate(GcodeState state, StartFromLineRequest options)
    {
        var commands = new List<string>();

        commands.Add("(Resume sequence for starting from line)");

        // Safety retract Z to machine zero
        commands.Add($"G53 G0 Z{Fmt(options.SafeZHeight)}");

        // Tool change
        if (state.Tool > 0)
            commands.Add($"M6 T{state.Tool}");

        // Units
        commands.Add(state.Units);

        // Plane
        commands.Add(state.Plane);

        // WCS
        commands.Add(state.Wcs);

        // Use G90 absolute for all positioning moves (analyzed positions are always absolute)
        // Restore actual positioning mode after positioning is complete
        commands.Add("G90");

        // Move to XY position
        commands.Add($"G0 X{Fmt(state.PositionX)} Y{Fmt(state.PositionY)}");

        // Spindle
        var spindleActive = state.SpindleState is "M3" or "M4";
        if (spindleActive && state.SpindleSpeed > 0)
        {
            commands.Add($"S{Fmt0(state.SpindleSpeed)}");
            commands.Add(state.SpindleState);

            if (options.SpindleDelaySec > 0)
                commands.Add($"G4 P{options.SpindleDelaySec.ToString("F1", CultureInfo.InvariantCulture)}");
        }

        // Coolant
        if (state.CoolantFlood)
            commands.Add("M8");
        if (state.CoolantMist)
            commands.Add("M7");

        // Aux outputs (only emit M64 for outputs that are ON)
        foreach (var (port, on) in state.AuxOutputs)
        {
            if (on)
                commands.Add($"M64 P{port}");
        }

        // Z movement
        var approachZ = state.PositionZ + options.ApproachHeight;
        commands.Add($"G0 Z{Fmt(approachZ)}");
        commands.Add($"G1 Z{Fmt(state.PositionZ)} F{Fmt0(options.PlungeFeedRate)}");

        // Restore actual positioning mode after all positioning moves
        if (state.PositioningMode != "G90")
            commands.Add(state.PositioningMode);

        // Restore feed rate
        if (state.FeedRate > 0)
            commands.Add($"F{Fmt0(state.FeedRate)}");

        commands.Add("(End resume sequence)");

        return commands;
    }

    private static string Fmt(double value) =>
        value.ToString("F3", CultureInfo.InvariantCulture);

    private static string Fmt0(double value) =>
        value.ToString("F0", CultureInfo.InvariantCulture);
}

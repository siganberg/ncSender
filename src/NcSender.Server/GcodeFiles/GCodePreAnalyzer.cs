namespace NcSender.Server.GcodeFiles;

/// <summary>
/// G-code pre-analyzer that produces a static estimate of total run time.
/// Uses a velocity continuity model with entry/exit velocities between moves
/// to approximate real CNC controller behavior with look-ahead planning.
/// Ported from V1 gcode-preanalyzer.js.
/// </summary>
public class GCodePreAnalyzer
{
    private const double MmPerMinToMmPerSec = 1.0 / 60.0;

    private readonly double _rapidMmPerMin;
    private readonly double _defaultFeedMmPerMin;
    private readonly (double x, double y, double z)? _vmaxMmPerMin;
    private readonly (double x, double y, double z)? _accelMmPerSec2;
    private readonly double _junctionDeviationMm;

    public GCodePreAnalyzer(
        double rapidMmPerMin = 6000,
        double defaultFeedMmPerMin = 1000,
        (double x, double y, double z)? vmaxMmPerMin = null,
        (double x, double y, double z)? accelMmPerSec2 = null,
        double junctionDeviationMm = 0.01)
    {
        _rapidMmPerMin = rapidMmPerMin;
        _defaultFeedMmPerMin = defaultFeedMmPerMin;
        _vmaxMmPerMin = vmaxMmPerMin;
        _accelMmPerSec2 = accelMmPerSec2;
        _junctionDeviationMm = junctionDeviationMm;
    }

    public double Analyze(string content)
    {
        if (string.IsNullOrEmpty(content))
            return 0;

        var lines = content.Split('\n');
        var lineCount = lines.Length;

        double lastFeed = _defaultFeedMmPerMin;
        bool modalAbs = true;
        bool unitsMm = true;
        int? modalMotion = null;
        double lastX = 0, lastY = 0, lastZ = 0;

        var perLineSec = new double[lineCount];
        var perLineDist = new double[lineCount];
        var perLineVtarget = new double[lineCount];
        var perLineAccel = new double[lineCount];
        var perLineUnitX = new double[lineCount];
        var perLineUnitY = new double[lineCount];
        var perLineUnitZ = new double[lineCount];

        // Pass 1: Parse all lines, compute distances and per-line timing
        var wordBuf = new (char letter, double value)[16];
        for (int i = 0; i < lineCount; i++)
        {
            var raw = lines[i].AsSpan().Trim();
            if (raw.IsEmpty) continue;

            // Parse words (letter-value pairs), stripping parenthesized comments
            Span<(char letter, double value)> wordSpan = wordBuf;
            int wordCount = ParseWords(raw, ref wordSpan);

            int? lineMotion = null;
            double feedWord = double.NaN;
            double xWord = double.NaN, yWord = double.NaN, zWord = double.NaN;
            double iWord = double.NaN, jWord = double.NaN, rWord = double.NaN;

            for (int w = 0; w < wordCount; w++)
            {
                var (letter, value) = wordSpan[w];
                switch (letter)
                {
                    case 'G':
                        var gVal = (int)Math.Round(value);
                        switch (gVal)
                        {
                            case 90: modalAbs = true; break;
                            case 91: modalAbs = false; break;
                            case 20: unitsMm = false; break;
                            case 21: unitsMm = true; break;
                        }
                        if (gVal is >= 0 and <= 3)
                        {
                            modalMotion = gVal;
                            lineMotion = gVal;
                        }
                        break;
                    case 'F': feedWord = value; break;
                    case 'X': xWord = value; break;
                    case 'Y': yWord = value; break;
                    case 'Z': zWord = value; break;
                    case 'I': iWord = value; break;
                    case 'J': jWord = value; break;
                    case 'R': rWord = value; break;
                }
            }

            if (!double.IsNaN(feedWord) && feedWord > 0)
                lastFeed = unitsMm ? feedWord : feedWord * 25.4;

            var motionCode = lineMotion ?? modalMotion;
            bool hasLinear = !double.IsNaN(xWord) || !double.IsNaN(yWord) || !double.IsNaN(zWord);
            bool hasArc = !double.IsNaN(iWord) || !double.IsNaN(jWord) || !double.IsNaN(rWord);
            bool isMotionLine = motionCode.HasValue && (lineMotion.HasValue || hasLinear || hasArc);
            if (!isMotionLine) continue;

            bool isG0 = motionCode == 0;
            bool isG2 = motionCode == 2;
            bool isG3 = motionCode == 3;

            // Calculate target position
            double targetX = lastX, targetY = lastY, targetZ = lastZ;
            if (!double.IsNaN(xWord)) targetX = modalAbs ? xWord : lastX + xWord;
            if (!double.IsNaN(yWord)) targetY = modalAbs ? yWord : lastY + yWord;
            if (!double.IsNaN(zWord)) targetZ = modalAbs ? zWord : lastZ + zWord;

            double scale = unitsMm ? 1 : 25.4;
            double dx = (targetX - lastX) * scale;
            double dy = (targetY - lastY) * scale;
            double dz = (targetZ - lastZ) * scale;
            double dist = Math.Sqrt(dx * dx + dy * dy + dz * dz);

            double ux = 0, uy = 0, uz = 0;

            // Arc length estimation (XY plane)
            if ((isG2 || isG3) && (!double.IsNaN(iWord) || !double.IsNaN(jWord) || !double.IsNaN(rWord)))
            {
                double startX = lastX * scale, startY = lastY * scale;
                double endX = targetX * scale, endY = targetY * scale;

                if (!double.IsNaN(iWord) || !double.IsNaN(jWord))
                {
                    double cx = startX + (double.IsNaN(iWord) ? 0 : iWord) * scale;
                    double cy = startY + (double.IsNaN(jWord) ? 0 : jWord) * scale;
                    double rs = Math.Sqrt((startX - cx) * (startX - cx) + (startY - cy) * (startY - cy));
                    double re = Math.Sqrt((endX - cx) * (endX - cx) + (endY - cy) * (endY - cy));
                    double r = (rs + re) / 2;
                    double a0 = Math.Atan2(startY - cy, startX - cx);
                    double a1 = Math.Atan2(endY - cy, endX - cx);
                    double dtheta = a1 - a0;
                    if (isG2) { if (dtheta >= 0) dtheta -= 2 * Math.PI; }
                    else { if (dtheta <= 0) dtheta += 2 * Math.PI; }
                    double arcLen = Math.Abs(r * dtheta);

                    if (arcLen > 0)
                    {
                        dist = arcLen;
                        double tx = isG2 ? Math.Sin(a0) : -Math.Sin(a0);
                        double ty = isG2 ? -Math.Cos(a0) : Math.Cos(a0);
                        double norm = Math.Max(1e-9, Math.Sqrt(tx * tx + ty * ty));
                        ux = Math.Abs(tx / norm);
                        uy = Math.Abs(ty / norm);
                    }
                }
                else if (!double.IsNaN(rWord))
                {
                    double chord = Math.Sqrt((endX - startX) * (endX - startX) + (endY - startY) * (endY - startY));
                    double R = Math.Abs(rWord * scale);
                    if (R > 0 && chord > 0)
                    {
                        double dtheta = 2 * Math.Asin(Math.Min(1, chord / (2 * R)));
                        if (rWord < 0) dtheta = 2 * Math.PI - dtheta;
                        double arcLen = R * dtheta;
                        if (arcLen > 0)
                        {
                            dist = arcLen;
                            double ang = Math.Atan2(endY - startY, endX - startX);
                            ux = Math.Abs(Math.Cos(ang));
                            uy = Math.Abs(Math.Sin(ang));
                        }
                    }
                }
            }

            double sec = 0;
            if (dist > 0)
            {
                // Recalculate unit vector for linear moves
                if (ux == 0 && uy == 0 && uz == 0)
                {
                    ux = Math.Abs(dx) / dist;
                    uy = Math.Abs(dy) / dist;
                    uz = Math.Abs(dz) / dist;
                }

                // Store unit vector
                perLineUnitX[i] = dx == 0 ? 0 : dx / dist;
                perLineUnitY[i] = dy == 0 ? 0 : dy / dist;
                perLineUnitZ[i] = dz == 0 ? 0 : dz / dist;

                // Effective max vector speed from per-axis limits (mm/s)
                double vEffMax;
                if (_vmaxMmPerMin.HasValue)
                {
                    var vmax = _vmaxMmPerMin.Value;
                    vEffMax = double.PositiveInfinity;
                    double vx = vmax.x * MmPerMinToMmPerSec;
                    double vy = vmax.y * MmPerMinToMmPerSec;
                    double vz = vmax.z * MmPerMinToMmPerSec;
                    if (ux > 0 && double.IsFinite(vx)) vEffMax = Math.Min(vEffMax, vx / ux);
                    if (uy > 0 && double.IsFinite(vy)) vEffMax = Math.Min(vEffMax, vy / uy);
                    if (uz > 0 && double.IsFinite(vz)) vEffMax = Math.Min(vEffMax, vz / uz);
                }
                else
                {
                    vEffMax = _rapidMmPerMin * MmPerMinToMmPerSec;
                }

                // Target speed for this move
                double feedMmps = isG0 ? double.PositiveInfinity : lastFeed * MmPerMinToMmPerSec;
                double vTarget = Math.Max(0, Math.Min(vEffMax, feedMmps));

                // Effective accel (mm/s²) from per-axis limits
                double? aEff = null;
                if (_accelMmPerSec2.HasValue)
                {
                    var a = _accelMmPerSec2.Value;
                    double aInf = double.PositiveInfinity;
                    if (ux > 0 && double.IsFinite(a.x)) aInf = Math.Min(aInf, a.x / ux);
                    if (uy > 0 && double.IsFinite(a.y)) aInf = Math.Min(aInf, a.y / uy);
                    if (uz > 0 && double.IsFinite(a.z)) aInf = Math.Min(aInf, a.z / uz);
                    if (double.IsFinite(aInf) && aInf > 0) aEff = aInf;
                }

                if (aEff.HasValue && double.IsFinite(vTarget) && vTarget > 0)
                {
                    double a = aEff.Value;
                    double ta = vTarget / a;
                    double da = 0.5 * a * ta * ta;
                    if (2 * da >= dist)
                    {
                        double vPeak = Math.Sqrt(dist * a);
                        sec = 2 * (vPeak / a);
                    }
                    else
                    {
                        double cruise = dist - 2 * da;
                        sec = 2 * ta + cruise / vTarget;
                    }
                }
                else
                {
                    double v = double.IsFinite(vTarget) && vTarget > 0
                        ? vTarget
                        : _defaultFeedMmPerMin * MmPerMinToMmPerSec;
                    sec = dist / v;
                }

                perLineVtarget[i] = vTarget;
                perLineAccel[i] = aEff ?? 0;
            }

            perLineSec[i] = sec;
            perLineDist[i] = dist;
            lastX = targetX;
            lastY = targetY;
            lastZ = targetZ;
        }

        // Pass 2: Velocity continuity - calculate junction velocities
        double jd = _junctionDeviationMm;
        var junctionV = new double[lineCount + 1];

        // Build list of motion line indices
        var motionIndices = new List<int>();
        for (int i = 0; i < lineCount; i++)
        {
            if (perLineDist[i] > 0 && perLineVtarget[i] > 0)
                motionIndices.Add(i);
        }

        for (int mi = 0; mi < motionIndices.Count; mi++)
        {
            int idx = motionIndices[mi];
            if (mi + 1 >= motionIndices.Count)
            {
                junctionV[idx + 1] = 0;
                continue;
            }
            int nextIdx = motionIndices[mi + 1];

            double v1x = perLineUnitX[idx], v1y = perLineUnitY[idx], v1z = perLineUnitZ[idx];
            double v2x = perLineUnitX[nextIdx], v2y = perLineUnitY[nextIdx], v2z = perLineUnitZ[nextIdx];

            bool v1Zero = v1x == 0 && v1y == 0 && v1z == 0;
            bool v2Zero = v2x == 0 && v2y == 0 && v2z == 0;
            if (v1Zero || v2Zero)
            {
                junctionV[idx + 1] = Math.Min(perLineVtarget[idx], perLineVtarget[nextIdx]) * 0.5;
                continue;
            }

            double dot = v1x * v2x + v1y * v2y + v1z * v2z;
            dot = Math.Clamp(dot, -1, 1);
            double theta = Math.Acos(dot);

            if (!double.IsFinite(theta) || theta < 0.2)
            {
                junctionV[idx + 1] = Math.Min(perLineVtarget[idx], perLineVtarget[nextIdx]);
                continue;
            }

            double aEff = Math.Min(
                perLineAccel[idx] > 0 ? perLineAccel[idx] : 500,
                perLineAccel[nextIdx] > 0 ? perLineAccel[nextIdx] : 500);

            double sinHalf = Math.Sin(theta / 2);
            double effectiveJd = jd * 4; // Modern controllers are more aggressive
            double vj = sinHalf < 0.95
                ? Math.Sqrt(Math.Max(0, aEff * effectiveJd * sinHalf / Math.Max(0.05, 1 - sinHalf)))
                : Math.Min(perLineVtarget[idx], perLineVtarget[nextIdx]) * 0.1;

            double vmaxCorner = Math.Min(perLineVtarget[idx], perLineVtarget[nextIdx]);
            junctionV[idx + 1] = Math.Min(vj, vmaxCorner);
        }

        // Pass 3: Backward pass - ensure deceleration is feasible
        for (int i = lineCount - 1; i >= 0; i--)
        {
            double dist = perLineDist[i];
            double aEff = perLineAccel[i] > 0 ? perLineAccel[i] : 500;
            double exitV = junctionV[i + 1];

            if (dist > 0 && aEff > 0)
            {
                double maxEntryV = Math.Sqrt(exitV * exitV + 2 * aEff * dist);
                double current = double.IsFinite(junctionV[i]) ? junctionV[i] : double.PositiveInfinity;
                junctionV[i] = Math.Min(current, Math.Min(maxEntryV, perLineVtarget[i]));
            }
        }

        // Pass 4: Forward pass - actual timing with velocity continuity
        double totalSec = 0;
        double actualExitV = 0;
        for (int i = 0; i < lineCount; i++)
        {
            double dist = perLineDist[i];
            if (dist <= 0) continue;

            double aEff = perLineAccel[i] > 0 ? perLineAccel[i] : 500;
            double vTarget = perLineVtarget[i];
            double vEntry = Math.Min(Math.Max(actualExitV, junctionV[i]), vTarget);
            double vExit = junctionV[i + 1];

            if (vTarget <= 0 || aEff <= 0)
            {
                double v = vTarget > 0 ? vTarget : _defaultFeedMmPerMin * MmPerMinToMmPerSec;
                perLineSec[i] = dist / v;
                actualExitV = v;
            }
            else
            {
                perLineSec[i] = CalcTrapezoidTime(dist, vEntry, vExit, vTarget, aEff);
                actualExitV = vExit;
            }

            totalSec += perLineSec[i];
        }

        return totalSec;
    }

    private static double CalcTrapezoidTime(double dist, double vEntry, double vExit, double vCruise, double accel)
    {
        if (dist <= 0) return 0;
        if (accel <= 0) return dist / Math.Max(vCruise, 0.001);

        double dAccel = (vCruise * vCruise - vEntry * vEntry) / (2 * accel);
        double dDecel = (vCruise * vCruise - vExit * vExit) / (2 * accel);

        if (dAccel + dDecel <= dist)
        {
            double tAccel = (vCruise - vEntry) / accel;
            double tDecel = (vCruise - vExit) / accel;
            double dCruise = dist - dAccel - dDecel;
            double tCruise = dCruise / vCruise;
            return Math.Max(0, tAccel) + Math.Max(0, tCruise) + Math.Max(0, tDecel);
        }
        else
        {
            double vPeakSq = (2 * accel * dist + vEntry * vEntry + vExit * vExit) / 2;
            double vPeak = Math.Sqrt(Math.Max(0, vPeakSq));
            double tAccel = (vPeak - vEntry) / accel;
            double tDecel = (vPeak - vExit) / accel;
            return Math.Max(0, tAccel) + Math.Max(0, tDecel);
        }
    }

    private static int ParseWords(ReadOnlySpan<char> line, ref Span<(char letter, double value)> words)
    {
        int count = 0;
        bool inComment = false;

        for (int i = 0; i < line.Length && count < words.Length; i++)
        {
            char c = line[i];
            if (c == '(') { inComment = true; continue; }
            if (c == ')') { inComment = false; continue; }
            if (inComment) continue;
            if (c == ';') break; // semicolon comment

            if (c is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z'))
            {
                char letter = char.ToUpperInvariant(c);
                // Try to parse the number following the letter
                int start = i + 1;
                int end = start;
                while (end < line.Length && (line[end] is (>= '0' and <= '9') or '.' or '-' or '+'))
                    end++;

                if (end > start && double.TryParse(line[start..end], System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out double val) && double.IsFinite(val))
                {
                    words[count++] = (letter, val);
                    i = end - 1;
                }
            }
        }

        return count;
    }
}

G21 (Metric)
G90 (Absolute positioning)
G0 Z5
T1 M6 (Tool change to tool 1)
M8 (Coolant on - should be skipped)
G0 X10 Y10 (First XY movement - M8 should be injected after this)
G1 Z-2 F500
G1 X20 Y20 F1000
G1 X30 Y20
G1 X30 Y10
G0 Z5
M9 (Coolant off)

T2 M6 (Tool change to tool 2)
M8 (Coolant on - should be skipped)
G0 X50 Y50 (First XY movement - M8 should be injected after this)
G1 Z-2 F500
G1 X60 Y60 F1000
G0 Z5
M9 (Coolant off)

M30 (Program end)

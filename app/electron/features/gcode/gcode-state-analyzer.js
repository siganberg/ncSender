import { parseM6Command } from '../../utils/gcode-patterns.js';

export class GCodeStateAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      tool: null,
      motionMode: 'G0',
      positioningMode: 'G90',
      units: 'G21',
      plane: 'G17',
      feedRate: 0,
      spindleState: 'M5',
      spindleSpeed: 0,
      coolantFlood: false,
      coolantMist: false,
      wcs: 'G54',
      position: { x: 0, y: 0, z: 0 },
      auxOutputs: {} // Track M64/M65 outputs: { P0: true, P1: false, ... }
    };
    this.analyzedUpToLine = 0;
  }

  parseWords(line) {
    const tokens = [];
    const stripped = line.replace(/\((?:[^)]*)\)/g, '');
    const re = /([a-zA-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
    let match;
    while ((match = re.exec(stripped)) !== null) {
      const letter = match[1].toUpperCase();
      const value = Number(match[2]);
      if (Number.isFinite(value)) {
        tokens.push({ letter, value });
      }
    }
    const words = {};
    for (const { letter, value } of tokens) {
      words[letter] = value;
    }
    return { tokens, words };
  }

  analyzeToLine(gcodeContent, targetLine) {
    if (typeof gcodeContent !== 'string') {
      return { state: { ...this.state }, targetLine, analyzedUpToLine: 0 };
    }

    this.reset();
    const lines = gcodeContent.split('\n');
    const maxLine = Math.min(targetLine, lines.length);

    for (let i = 0; i < maxLine; i++) {
      const lineNumber = i + 1;
      const raw = lines[i];
      const clean = raw.trim();

      if (!clean || clean.startsWith(';')) continue;

      this.processLine(clean, lineNumber);
      this.analyzedUpToLine = lineNumber;
    }

    return {
      state: { ...this.state },
      targetLine,
      analyzedUpToLine: this.analyzedUpToLine
    };
  }

  processLine(line, lineNumber) {
    const { tokens, words } = this.parseWords(line);

    for (const { letter, value } of tokens) {
      if (!Number.isFinite(value)) continue;

      if (letter === 'G') {
        const gVal = Math.round(value);
        this.processGCode(gVal);
      } else if (letter === 'M') {
        const mVal = Math.round(value);
        this.processMCode(mVal, line, words);
      } else if (letter === 'T') {
        const toolNum = Math.round(value);
        if (toolNum >= 0) {
          this.state.tool = toolNum;
        }
      } else if (letter === 'S') {
        if (value >= 0) {
          this.state.spindleSpeed = value;
        }
      } else if (letter === 'F') {
        if (value > 0) {
          this.state.feedRate = value;
        }
      }
    }

    this.updatePosition(words);
  }

  processGCode(gVal) {
    if (gVal >= 0 && gVal <= 3) {
      this.state.motionMode = `G${gVal}`;
    } else if (gVal === 90) {
      this.state.positioningMode = 'G90';
    } else if (gVal === 91) {
      this.state.positioningMode = 'G91';
    } else if (gVal === 20) {
      this.state.units = 'G20';
    } else if (gVal === 21) {
      this.state.units = 'G21';
    } else if (gVal === 17) {
      this.state.plane = 'G17';
    } else if (gVal === 18) {
      this.state.plane = 'G18';
    } else if (gVal === 19) {
      this.state.plane = 'G19';
    } else if (gVal >= 54 && gVal <= 59) {
      this.state.wcs = `G${gVal}`;
    }
  }

  processMCode(mVal, line, words) {
    if (mVal === 3) {
      this.state.spindleState = 'M3';
    } else if (mVal === 4) {
      this.state.spindleState = 'M4';
    } else if (mVal === 5) {
      this.state.spindleState = 'M5';
    } else if (mVal === 6) {
      const parsed = parseM6Command(line);
      if (parsed && parsed.matched && parsed.toolNumber !== null) {
        this.state.tool = parsed.toolNumber;
      }
      // Reset position and spindle on tool change - old values are invalid for new tool
      this.state.position.z = null;
      this.state.spindleState = 'M5';  // Spindle should be off during tool change
      this.state.spindleSpeed = 0;
    } else if (mVal === 7) {
      this.state.coolantMist = true;
    } else if (mVal === 8) {
      this.state.coolantFlood = true;
    } else if (mVal === 9) {
      this.state.coolantFlood = false;
      this.state.coolantMist = false;
    } else if (mVal === 64) {
      // M64 P# - Turn on auxiliary output
      if (Number.isFinite(words.P)) {
        const outputNum = Math.round(words.P);
        this.state.auxOutputs[`P${outputNum}`] = true;
      }
    } else if (mVal === 65) {
      // M65 P# - Turn off auxiliary output
      if (Number.isFinite(words.P)) {
        const outputNum = Math.round(words.P);
        this.state.auxOutputs[`P${outputNum}`] = false;
      }
    }
  }

  updatePosition(words) {
    const isAbsolute = this.state.positioningMode === 'G90';

    if (Number.isFinite(words.X)) {
      this.state.position.x = isAbsolute ? words.X : this.state.position.x + words.X;
    }
    if (Number.isFinite(words.Y)) {
      this.state.position.y = isAbsolute ? words.Y : this.state.position.y + words.Y;
    }
    if (Number.isFinite(words.Z)) {
      this.state.position.z = isAbsolute ? words.Z : this.state.position.z + words.Z;
    }
  }
}

export function generateResumeSequence(targetState, options = {}) {
  const {
    spindleDelaySec = 0,
    approachHeight = 10,
    plungeFeedRate = 500,
    isStartingAtToolChange = false,
    expectedTool = null,
    currentTool = null
  } = options;

  const commands = [];

  commands.push(`; Resume sequence for starting from line`);

  // Retract to machine Z0 first (safest position)
  commands.push('G53 G0 Z0');

  // If tool mismatch, insert M6 to change to the expected tool
  const needsToolChange = expectedTool !== null && currentTool !== null && expectedTool !== currentTool;
  if (needsToolChange) {
    commands.push(`; Tool change: T${currentTool} -> T${expectedTool}`);
    commands.push(`M6 T${expectedTool}`);
  }

  // If starting at a tool change, use minimal preamble - just safe Z retract (and optional tool change above)
  // The M6 and subsequent lines will handle all setup (spindle, coolant, positioning)
  if (isStartingAtToolChange) {
    commands.push('; Starting at tool change - minimal preamble');
    commands.push('; End resume sequence');
    return commands;
  }

  const pos = targetState.position;

  // Set modal states
  if (targetState.units) {
    commands.push(targetState.units);
  }

  if (targetState.positioningMode) {
    commands.push(targetState.positioningMode);
  }

  if (targetState.plane) {
    commands.push(targetState.plane);
  }

  if (targetState.wcs) {
    commands.push(targetState.wcs);
  }

  // Check if we have valid position context (Z is null after tool change)
  const hasValidPositionContext = pos.z !== null && Number.isFinite(pos.z);

  // Rapid to XY position only if we have valid context (not after tool change)
  if (hasValidPositionContext && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    commands.push(`G0 X${pos.x} Y${pos.y}`);
  }

  const spindleActive = targetState.spindleState === 'M3' || targetState.spindleState === 'M4';
  if (spindleActive && targetState.spindleSpeed > 0) {
    commands.push(`S${targetState.spindleSpeed}`);
    commands.push(targetState.spindleState);

    if (spindleDelaySec > 0) {
      commands.push(`G4 P${spindleDelaySec}`);
    }
  }

  if (targetState.coolantFlood) {
    commands.push('M8');
  }
  if (targetState.coolantMist) {
    commands.push('M7');
  }

  // Turn on auxiliary outputs (M64 P#)
  if (targetState.auxOutputs) {
    for (const [key, isOn] of Object.entries(targetState.auxOutputs)) {
      if (isOn && key.startsWith('P')) {
        commands.push(`M64 ${key}`);
      }
    }
  }

  // Only do Z positioning if we have valid position context (not after tool change)
  if (hasValidPositionContext) {
    const approachZ = pos.z + approachHeight;
    commands.push(`G0 Z${approachZ}`);
    commands.push(`G1 Z${pos.z} F${plungeFeedRate}`);
  } else {
    // No XY/Z positioning - tool change detected, let the G-code handle positioning
    commands.push('; XY/Z positioning skipped - starting near tool change');
  }

  if (targetState.feedRate > 0) {
    commands.push(`F${targetState.feedRate}`);
  }

  commands.push('; End resume sequence');

  return commands;
}

export function compareToolState(expectedTool, currentTool) {
  if (expectedTool === null || expectedTool === undefined) {
    return { mismatch: false, message: 'No tool specified in program' };
  }

  if (currentTool === null || currentTool === undefined) {
    return { mismatch: true, message: `Program expects T${expectedTool}, current tool unknown` };
  }

  if (expectedTool !== currentTool) {
    return {
      mismatch: true,
      message: `Tool mismatch: program expects T${expectedTool}, machine has T${currentTool}`,
      expectedTool,
      currentTool
    };
  }

  return { mismatch: false, message: 'Tool matches' };
}

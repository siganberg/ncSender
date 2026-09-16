/**
 * G-code Transformation Utilities
 * Provides rotate, mirror, and offset transformations for G-code files.
 */

export interface TransformBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

export interface TransformOptions {
  onProgress?: (percent: number) => void;
}

/**
 * Analyze G-code to calculate bounds and center point for transformations.
 */
export function analyzeGCodeBounds(gcodeContent: string): TransformBounds {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  };

  let currentX = 0, currentY = 0;
  let isAbsolute = true;
  let isArcAbsolute = false;
  let motionMode = 0;

  const lines = gcodeContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().toUpperCase();

    if (trimmed.startsWith('(') || trimmed.startsWith(';') || trimmed.startsWith('%') || trimmed === '') {
      continue;
    }

    if (trimmed.includes('G90.1')) isArcAbsolute = true;
    if (trimmed.includes('G91.1')) isArcAbsolute = false;
    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;

    if (trimmed.includes('G53')) continue;

    // Update modal motion mode
    if (/\bG0*0\b/.test(trimmed)) motionMode = 0;
    if (/\bG0*1\b/.test(trimmed)) motionMode = 1;
    if (/\bG0*2\b/.test(trimmed)) motionMode = 2;
    if (/\bG0*3\b/.test(trimmed)) motionMode = 3;

    const xMatch = trimmed.match(/X([+-]?\d*\.?\d+)/);
    const yMatch = trimmed.match(/Y([+-]?\d*\.?\d+)/);
    const iMatch = trimmed.match(/I([+-]?\d*\.?\d+)/);
    const jMatch = trimmed.match(/J([+-]?\d*\.?\d+)/);
    // R-format arcs: G2/G3 X.. Y.. R<radius>. Sign of R selects short (+)
    // vs long (-) arc per RS274/NGC.
    const rMatch = trimmed.match(/\bR([+-]?\d*\.?\d+)/);

    const startX = currentX;
    const startY = currentY;

    let endX = currentX;
    let endY = currentY;

    if (xMatch) {
      const val = parseFloat(xMatch[1]);
      endX = isAbsolute ? val : currentX + val;
    }
    if (yMatch) {
      const val = parseFloat(yMatch[1]);
      endY = isAbsolute ? val : currentY + val;
    }

    // Handle arcs
    const isArc = (motionMode === 2 || motionMode === 3) && (iMatch || jMatch || rMatch);

    if (isArc) {
      let centerX: number, centerY: number, radius: number;
      if (!iMatch && !jMatch && rMatch) {
        const rSigned = parseFloat(rMatch[1]);
        radius = Math.abs(rSigned);
        const dx = endX - startX;
        const dy = endY - startY;
        const chord = Math.sqrt(dx * dx + dy * dy);
        if (chord > 1e-9 && radius >= chord / 2 - 1e-6) {
          const mx = (startX + endX) / 2;
          const my = (startY + endY) / 2;
          const clampedH = Math.max(0, radius * radius - (chord / 2) * (chord / 2));
          const h = Math.sqrt(clampedH);
          const px = -dy / chord;
          const py = dx / chord;
          const isG2 = motionMode === 2;
          const isLong = rSigned < 0;
          const xor = isG2 !== isLong;
          const sign = xor ? -1 : 1;
          centerX = mx + sign * h * px;
          centerY = my + sign * h * py;
        } else {
          centerX = (startX + endX) / 2;
          centerY = (startY + endY) / 2;
          radius = Math.max(radius, chord / 2);
        }
      } else {
        const i = iMatch ? parseFloat(iMatch[1]) : 0;
        const j = jMatch ? parseFloat(jMatch[1]) : 0;
        if (isArcAbsolute) {
          centerX = i;
          centerY = j;
        } else {
          centerX = startX + i;
          centerY = startY + j;
        }
        radius = Math.sqrt(Math.pow(startX - centerX, 2) + Math.pow(startY - centerY, 2));
      }

      const startAngle = Math.atan2(startY - centerY, startX - centerX);
      const endAngle = Math.atan2(endY - centerY, endX - centerX);
      const isG2 = motionMode === 2;

      const arcBounds = calculateArcBounds(centerX, centerY, radius, startAngle, endAngle, isG2);

      bounds.minX = Math.min(bounds.minX, arcBounds.minX);
      bounds.minY = Math.min(bounds.minY, arcBounds.minY);
      bounds.maxX = Math.max(bounds.maxX, arcBounds.maxX);
      bounds.maxY = Math.max(bounds.maxY, arcBounds.maxY);
    }

    currentX = endX;
    currentY = endY;

    if (xMatch || yMatch) {
      bounds.minX = Math.min(bounds.minX, currentX);
      bounds.minY = Math.min(bounds.minY, currentY);
      bounds.maxX = Math.max(bounds.maxX, currentX);
      bounds.maxY = Math.max(bounds.maxY, currentY);
    }
  }

  // Handle empty/invalid bounds
  if (bounds.minX === Infinity) bounds.minX = 0;
  if (bounds.minY === Infinity) bounds.minY = 0;
  if (bounds.maxX === -Infinity) bounds.maxX = 0;
  if (bounds.maxY === -Infinity) bounds.maxY = 0;

  return {
    ...bounds,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2
  };
}

function calculateArcBounds(
  centerX: number, centerY: number, radius: number,
  startAngle: number, endAngle: number, isClockwise: boolean
) {
  const normalize = (angle: number) => {
    while (angle < 0) angle += 2 * Math.PI;
    while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
    return angle;
  };

  const start = normalize(startAngle);
  const end = normalize(endAngle);

  const isAngleInArc = (angle: number) => {
    const a = normalize(angle);
    if (isClockwise) {
      if (start >= end) {
        return a <= start && a >= end;
      } else {
        return a <= start || a >= end;
      }
    } else {
      if (start <= end) {
        return a >= start && a <= end;
      } else {
        return a >= start || a <= end;
      }
    }
  };

  const startX = centerX + radius * Math.cos(startAngle);
  const startY = centerY + radius * Math.sin(startAngle);
  const endX = centerX + radius * Math.cos(endAngle);
  const endY = centerY + radius * Math.sin(endAngle);

  let minX = Math.min(startX, endX);
  let maxX = Math.max(startX, endX);
  let minY = Math.min(startY, endY);
  let maxY = Math.max(startY, endY);

  if (isAngleInArc(0)) maxX = centerX + radius;
  if (isAngleInArc(Math.PI / 2)) maxY = centerY + radius;
  if (isAngleInArc(Math.PI)) minX = centerX - radius;
  if (isAngleInArc(3 * Math.PI / 2)) minY = centerY - radius;

  return { minX, maxX, minY, maxY };
}

/**
 * Check if a line is a comment or should be skipped for transformation.
 */
function shouldSkipLine(line: string): boolean {
  const trimmed = line.trim().toUpperCase();
  return (
    trimmed === '' ||
    trimmed.startsWith('(') ||
    trimmed.startsWith(';') ||
    trimmed.startsWith('%') ||
    trimmed.includes('G53')
  );
}

/**
 * Parse a coordinate value from a G-code line.
 */
function parseCoord(line: string, coord: string): number | null {
  const regex = new RegExp(`${coord}([+-]?\\d*\\.?\\d+)`, 'i');
  const match = line.match(regex);
  return match ? parseFloat(match[1]) : null;
}

/**
 * How many decimals transformed lines are written with.
 *
 * Fixed at three, this quantised an inch program to 0.001" (0.025mm) a word —
 * and because an arc's endpoint and its centre offsets are rounded separately,
 * it moved them relative to each other, which is what an arc radius check on
 * the controller rejects. So the output follows whatever the file itself uses.
 */
let outputDecimals = 3;

function detectDecimals(gcodeContent: string): number {
  let most = 3;
  const pattern = /[XYZIJKR]-?\d*\.(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(gcodeContent)) !== null) {
    if (match[1].length > most) most = match[1].length;
    if (most >= 6) return 6;
  }
  return most;
}

function formatValue(value: number): string {
  return value.toFixed(outputDecimals);
}

/**
 * Replace a coordinate value in a G-code line.
 */
function replaceCoord(line: string, coord: string, value: number): string {
  const regex = new RegExp(`(${coord})([+-]?\\d*\\.?\\d+)`, 'gi');
  return line.replace(regex, `$1${formatValue(value)}`);
}

/**
 * Remove a coordinate from a G-code line.
 */
function removeCoord(line: string, coord: string): string {
  const regex = new RegExp(`\\s*${coord}[+-]?\\d*\\.?\\d+`, 'gi');
  return line.replace(regex, '');
}

/**
 * Add a coordinate value to a G-code line.
 * Maintains proper G-code coordinate order: G-code X Y Z I J K R F
 */
function addCoord(line: string, coord: string, value: number): string {
  // For arc parameters (I, J, K), insert after Y (or X if no Y), before F
  if (coord === 'I' || coord === 'J' || coord === 'K') {
    if (coord === 'J' || coord === 'K') {
      const prior = coord === 'K'
        ? line.match(/[JI][+-]?\d*\.?\d+/i)
        : line.match(/I[+-]?\d*\.?\d+/i);
      if (prior && prior.index !== undefined) {
        const insertPos = prior.index + prior[0].length;
        return line.slice(0, insertPos) + ` ${coord}${formatValue(value)}` + line.slice(insertPos);
      }
    }
    if (coord === 'J') {
      const iMatch = line.match(/I[+-]?\d*\.?\d+/i);
      if (iMatch && iMatch.index !== undefined) {
        const insertPos = iMatch.index + iMatch[0].length;
        return line.slice(0, insertPos) + ` ${coord}${formatValue(value)}` + line.slice(insertPos);
      }
    }
    // Insert after Y coordinate (or X if no Y)
    const yMatch = line.match(/Y[+-]?\d*\.?\d+/i);
    if (yMatch && yMatch.index !== undefined) {
      const insertPos = yMatch.index + yMatch[0].length;
      return line.slice(0, insertPos) + ` ${coord}${formatValue(value)}` + line.slice(insertPos);
    }
    const xMatch = line.match(/X[+-]?\d*\.?\d+/i);
    if (xMatch && xMatch.index !== undefined) {
      const insertPos = xMatch.index + xMatch[0].length;
      return line.slice(0, insertPos) + ` ${coord}${formatValue(value)}` + line.slice(insertPos);
    }
  }

  // For X coordinate: insert after G-code command, before Y/Z/I/J/F
  if (coord === 'X') {
    // Look for Y first and insert before it
    const yMatch = line.match(/Y[+-]?\d*\.?\d+/i);
    if (yMatch && yMatch.index !== undefined) {
      return line.slice(0, yMatch.index) + `${coord}${formatValue(value)} ` + line.slice(yMatch.index);
    }
    // Look for I (arc param) and insert before it
    const iMatch = line.match(/I[+-]?\d*\.?\d+/i);
    if (iMatch && iMatch.index !== undefined) {
      return line.slice(0, iMatch.index) + `${coord}${formatValue(value)} ` + line.slice(iMatch.index);
    }
    // Look for F (feed rate) and insert before it
    const fMatch = line.match(/F[+-]?\d*\.?\d+/i);
    if (fMatch && fMatch.index !== undefined) {
      return line.slice(0, fMatch.index) + `${coord}${formatValue(value)} ` + line.slice(fMatch.index);
    }
  }

  // For Y coordinate: insert after X, before I/J/F
  if (coord === 'Y') {
    // Look for X and insert after it
    const xMatch = line.match(/X[+-]?\d*\.?\d+/i);
    if (xMatch && xMatch.index !== undefined) {
      const insertPos = xMatch.index + xMatch[0].length;
      return line.slice(0, insertPos) + ` ${coord}${formatValue(value)}` + line.slice(insertPos);
    }
    // Look for I (arc param) and insert before it
    const iMatch = line.match(/I[+-]?\d*\.?\d+/i);
    if (iMatch && iMatch.index !== undefined) {
      return line.slice(0, iMatch.index) + `${coord}${formatValue(value)} ` + line.slice(iMatch.index);
    }
    // Look for F (feed rate) and insert before it
    const fMatch = line.match(/F[+-]?\d*\.?\d+/i);
    if (fMatch && fMatch.index !== undefined) {
      return line.slice(0, fMatch.index) + `${coord}${formatValue(value)} ` + line.slice(fMatch.index);
    }
  }

  // For other coordinates, find the last coordinate position
  const coordPattern = /[XYZIJKRF][+-]?\d*\.?\d+/gi;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = coordPattern.exec(line)) !== null) {
    lastMatch = match;
  }

  if (lastMatch) {
    const insertPos = lastMatch.index + lastMatch[0].length;
    return line.slice(0, insertPos) + ` ${coord}${formatValue(value)}` + line.slice(insertPos);
  }

  // Fallback: add after G-code command
  const gcodeMatch = line.match(/G\d+/i);
  if (gcodeMatch && gcodeMatch.index !== undefined) {
    const insertPos = gcodeMatch.index + gcodeMatch[0].length;
    return line.slice(0, insertPos) + ` ${coord}${formatValue(value)}` + line.slice(insertPos);
  }

  // Last fallback: add at end before any comment
  const commentIndex = line.indexOf('(');
  if (commentIndex > 0) {
    return line.slice(0, commentIndex) + ` ${coord}${formatValue(value)} ` + line.slice(commentIndex);
  }

  return line + ` ${coord}${formatValue(value)}`;
}

/**
 * Swap G2 (CW) and G3 (CCW) arc directions.
 */
function swapArcDirection(line: string): string {
  return line
    .replace(/\bG0*2\b/gi, 'G__TEMP_CW__')
    .replace(/\bG0*3\b/gi, 'G2')
    .replace('G__TEMP_CW__', 'G3');
}

/**
 * Rotate G-code by 90 degrees CW or CCW around workspace origin (0,0).
 */
type ArcPlane = 'G17' | 'G18' | 'G19';

/**
 * What a rotation about Z does to an arc, derived by sampling arcs numerically
 * rather than by reasoning about conventions:
 *
 *   - the centre offset rotates like any other vector, which is why a plain XY
 *     arc has always worked;
 *   - a G18 (XZ) arc turns into a G19 (YZ) one and back, because the plane
 *     itself is carried around with the toolpath;
 *   - and the direction word flips whenever the axis you sight the plane along
 *     ends up pointing the other way. G17 never flips; G18 flips at -90 and
 *     180; G19 flips at +90 and 180.
 *
 * Miss any of the three and the arc still looks plausible while cutting
 * something else entirely: before this, a G18 ramp came out as G18 with its
 * offsets zeroed and a stray Y, i.e. a zero-radius arc carrying a helical
 * move, which a controller crawls through.
 */
const ROTATED_PLANE: Record<string, Record<ArcPlane, ArcPlane>> = {
  '90': { G17: 'G17', G18: 'G19', G19: 'G18' },
  '-90': { G17: 'G17', G18: 'G19', G19: 'G18' },
  '180': { G17: 'G17', G18: 'G18', G19: 'G19' },
};

const FLIPS_DIRECTION: Record<string, Record<ArcPlane, boolean>> = {
  '90': { G17: false, G18: false, G19: true },
  '-90': { G17: false, G18: true, G19: false },
  '180': { G17: false, G18: true, G19: true },
};

/** The two offset words each plane uses, in G-code order. */
const PLANE_OFFSETS: Record<ArcPlane, Array<'I' | 'J' | 'K'>> = {
  G17: ['I', 'J'],
  G18: ['I', 'K'],
  G19: ['J', 'K'],
};

const OFFSET_AXIS: Record<'I' | 'J' | 'K', 'x' | 'y' | 'z'> = { I: 'x', J: 'y', K: 'z' };

function parsePlaneWord(upper: string): ArcPlane | null {
  if (/\bG17\b/.test(upper)) return 'G17';
  if (/\bG18\b/.test(upper)) return 'G18';
  if (/\bG19\b/.test(upper)) return 'G19';
  return null;
}

/** G0/G1/G2/G3 (or G00..G03) on this line, or null when the line is modal. */
function parseMotionWord(upper: string): number | null {
  const match = upper.match(/\bG0*([0123])\b/);
  return match ? Number(match[1]) : null;
}

export function rotateGCode(
  gcodeContent: string,
  degrees: 90 | -90 | 180,
  options?: TransformOptions
): string {
  outputDecimals = detectDecimals(gcodeContent);

  outputDecimals = detectDecimals(gcodeContent);

  const centerX = 0;
  const centerY = 0;

  const lines = gcodeContent.split('\n');
  const result: string[] = [];
  const totalLines = lines.length;

  // Track ORIGINAL position for lines that don't specify all coordinates
  // This must be the original (pre-rotation) position to correctly handle implicit coords
  let originalX = 0;
  let originalY = 0;
  let isAbsolute = true;
  // Plane and motion are modal, and posts lean on that: Fusion writes one
  // "G18 G2 ..." and then bare "X.. Z.. I.. K.." lines that inherit both.
  let plane: ArcPlane = 'G17';
  let arcDirection: 2 | 3 | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (options?.onProgress && i % 1000 === 0) {
      options.onProgress((i / totalLines) * 100);
    }

    if (shouldSkipLine(line)) {
      result.push(line);
      continue;
    }

    const trimmed = line.trim().toUpperCase();
    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;

    const planeWord = parsePlaneWord(trimmed);
    if (planeWord) plane = planeWord;

    const motionWord = parseMotionWord(trimmed);
    if (motionWord !== null) arcDirection = motionWord === 2 || motionWord === 3 ? motionWord : null;

    const { transformed, endX, endY } = rotateLineWithPosition(
      line, degrees, centerX, centerY, originalX, originalY, isAbsolute,
      plane, planeWord !== null, arcDirection, motionWord !== null
    );
    result.push(transformed);

    // Update original position tracking (using ORIGINAL coordinates, not rotated)
    if (endX !== null) originalX = endX;
    if (endY !== null) originalY = endY;
  }

  options?.onProgress?.(100);
  return result.join('\n');
}

/**
 * Rotate a single line with position tracking.
 * Uses the current position for missing coordinates instead of center.
 * Returns the transformed line and the ORIGINAL X/Y endpoint for position tracking.
 * Handles both absolute (G90) and incremental (G91) positioning modes.
 */
function rotateLineWithPosition(
  line: string,
  degrees: 90 | -90 | 180,
  centerX: number,
  centerY: number,
  originalX: number,
  originalY: number,
  isAbsolute: boolean,
  plane: ArcPlane,
  hasPlaneWord: boolean,
  arcDirection: 2 | 3 | null,
  hasMotionWord: boolean
): { transformed: string; endX: number | null; endY: number | null } {
  const x = parseCoord(line, 'X');
  const y = parseCoord(line, 'Y');

  let result = line;
  // Track the ORIGINAL endpoint (not rotated) for position tracking
  let endX: number | null = null;
  let endY: number | null = null;

  // Transform X, Y coordinates
  if (x !== null || y !== null) {
    if (isAbsolute) {
      // Absolute mode: rotate position around center point
      const actualX = x ?? originalX;
      const actualY = y ?? originalY;

      endX = actualX;
      endY = actualY;

      const relX = actualX - centerX;
      const relY = actualY - centerY;

      let rotatedX: number, rotatedY: number;

      if (degrees === 90) {
        rotatedX = relY + centerX;
        rotatedY = -relX + centerY;
      } else if (degrees === -90) {
        rotatedX = -relY + centerX;
        rotatedY = relX + centerY;
      } else {
        rotatedX = -relX + centerX;
        rotatedY = -relY + centerY;
      }

      if (x !== null) {
        result = replaceCoord(result, 'X', rotatedX);
      } else {
        result = addCoord(result, 'X', rotatedX);
      }

      if (y !== null) {
        result = replaceCoord(result, 'Y', rotatedY);
      } else {
        result = addCoord(result, 'Y', rotatedY);
      }
    } else {
      // Incremental mode: rotate the displacement vector directly (no center offset)
      const dx = x ?? 0;
      const dy = y ?? 0;

      // Update absolute position tracking for when mode switches back to G90
      endX = originalX + dx;
      endY = originalY + dy;

      let rotatedDx: number, rotatedDy: number;

      if (degrees === 90) {
        rotatedDx = dy;
        rotatedDy = -dx;
      } else if (degrees === -90) {
        rotatedDx = -dy;
        rotatedDy = dx;
      } else {
        rotatedDx = -dx;
        rotatedDy = -dy;
      }

      if (x !== null && y !== null) {
        result = replaceCoord(result, 'X', rotatedDx);
        result = replaceCoord(result, 'Y', rotatedDy);
      } else if (x !== null) {
        result = replaceCoord(result, 'X', rotatedDx);
        result = addCoord(result, 'Y', rotatedDy);
      } else {
        result = addCoord(result, 'X', rotatedDx);
        result = replaceCoord(result, 'Y', rotatedDy);
      }
    }
  }

  const key = String(degrees);
  const targetPlane = ROTATED_PLANE[key][plane];

  // The plane word travels with the toolpath: a G18 ramp becomes a G19 one.
  if (hasPlaneWord && targetPlane !== plane) {
    result = result.replace(new RegExp(`\\b${plane}\\b`, 'i'), targetPlane);
  }

  // Arc offsets. Only the words this plane actually uses are read - a J on a
  // G18 line means nothing to a controller, and inventing one was how the old
  // code destroyed these arcs.
  const sourceWords = PLANE_OFFSETS[plane];
  const offsets: Record<'x' | 'y' | 'z', number> = { x: 0, y: 0, z: 0 };
  let hasOffset = false;
  for (const word of sourceWords) {
    const value = parseCoord(line, word);
    if (value !== null) {
      offsets[OFFSET_AXIS[word]] = value;
      hasOffset = true;
    }
  }

  if (hasOffset) {
    let rx: number, ry: number;
    if (degrees === 90) {
      rx = offsets.y;
      ry = -offsets.x;
    } else if (degrees === -90) {
      rx = -offsets.y;
      ry = offsets.x;
    } else {
      rx = -offsets.x;
      ry = -offsets.y;
    }
    const rotated = { x: rx, y: ry, z: offsets.z };

    result = removeCoord(result, 'I');
    result = removeCoord(result, 'J');
    result = removeCoord(result, 'K');
    for (const word of PLANE_OFFSETS[targetPlane]) {
      result = addCoord(result, word, rotated[OFFSET_AXIS[word]]);
    }
  }

  // Direction. When the plane is sighted along the opposite axis after
  // rotation, the same physical arc is written with the other word - and a
  // modal arc has to be given one explicitly, because its G2/G3 was inherited
  // from a line that may now say something different.
  if (arcDirection !== null && FLIPS_DIRECTION[key][plane]) {
    const flipped = arcDirection === 2 ? 3 : 2;
    if (hasMotionWord) {
      result = result.replace(/\bG0*[23]\b/i, `G${flipped}`);
    } else {
      const indent = result.match(/^\s*/)?.[0] ?? '';
      result = `${indent}G${flipped} ${result.trim()}`;
    }
  }

  return { transformed: result, endX, endY };
}

/**
 * Mirror G-code across X or Y axis through workspace origin (0,0).
 */
export function mirrorGCode(
  gcodeContent: string,
  axis: 'x' | 'y',
  options?: TransformOptions
): string {
  outputDecimals = detectDecimals(gcodeContent);

  const centerX = 0;
  const centerY = 0;

  const lines = gcodeContent.split('\n');
  const result: string[] = [];
  const totalLines = lines.length;
  let isAbsolute = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (options?.onProgress && i % 1000 === 0) {
      options.onProgress((i / totalLines) * 100);
    }

    if (shouldSkipLine(line)) {
      result.push(line);
      continue;
    }

    // Track positioning mode changes
    const trimmed = line.trim().toUpperCase();
    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;

    result.push(mirrorLine(line, axis, centerX, centerY, isAbsolute));
  }

  options?.onProgress?.(100);
  return result.join('\n');
}

function mirrorLine(line: string, axis: 'x' | 'y', centerX: number, centerY: number, isAbsolute: boolean): string {
  let result = line;

  if (axis === 'x') {
    // Mirror across X axis: reflect Y coordinates, negate J, swap arc direction
    const y = parseCoord(line, 'Y');
    const j = parseCoord(line, 'J');

    if (y !== null) {
      if (isAbsolute) {
        const newY = 2 * centerY - y;
        result = replaceCoord(result, 'Y', newY);
      } else {
        // Incremental: negate displacement
        result = replaceCoord(result, 'Y', -y);
      }
    }
    if (j !== null) {
      result = replaceCoord(result, 'J', -j);
    }
    // Swap G2 <-> G3 because mirroring reverses arc direction
    result = swapArcDirection(result);
  } else {
    // Mirror across Y axis: reflect X coordinates, negate I, swap arc direction
    const x = parseCoord(line, 'X');
    const i = parseCoord(line, 'I');

    if (x !== null) {
      if (isAbsolute) {
        const newX = 2 * centerX - x;
        result = replaceCoord(result, 'X', newX);
      } else {
        // Incremental: negate displacement
        result = replaceCoord(result, 'X', -x);
      }
    }
    if (i !== null) {
      result = replaceCoord(result, 'I', -i);
    }
    result = swapArcDirection(result);
  }

  return result;
}

/**
 * Offset/translate G-code by X, Y, and Z amounts.
 */
export function offsetGCode(
  gcodeContent: string,
  offsetX: number,
  offsetY: number,
  offsetZ: number = 0,
  options?: TransformOptions
): string {
  outputDecimals = detectDecimals(gcodeContent);

  const lines = gcodeContent.split('\n');
  const result: string[] = [];
  const totalLines = lines.length;
  let isAbsolute = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (options?.onProgress && i % 1000 === 0) {
      options.onProgress((i / totalLines) * 100);
    }

    if (shouldSkipLine(line)) {
      result.push(line);
      continue;
    }

    // Track positioning mode changes
    const trimmed = line.trim().toUpperCase();
    if (trimmed.includes('G90') && !trimmed.includes('G90.1')) isAbsolute = true;
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) isAbsolute = false;

    // Skip incremental mode lines (displacements don't get offset)
    if (!isAbsolute) {
      result.push(line);
      continue;
    }

    // Skip lines without X, Y, or Z
    if (!line.toUpperCase().includes('X') && !line.toUpperCase().includes('Y') && !line.toUpperCase().includes('Z')) {
      result.push(line);
      continue;
    }

    result.push(offsetLine(line, offsetX, offsetY, offsetZ));
  }

  options?.onProgress?.(100);
  return result.join('\n');
}

function offsetLine(line: string, offsetX: number, offsetY: number, offsetZ: number): string {
  let result = line;

  if (offsetX !== 0) {
    result = result.replace(/X([+-]?\d*\.?\d+)/gi, (_match, value) => {
      const newValue = parseFloat(value) + offsetX;
      return 'X' + formatValue(newValue);
    });
  }

  if (offsetY !== 0) {
    result = result.replace(/Y([+-]?\d*\.?\d+)/gi, (_match, value) => {
      const newValue = parseFloat(value) + offsetY;
      return 'Y' + formatValue(newValue);
    });
  }

  if (offsetZ !== 0) {
    result = result.replace(/Z([+-]?\d*\.?\d+)/gi, (_match, value) => {
      const newValue = parseFloat(value) + offsetZ;
      return 'Z' + formatValue(newValue);
    });
  }

  return result;
}

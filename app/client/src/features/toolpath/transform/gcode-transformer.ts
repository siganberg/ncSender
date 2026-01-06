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
    const isArc = (motionMode === 2 || motionMode === 3) && (iMatch || jMatch);

    if (isArc) {
      const i = iMatch ? parseFloat(iMatch[1]) : 0;
      const j = jMatch ? parseFloat(jMatch[1]) : 0;

      let centerX: number, centerY: number;
      if (isArcAbsolute) {
        centerX = i;
        centerY = j;
      } else {
        centerX = startX + i;
        centerY = startY + j;
      }

      const radius = Math.sqrt(Math.pow(startX - centerX, 2) + Math.pow(startY - centerY, 2));
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
 * Replace a coordinate value in a G-code line.
 */
function replaceCoord(line: string, coord: string, value: number): string {
  const regex = new RegExp(`(${coord})([+-]?\\d*\\.?\\d+)`, 'gi');
  return line.replace(regex, `$1${value.toFixed(3)}`);
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
  // For arc parameters (I, J), insert after Y (or X if no Y), before F
  if (coord === 'I' || coord === 'J') {
    // If adding J, check if I exists and insert after I
    if (coord === 'J') {
      const iMatch = line.match(/I[+-]?\d*\.?\d+/i);
      if (iMatch && iMatch.index !== undefined) {
        const insertPos = iMatch.index + iMatch[0].length;
        return line.slice(0, insertPos) + ` ${coord}${value.toFixed(3)}` + line.slice(insertPos);
      }
    }
    // Insert after Y coordinate (or X if no Y)
    const yMatch = line.match(/Y[+-]?\d*\.?\d+/i);
    if (yMatch && yMatch.index !== undefined) {
      const insertPos = yMatch.index + yMatch[0].length;
      return line.slice(0, insertPos) + ` ${coord}${value.toFixed(3)}` + line.slice(insertPos);
    }
    const xMatch = line.match(/X[+-]?\d*\.?\d+/i);
    if (xMatch && xMatch.index !== undefined) {
      const insertPos = xMatch.index + xMatch[0].length;
      return line.slice(0, insertPos) + ` ${coord}${value.toFixed(3)}` + line.slice(insertPos);
    }
  }

  // For X coordinate: insert after G-code command, before Y/Z/I/J/F
  if (coord === 'X') {
    // Look for Y first and insert before it
    const yMatch = line.match(/Y[+-]?\d*\.?\d+/i);
    if (yMatch && yMatch.index !== undefined) {
      return line.slice(0, yMatch.index) + `${coord}${value.toFixed(3)} ` + line.slice(yMatch.index);
    }
    // Look for I (arc param) and insert before it
    const iMatch = line.match(/I[+-]?\d*\.?\d+/i);
    if (iMatch && iMatch.index !== undefined) {
      return line.slice(0, iMatch.index) + `${coord}${value.toFixed(3)} ` + line.slice(iMatch.index);
    }
    // Look for F (feed rate) and insert before it
    const fMatch = line.match(/F[+-]?\d*\.?\d+/i);
    if (fMatch && fMatch.index !== undefined) {
      return line.slice(0, fMatch.index) + `${coord}${value.toFixed(3)} ` + line.slice(fMatch.index);
    }
  }

  // For Y coordinate: insert after X, before I/J/F
  if (coord === 'Y') {
    // Look for X and insert after it
    const xMatch = line.match(/X[+-]?\d*\.?\d+/i);
    if (xMatch && xMatch.index !== undefined) {
      const insertPos = xMatch.index + xMatch[0].length;
      return line.slice(0, insertPos) + ` ${coord}${value.toFixed(3)}` + line.slice(insertPos);
    }
    // Look for I (arc param) and insert before it
    const iMatch = line.match(/I[+-]?\d*\.?\d+/i);
    if (iMatch && iMatch.index !== undefined) {
      return line.slice(0, iMatch.index) + `${coord}${value.toFixed(3)} ` + line.slice(iMatch.index);
    }
    // Look for F (feed rate) and insert before it
    const fMatch = line.match(/F[+-]?\d*\.?\d+/i);
    if (fMatch && fMatch.index !== undefined) {
      return line.slice(0, fMatch.index) + `${coord}${value.toFixed(3)} ` + line.slice(fMatch.index);
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
    return line.slice(0, insertPos) + ` ${coord}${value.toFixed(3)}` + line.slice(insertPos);
  }

  // Fallback: add after G-code command
  const gcodeMatch = line.match(/G\d+/i);
  if (gcodeMatch && gcodeMatch.index !== undefined) {
    const insertPos = gcodeMatch.index + gcodeMatch[0].length;
    return line.slice(0, insertPos) + ` ${coord}${value.toFixed(3)}` + line.slice(insertPos);
  }

  // Last fallback: add at end before any comment
  const commentIndex = line.indexOf('(');
  if (commentIndex > 0) {
    return line.slice(0, commentIndex) + ` ${coord}${value.toFixed(3)} ` + line.slice(commentIndex);
  }

  return line + ` ${coord}${value.toFixed(3)}`;
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
 * Rotate G-code by 90 degrees CW or CCW around the toolpath center.
 */
export function rotateGCode(
  gcodeContent: string,
  degrees: 90 | -90 | 180,
  options?: TransformOptions
): string {
  const bounds = analyzeGCodeBounds(gcodeContent);
  const centerX = bounds.centerX;
  const centerY = bounds.centerY;

  const lines = gcodeContent.split('\n');
  const result: string[] = [];
  const totalLines = lines.length;

  // Track ORIGINAL position for lines that don't specify all coordinates
  // This must be the original (pre-rotation) position to correctly handle implicit coords
  let originalX = 0;
  let originalY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (options?.onProgress && i % 1000 === 0) {
      options.onProgress((i / totalLines) * 100);
    }

    if (shouldSkipLine(line)) {
      result.push(line);
      continue;
    }

    const { transformed, endX, endY } = rotateLineWithPosition(
      line, degrees, centerX, centerY, originalX, originalY
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
 */
function rotateLineWithPosition(
  line: string,
  degrees: 90 | -90 | 180,
  centerX: number,
  centerY: number,
  originalX: number,
  originalY: number
): { transformed: string; endX: number | null; endY: number | null } {
  const x = parseCoord(line, 'X');
  const y = parseCoord(line, 'Y');
  const i = parseCoord(line, 'I');
  const j = parseCoord(line, 'J');

  let result = line;
  // Track the ORIGINAL endpoint (not rotated) for position tracking
  let endX: number | null = null;
  let endY: number | null = null;

  // Transform X, Y coordinates
  if (x !== null || y !== null) {
    // For missing coordinates, use current ORIGINAL position
    const actualX = x ?? originalX;
    const actualY = y ?? originalY;

    // Track original endpoint for next line's implicit coordinate handling
    endX = actualX;
    endY = actualY;

    // Calculate position relative to toolpath center for rotation
    const relX = actualX - centerX;
    const relY = actualY - centerY;

    let rotatedX: number, rotatedY: number;

    if (degrees === 90) {
      // 90 CW: (x, y) -> (y, -x)
      rotatedX = relY + centerX;
      rotatedY = -relX + centerY;
    } else if (degrees === -90) {
      // 90 CCW: (x, y) -> (-y, x)
      rotatedX = -relY + centerX;
      rotatedY = relX + centerY;
    } else {
      // 180: (x, y) -> (-x, -y)
      rotatedX = -relX + centerX;
      rotatedY = -relY + centerY;
    }

    // Update the line: replace existing coordinates, add missing ones
    if (x !== null) {
      result = replaceCoord(result, 'X', rotatedX);
    } else {
      // X was implicit - we need to add it since the rotated position is different
      result = addCoord(result, 'X', rotatedX);
    }

    if (y !== null) {
      result = replaceCoord(result, 'Y', rotatedY);
    } else {
      // Y was implicit - we need to add it since the rotated position is different
      result = addCoord(result, 'Y', rotatedY);
    }
  }

  // Transform I, J for arcs (same rotation, no center offset since they're relative)
  // Important: After rotation, I and J values swap, so we need to handle cases where
  // one was originally zero/omitted but becomes non-zero after rotation
  if (i !== null || j !== null) {
    const iVal = i ?? 0;
    const jVal = j ?? 0;

    let newI: number, newJ: number;

    if (degrees === 90) {
      newI = jVal;
      newJ = -iVal;
    } else if (degrees === -90) {
      newI = -jVal;
      newJ = iVal;
    } else {
      newI = -iVal;
      newJ = -jVal;
    }

    // Remove existing I and J values
    result = removeCoord(result, 'I');
    result = removeCoord(result, 'J');

    // Always add both I and J values for arc commands after rotation
    // Some G-code interpreters require explicit values
    result = addCoord(result, 'I', newI);
    result = addCoord(result, 'J', newJ);
  }

  return { transformed: result, endX, endY };
}

/**
 * Mirror G-code across X or Y axis through the toolpath center.
 */
export function mirrorGCode(
  gcodeContent: string,
  axis: 'x' | 'y',
  options?: TransformOptions
): string {
  const bounds = analyzeGCodeBounds(gcodeContent);
  const centerX = bounds.centerX;
  const centerY = bounds.centerY;

  const lines = gcodeContent.split('\n');
  const result: string[] = [];
  const totalLines = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (options?.onProgress && i % 1000 === 0) {
      options.onProgress((i / totalLines) * 100);
    }

    if (shouldSkipLine(line)) {
      result.push(line);
      continue;
    }

    result.push(mirrorLine(line, axis, centerX, centerY));
  }

  options?.onProgress?.(100);
  return result.join('\n');
}

function mirrorLine(line: string, axis: 'x' | 'y', centerX: number, centerY: number): string {
  let result = line;

  if (axis === 'x') {
    // Mirror across X axis: reflect Y coordinates, negate J, swap arc direction
    const y = parseCoord(line, 'Y');
    const j = parseCoord(line, 'J');

    if (y !== null) {
      const newY = 2 * centerY - y;
      result = replaceCoord(result, 'Y', newY);
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
      const newX = 2 * centerX - x;
      result = replaceCoord(result, 'X', newX);
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
  const lines = gcodeContent.split('\n');
  const result: string[] = [];
  const totalLines = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (options?.onProgress && i % 1000 === 0) {
      options.onProgress((i / totalLines) * 100);
    }

    if (shouldSkipLine(line)) {
      result.push(line);
      continue;
    }

    // Also skip incremental mode lines for offset
    const trimmed = line.trim().toUpperCase();
    if (trimmed.includes('G91') && !trimmed.includes('G91.1')) {
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
      return 'X' + newValue.toFixed(3);
    });
  }

  if (offsetY !== 0) {
    result = result.replace(/Y([+-]?\d*\.?\d+)/gi, (_match, value) => {
      const newValue = parseFloat(value) + offsetY;
      return 'Y' + newValue.toFixed(3);
    });
  }

  if (offsetZ !== 0) {
    result = result.replace(/Z([+-]?\d*\.?\d+)/gi, (_match, value) => {
      const newValue = parseFloat(value) + offsetZ;
      return 'Z' + newValue.toFixed(3);
    });
  }

  return result;
}

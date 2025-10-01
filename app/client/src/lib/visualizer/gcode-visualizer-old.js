import * as THREE from 'three';
import { ArcCurve } from 'three';

class GCodeVisualizer {
    constructor() {
        this.group = new THREE.Group();
        this.geometry = new THREE.BufferGeometry();
        this.vertices = [];
        this.colors = [];
        this.pathLines = [];

        // G-code movement types colors
        this.moveColors = {
            rapid: 0x00ff00,  // Rapid moves - Bright Green
            cutting: 0x3e85c7,  // Cutting moves - Light Blue
            completedRapid: 0x333333,  // Completed rapid - Dark Gray
            completedCutting: 0x444444  // Completed cutting - Dark Gray
        };

        // Track line numbers for each path segment
        // Map structure: lineNumber -> [{ line: THREE.Line, originalColor: number }]
        this.lineNumberMap = new Map();

        // Set of completed line numbers for O(1) lookup
        this.completedLines = new Set();

        // Track last rapid XY segment to avoid duplicate cutting on next G1
        this._lastRapid = null;

        return this;
    }

    // Compute arc center from R specification choosing short/long per sign(R)
    _computeCenterFromR(start, end, R, isCW) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const d = Math.hypot(dx, dy);
        if (d === 0) return null;
        const r = Math.abs(R);
        // If chord longer than diameter, invalid arc
        if (2 * r < d - 1e-6) return null;

        const mx = (start.x + end.x) / 2;
        const my = (start.y + end.y) / 2;
        const ux = dx / d;
        const uy = dy / d;
        const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4));

        // Two possible centers along the perpendicular
        const n1x = -uy, n1y = ux;
        const c1x = mx + n1x * h;
        const c1y = my + n1y * h;
        const c2x = mx - n1x * h;
        const c2y = my - n1y * h;

        const pick = (cx, cy) => {
            const a0 = Math.atan2(start.y - cy, start.x - cx);
            const a1 = Math.atan2(end.y - cy, end.x - cx);
            let delta = isCW ? (a0 - a1) : (a1 - a0);
            // Normalize to [0, 2PI)
            while (delta < 0) delta += Math.PI * 2;
            while (delta >= Math.PI * 2) delta -= Math.PI * 2;
            return delta; // sweep in [0, 2PI)
        };

        const d1 = pick(c1x, c1y);
        const d2 = pick(c2x, c2y);

        const wantLong = R < 0; // R<0 means arc >= 180 deg
        const isLong1 = d1 > Math.PI + 1e-9;
        const isLong2 = d2 > Math.PI + 1e-9;

        let cx = c1x, cy = c1y;
        if (wantLong) {
            if (isLong1 && !isLong2) {
                cx = c1x; cy = c1y;
            } else if (!isLong1 && isLong2) {
                cx = c2x; cy = c2y;
            } else {
                // both same side; pick the longer
                cx = (d1 >= d2) ? c1x : c2x;
                cy = (d1 >= d2) ? c1y : c2y;
            }
        } else {
            if (!isLong1 && isLong2) {
                cx = c1x; cy = c1y;
            } else if (isLong1 && !isLong2) {
                cx = c2x; cy = c2y;
            } else {
                // both same side; pick the shorter
                cx = (d1 <= d2) ? c1x : c2x;
                cy = (d1 <= d2) ? c1y : c2y;
            }
        }

        return { x: cx, y: cy };
    }

    clear() {
        // Remove all existing path lines
        this.pathLines.forEach(line => {
            this.group.remove(line);
        });
        this.pathLines = [];
        this.vertices = [];
        this.colors = [];
        this.lineNumberMap.clear();
        this.completedLines.clear();
        this._lastRapid = null;
    }

    _closeIfLoop(path) { return path; }

    parseGCode(gcodeString) {
        const lines = gcodeString.split('\n');
        const toolpaths = { rapid: [], cutting: [] };
        let currentPosition = { x: 0, y: 0, z: 0 };
        let lastMoveType = null;
        let currentToolpath = [];
        let currentToolpathLineNumbers = [];
        // Track whether tool is down based on Z plunges/retracts
        let isToolDown = false;
        // Modal states
        let xyzAbsolute = true;   // G90 (default)
        let ijAbsolute = false;   // IJ incremental unless G90.1

        lines.forEach((line, lineIndex) => {
            const lineNumber = lineIndex + 1; // 1-based line numbering (actual file line number)
            // Strip inline comments: both ';' and '( ... )' styles, then normalize
            const noParenComments = line.replace(/\([^)]*\)/g, '');
            const cleanLine = noParenComments.split(';')[0].trim().toUpperCase();

            // Skip empty lines but keep line numbering consistent
            if (!cleanLine) return;

            let moveType = lastMoveType;
            let newPosition = { ...currentPosition };
            let arcCenter = null;
            
            // Extract commands using regex
            const gMatch = cleanLine.match(/G(\d+(?:\.\d+)?)/);
            const xMatch = cleanLine.match(/X([-+]?\d*\.?\d+)/);
            const yMatch = cleanLine.match(/Y([-+]?\d*\.?\d+)/);
            const zMatch = cleanLine.match(/Z([-+]?\d*\.?\d+)/);
            const iMatch = cleanLine.match(/I([-+]?\d*\.?\d+)/);
            const jMatch = cleanLine.match(/J([-+]?\d*\.?\d+)/);
            const rMatch = cleanLine.match(/R([-+]?\d*\.?\d+)/);
            
            if (gMatch) {
                const gStr = gMatch[1];
                const gCodeInt = parseInt(gStr);
                if ([0, 1, 2, 3].includes(gCodeInt)) {
                    moveType = `G${gCodeInt}`;
                    lastMoveType = moveType;
                }
                // Modal handling
                if (gStr === '90') xyzAbsolute = true;
                if (gStr === '91') xyzAbsolute = false;
                if (gStr === '90.1') ijAbsolute = true;
                if (gStr === '91.1') ijAbsolute = false;
            }
            
            if (xMatch) newPosition.x = xyzAbsolute ? parseFloat(xMatch[1]) : currentPosition.x + parseFloat(xMatch[1]);
            if (yMatch) newPosition.y = xyzAbsolute ? parseFloat(yMatch[1]) : currentPosition.y + parseFloat(yMatch[1]);
            if (zMatch) newPosition.z = xyzAbsolute ? parseFloat(zMatch[1]) : currentPosition.z + parseFloat(zMatch[1]);
            
            // Arc parameters - handle both I/J and R formats
            if ((iMatch || jMatch) && (moveType === 'G2' || moveType === 'G3')) {
                const iVal = iMatch ? parseFloat(iMatch[1]) : 0;
                const jVal = jMatch ? parseFloat(jMatch[1]) : 0;
                arcCenter = ijAbsolute
                    ? { i: iVal - currentPosition.x, j: jVal - currentPosition.y }
                    : { i: iVal, j: jVal };
            } else if (rMatch && (moveType === 'G2' || moveType === 'G3')) {
                // Robust conversion from R to IJ by selecting center
                const radius = parseFloat(rMatch[1]);
                const isCW = moveType === 'G2';
                const centerXY = this._computeCenterFromR(currentPosition, newPosition, radius, isCW);
                if (centerXY) {
                    arcCenter = {
                        i: centerXY.x - currentPosition.x,
                        j: centerXY.y - currentPosition.y
                    };
                }
            }

            const hasMovement = (
                newPosition.x !== currentPosition.x || 
                newPosition.y !== currentPosition.y || 
                newPosition.z !== currentPosition.z
            );

            if (hasMovement && moveType) {
                // Update tool-down state based on Z-only direction
                const eps = 1e-6;
                const zChanged = (Math.abs(newPosition.z - currentPosition.z) > eps);
                const xyChanged = (Math.abs(newPosition.x - currentPosition.x) > eps || Math.abs(newPosition.y - currentPosition.y) > eps);
                if (zChanged && !xyChanged) {
                    if (newPosition.z < currentPosition.z - eps) {
                        // Plunge
                        isToolDown = true;
                    } else if (newPosition.z > currentPosition.z + eps) {
                        // Retract
                        isToolDown = false;
                    }
                }

                // Classify moves: treat XY moves with tool-up as rapid even if G1
                const isArcMove = (moveType === 'G2' || moveType === 'G3');
                const isLinearMove = (moveType === 'G1');
                const isModalRapid = (moveType === 'G0');
                const isCuttingMove = (isToolDown && (isArcMove || (isLinearMove && xyChanged)));
                const isRapidMove = (!isToolDown && xyChanged) || (isModalRapid && xyChanged);
                
                
                if (isCuttingMove) {
                    // Handle arcs differently
                    if ((moveType === 'G2' || moveType === 'G3') && arcCenter) {
                        const arcPoints = this.interpolateArc(
                            currentPosition,
                            newPosition,
                            arcCenter,
                            moveType === 'G2'
                        );

                        // If path is empty, add all arc points including start
                        if (currentToolpath.length === 0) {
                            currentToolpath.push(...arcPoints);
                        } else {
                            // Path already has points, skip first arc point to avoid duplicate
                            currentToolpath.push(...arcPoints.slice(1));
                        }
                    } else {
                        // Linear move (G1)
                        if (currentToolpath.length === 0) {
                            // Starting a new path, add current position
                            currentToolpath.push({ ...currentPosition });
                        }
                        // Avoid duplicating the immediately prior rapid segment
                        const eps = 1e-6;
                        const lastRapid = this._lastRapid;
                        const dupRapid = lastRapid &&
                          Math.abs(lastRapid.from.x - currentPosition.x) < eps &&
                          Math.abs(lastRapid.from.y - currentPosition.y) < eps &&
                          Math.abs(lastRapid.to.x - newPosition.x) < eps &&
                          Math.abs(lastRapid.to.y - newPosition.y) < eps;
                        if (!dupRapid) {
                            currentToolpath.push({ ...newPosition });
                        }
                    }

                    // Track line number for this segment
                    currentToolpathLineNumbers.push(lineNumber);
                } else {

                    // Finish current cutting path on any non-cutting move
                    if (currentToolpath.length > 1) {
                        toolpaths.cutting.push({
                            path: [...currentToolpath],
                            lineNumbers: [...currentToolpathLineNumbers]
                        });
                        currentToolpath = [];
                        currentToolpathLineNumbers = [];
                    }

                    // Only record explicit rapids as rapid moves
                    if (isRapidMove) {
                        toolpaths.rapid.push({
                            path: [
                                { ...currentPosition },
                                { ...newPosition }
                            ],
                            lineNumbers: [lineNumber]
                        });
                        this._lastRapid = {
                            from: { x: currentPosition.x, y: currentPosition.y },
                            to: { x: newPosition.x, y: newPosition.y }
                        };
                    } else {
                        this._lastRapid = null;
                    }
                }
                
                currentPosition = newPosition;
            }
        });

        if (currentToolpath.length > 1) {
            toolpaths.cutting.push({
                path: currentToolpath,
                lineNumbers: currentToolpathLineNumbers
            });
        }

        return toolpaths;
    }

    interpolateArc(start, end, center, clockwise) {
        const points = [];
        const centerX = start.x + center.i;
        const centerY = start.y + center.j;

        // Calculate radius from center offset
        const radius = Math.sqrt(center.i * center.i + center.j * center.j);

        // Calculate start and end angles
        let startAngle = Math.atan2(start.y - centerY, start.x - centerX);
        let endAngle = Math.atan2(end.y - centerY, end.x - centerX);

        // Normalize sweep based on direction (G2=clockwise, G3=ccw)
        let delta = endAngle - startAngle;
        if (clockwise && delta > 0) {
            delta -= 2 * Math.PI;
        } else if (!clockwise && delta < 0) {
            delta += 2 * Math.PI;
        }
        endAngle = startAngle + delta;

        // Sample the arc
        const arcCurve = new ArcCurve(
            centerX,
            centerY,
            radius,
            startAngle,
            endAngle,
            clockwise
        );

        // Choose divisions proportional to sweep, with a floor for smoothness
        const minDiv = 12;
        const divPerQuarter = 16; // ~16 segments per 90 degrees
        const divisions = Math.max(minDiv, Math.ceil((Math.abs(delta) / (Math.PI / 2)) * divPerQuarter));
        const curvePoints = arcCurve.getPoints(divisions);

        // Convert Three.js Vector2 points to our format and interpolate Z
        const n = curvePoints.length;
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const point = curvePoints[i];
            const z = start.z + (end.z - start.z) * t;
            points.push({ x: point.x, y: point.y, z });
        }

        // Snap last point exactly to end to ensure loop closure
        if (points.length > 0) {
            points[points.length - 1].x = end.x;
            points[points.length - 1].y = end.y;
            points[points.length - 1].z = end.z;
        }

        return points;
    }

    render(gcodeString) {
        this.clear();

        if (!gcodeString) return;

        const toolpaths = this.parseGCode(gcodeString);

        // Like gSender: create single flat vertices array as line segment pairs
        const allVertices = [];
        const allColors = [];
        let globalVertexIndex = 0;

        toolpaths.cutting.forEach((segment, segmentIndex) => {
            if (segment.path.length < 2) return;

            const cuttingColor = new THREE.Color(this.moveColors.cutting);
            const startVertexIndex = globalVertexIndex;

            // Add consecutive points as line segment pairs (like gSender does)
            for (let i = 0; i < segment.path.length - 1; i++) {
                const p1 = segment.path[i];
                const p2 = segment.path[i + 1];

                // Push both vertices of this line segment
                allVertices.push(p1.x, p1.y, p1.z);
                allVertices.push(p2.x, p2.y, p2.z);

                // Push colors for both vertices
                allColors.push(cuttingColor.r, cuttingColor.g, cuttingColor.b);
                allColors.push(cuttingColor.r, cuttingColor.g, cuttingColor.b);

                globalVertexIndex += 2;
            }

            const endVertexIndex = globalVertexIndex;

            // Map line numbers to vertex indices
            segment.lineNumbers.forEach((lineNum, lineIdx) => {
                if (!this.lineNumberMap.has(lineNum)) {
                    this.lineNumberMap.set(lineNum, []);
                }
                this.lineNumberMap.get(lineNum).push({
                    startVertexIndex,
                    endVertexIndex,
                    originalColor: this.moveColors.cutting,
                    type: 'cutting',
                    lineIndex: lineIdx,
                    totalLines: segment.lineNumbers.length
                });
            });
        });

        // Create single THREE.Line for all cutting paths (like gSender)
        // The duplicate vertices at connection points make segments appear continuous
        if (allVertices.length > 0) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(allVertices, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));

            const material = new THREE.LineBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.9,
                linewidth: 2
            });

            const line = new THREE.Line(geometry, material);
            line.userData = {
                type: 'cutting',
                totalVertices: globalVertexIndex
            };
            line.name = 'cutting-paths';
            line.renderOrder = 1;

            this.pathLines.push(line);
            this.group.add(line);
        }

        // Render rapid moves (solid lines)
        toolpaths.rapid.forEach((segment, index) => {
            if (segment.path.length < 2) return;

            const points = segment.path.map(point => new THREE.Vector3(point.x, point.y, point.z));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);

            const material = new THREE.LineBasicMaterial({
                color: this.moveColors.rapid, // Rapid color - bright green
                transparent: true,
                opacity: 0.6, // Slightly more transparent than cutting paths
                linewidth: 1
            });

            const line = new THREE.Line(geometry, material);
            line.userData = {
                type: 'rapid',
                pathIndex: index,
                lineNumbers: segment.lineNumbers,
                originalColor: this.moveColors.rapid
            };
            line.name = `rapid-path-${index}`;

            this.pathLines.push(line);
            this.group.add(line);

            // Map line numbers to this THREE.Line object
            segment.lineNumbers.forEach(lineNum => {
                if (!this.lineNumberMap.has(lineNum)) {
                    this.lineNumberMap.set(lineNum, []);
                }
                this.lineNumberMap.get(lineNum).push({
                    line: line,
                    originalColor: this.moveColors.rapid,
                    type: 'rapid'
                });
            });
        });

        this.group.name = 'gcode-paths';
        
        // Calculate bounds for camera positioning
        const box = new THREE.Box3().setFromObject(this.group);
        this.bounds = {
            min: box.min,
            max: box.max,
            center: box.getCenter(new THREE.Vector3()),
            size: box.getSize(new THREE.Vector3())
        };
        
        return this.group;
    }

    getBounds() {
        return this.bounds;
    }

    setVisibility(visible) {
        this.group.visible = visible;
    }

    setOpacity(opacity) {
        this.pathLines.forEach(line => {
            line.material.opacity = opacity;
        });
    }

    getMoveTypeVisibility() {
        return {
            cutting: true,
            rapid: true
        };
    }

    setMoveTypeVisibility(type, visible) {
        this.pathLines.forEach(line => {
            if (line.userData.type === type) {
                line.visible = visible;
            }
        });
    }

    setCuttingVisibility(visible) {
        this.setMoveTypeVisibility('cutting', visible);
    }

    setRapidVisibility(visible) {
        this.setMoveTypeVisibility('rapid', visible);
    }

    /**
     * Mark a line number as completed (gray it out)
     * @param {number} lineNumber - The G-code line number (1-based)
     */
    markLineCompleted(lineNumber) {
        if (this.completedLines.has(lineNumber)) {
            return; // Already marked as completed
        }

        this.completedLines.add(lineNumber);

        // Get all segments associated with this line number
        const lineObjects = this.lineNumberMap.get(lineNumber);
        if (!lineObjects) {
            return; // No visual representation for this line
        }

        // Update the color for specific vertices
        lineObjects.forEach(({ type, lineIndex, totalLines, startVertexIndex, endVertexIndex }) => {
            const completedColor = type === 'cutting'
                ? new THREE.Color(this.moveColors.completedCutting)
                : new THREE.Color(this.moveColors.completedRapid);

            if (type === 'cutting') {
                // Find the cutting Line object
                const cuttingLine = this.pathLines.find(line => line.userData.type === 'cutting');
                if (!cuttingLine || !cuttingLine.geometry.attributes.color) return;

                const colors = cuttingLine.geometry.attributes.color.array;

                // Calculate which vertices belong to this specific line number
                const segmentVertexCount = endVertexIndex - startVertexIndex;
                const verticesPerLine = segmentVertexCount / totalLines;

                const lineStartIdx = startVertexIndex + Math.floor(lineIndex * verticesPerLine);
                const lineEndIdx = startVertexIndex + Math.floor((lineIndex + 1) * verticesPerLine);

                // Update vertex colors for this line's vertices
                for (let i = lineStartIdx; i < Math.min(lineEndIdx, endVertexIndex); i++) {
                    colors[i * 3] = completedColor.r;
                    colors[i * 3 + 1] = completedColor.g;
                    colors[i * 3 + 2] = completedColor.b;
                }

                // Mark the attribute as needing update
                cuttingLine.geometry.attributes.color.needsUpdate = true;
            } else {
                // For rapid moves, find the specific rapid line
                const rapidLine = this.pathLines.find(line =>
                    line.userData.type === 'rapid' &&
                    line.userData.lineNumbers &&
                    line.userData.lineNumbers.includes(lineNumber)
                );
                if (rapidLine) {
                    rapidLine.material.color.setHex(completedColor);
                    rapidLine.material.opacity = 0.3;
                }
            }
        });
    }

    /**
     * Mark multiple line numbers as completed (batch operation)
     * @param {number[]} lineNumbers - Array of G-code line numbers
     */
    markLinesCompleted(lineNumbers) {
        lineNumbers.forEach(lineNum => this.markLineCompleted(lineNum));
    }

    /**
     * Reset all completed lines to their original colors
     */
    resetCompletedLines() {
        this.completedLines.forEach(lineNumber => {
            const lineObjects = this.lineNumberMap.get(lineNumber);
            if (lineObjects) {
                lineObjects.forEach(({ originalColor, type, lineIndex, totalLines, startVertexIndex, endVertexIndex }) => {
                    if (type === 'cutting') {
                        // Find the cutting Line object
                        const cuttingLine = this.pathLines.find(line => line.userData.type === 'cutting');
                        if (!cuttingLine || !cuttingLine.geometry.attributes.color) return;

                        const colors = cuttingLine.geometry.attributes.color.array;
                        const color = new THREE.Color(originalColor);

                        // Calculate which vertices belong to this line number
                        const segmentVertexCount = endVertexIndex - startVertexIndex;
                        const verticesPerLine = segmentVertexCount / totalLines;

                        const lineStartIdx = startVertexIndex + Math.floor(lineIndex * verticesPerLine);
                        const lineEndIdx = startVertexIndex + Math.floor((lineIndex + 1) * verticesPerLine);

                        // Reset vertex colors for this line's vertices
                        for (let i = lineStartIdx; i < Math.min(lineEndIdx, endVertexIndex); i++) {
                            colors[i * 3] = color.r;
                            colors[i * 3 + 1] = color.g;
                            colors[i * 3 + 2] = color.b;
                        }

                        cuttingLine.geometry.attributes.color.needsUpdate = true;
                    } else {
                        // For rapid moves, find the specific rapid line
                        const rapidLine = this.pathLines.find(line =>
                            line.userData.type === 'rapid' &&
                            line.userData.lineNumbers &&
                            line.userData.lineNumbers.includes(lineNumber)
                        );
                        if (rapidLine) {
                            rapidLine.material.color.setHex(originalColor);
                            rapidLine.material.opacity = 0.6;
                        }
                    }
                });
            }
        });
        this.completedLines.clear();
    }
}

export default GCodeVisualizer;

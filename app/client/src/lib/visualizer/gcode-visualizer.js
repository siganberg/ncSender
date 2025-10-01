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
            completedRapid: 0x666666,  // Completed rapid - Gray
            completedCutting: 0x888888  // Completed cutting - Lighter Gray
        };

        // Track line numbers for each path segment
        // Map structure: lineNumber -> [{ line: THREE.Line, originalColor: number }]
        this.lineNumberMap = new Map();

        // Set of completed line numbers for O(1) lookup
        this.completedLines = new Set();

        return this;
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
    }

    parseGCode(gcodeString) {
        const lines = gcodeString.split('\n');
        const toolpaths = { rapid: [], cutting: [] };
        let currentPosition = { x: 0, y: 0, z: 0 };
        let lastMoveType = null;
        let currentToolpath = [];
        let currentToolpathLineNumbers = [];
        let safeZ = 2;
        let isToolDown = false;

        lines.forEach((line, lineIndex) => {
            const lineNumber = lineIndex + 1; // 1-based line numbering
            const cleanLine = line.split(';')[0].trim().toUpperCase();
            if (!cleanLine) return;

            let moveType = lastMoveType;
            let newPosition = { ...currentPosition };
            let arcCenter = null;
            
            // Extract commands using regex
            const gMatch = cleanLine.match(/G(\d+)/);
            const xMatch = cleanLine.match(/X([-+]?\d*\.?\d+)/);
            const yMatch = cleanLine.match(/Y([-+]?\d*\.?\d+)/);
            const zMatch = cleanLine.match(/Z([-+]?\d*\.?\d+)/);
            const iMatch = cleanLine.match(/I([-+]?\d*\.?\d+)/);
            const jMatch = cleanLine.match(/J([-+]?\d*\.?\d+)/);
            const rMatch = cleanLine.match(/R([-+]?\d*\.?\d+)/);
            
            if (gMatch) {
                const gCode = parseInt(gMatch[1]);
                if ([0, 1, 2, 3].includes(gCode)) {
                    moveType = `G${gCode}`;
                    lastMoveType = moveType;
                }
            }
            
            if (xMatch) newPosition.x = parseFloat(xMatch[1]);
            if (yMatch) newPosition.y = parseFloat(yMatch[1]);
            if (zMatch) newPosition.z = parseFloat(zMatch[1]);
            
            // Arc parameters - handle both I/J and R formats
            if ((iMatch || jMatch) && (moveType === 'G2' || moveType === 'G3')) {
                arcCenter = {
                    i: iMatch ? parseFloat(iMatch[1]) : 0,
                    j: jMatch ? parseFloat(jMatch[1]) : 0
                };
            } else if (rMatch && (moveType === 'G2' || moveType === 'G3')) {
                // Convert R format to I/J format
                const radius = parseFloat(rMatch[1]);
                const dx = newPosition.x - currentPosition.x;
                const dy = newPosition.y - currentPosition.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance > 0) {
                    const h = Math.sqrt(radius * radius - (distance / 2) * (distance / 2));
                    const mx = (currentPosition.x + newPosition.x) / 2;
                    const my = (currentPosition.y + newPosition.y) / 2;
                    
                    // Choose the center based on clockwise/counter-clockwise and radius sign
                    const sign = (moveType === 'G2' && radius > 0) || (moveType === 'G3' && radius < 0) ? -1 : 1;
                    const centerX = mx + sign * h * (-dy / distance);
                    const centerY = my + sign * h * (dx / distance);
                    
                    arcCenter = {
                        i: centerX - currentPosition.x,
                        j: centerY - currentPosition.y
                    };
                }
            }

            const hasMovement = (
                newPosition.x !== currentPosition.x || 
                newPosition.y !== currentPosition.y || 
                newPosition.z !== currentPosition.z
            );

            if (hasMovement && moveType) {
                // Update tool down state
                if (zMatch) {
                    isToolDown = newPosition.z <= safeZ;
                }
                
                // Simplified logic: G2/G3 arcs are almost always cutting moves in CNC programs
                const isArcMove = (moveType === 'G2' || moveType === 'G3');
                const isCuttingMove = isArcMove ? 
                    true : // All arcs are cutting moves
                    (moveType !== 'G0' && isToolDown && currentPosition.z <= safeZ);
                const isRapidMove = (moveType === 'G0' && !isArcMove);
                
                
                if (isCuttingMove) {
                    if (currentToolpath.length === 0) {
                        currentToolpath.push({ ...currentPosition });
                    }

                    // Handle arcs differently
                    if ((moveType === 'G2' || moveType === 'G3') && arcCenter) {
                        const arcPoints = this.interpolateArc(
                            currentPosition,
                            newPosition,
                            arcCenter,
                            moveType === 'G2'
                        );
                        currentToolpath.push(...arcPoints);
                    } else {
                        currentToolpath.push({ ...newPosition });
                    }

                    // Track line number for this segment
                    currentToolpathLineNumbers.push(lineNumber);
                } else if (isRapidMove) {

                    // Finish current cutting path
                    if (currentToolpath.length > 1) {
                        toolpaths.cutting.push({
                            path: [...currentToolpath],
                            lineNumbers: [...currentToolpathLineNumbers]
                        });
                        currentToolpath = [];
                        currentToolpathLineNumbers = [];
                    }

                    // Add ALL rapid moves (including Z moves) with line number
                    toolpaths.rapid.push({
                        path: [
                            { ...currentPosition },
                            { ...newPosition }
                        ],
                        lineNumbers: [lineNumber]
                    });
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
        
        // Draw full circle if startAngle and endAngle are both zero
        if (startAngle === endAngle) {
            endAngle += (2 * Math.PI);
        }
        
        // Use Three.js ArcCurve like gSender does
        const arcCurve = new ArcCurve(
            centerX, // aX
            centerY, // aY
            radius, // aRadius
            startAngle, // aStartAngle
            endAngle, // aEndAngle
            clockwise // isClockwise
        );
        
        const divisions = 30; // Same as gSender
        const curvePoints = arcCurve.getPoints(divisions);
        
        // Convert Three.js Vector2 points to our format and interpolate Z
        for (let i = 0; i < curvePoints.length; i++) {
            const point = curvePoints[i];
            const z = ((end.z - start.z) / curvePoints.length) * i + start.z;
            points.push({ x: point.x, y: point.y, z: z });
        }
        
        return points;
    }

    render(gcodeString) {
        this.clear();

        if (!gcodeString) return;

        const toolpaths = this.parseGCode(gcodeString);

        // Render cutting toolpaths (continuous lines)
        toolpaths.cutting.forEach((segment, index) => {
            if (segment.path.length < 2) return;

            const points = segment.path.map(point => new THREE.Vector3(point.x, point.y, point.z));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);

            const material = new THREE.LineBasicMaterial({
                color: this.moveColors.cutting, // Cutting color
                transparent: true,
                opacity: 0.9,
                linewidth: 2
            });

            const line = new THREE.Line(geometry, material);
            line.userData = {
                type: 'cutting',
                pathIndex: index,
                lineNumbers: segment.lineNumbers,
                originalColor: this.moveColors.cutting
            };
            line.name = `cutting-path-${index}`;
            line.renderOrder = 1; // Ensure lines render on top

            this.pathLines.push(line);
            this.group.add(line);

            // Map line numbers to this THREE.Line object
            segment.lineNumbers.forEach(lineNum => {
                if (!this.lineNumberMap.has(lineNum)) {
                    this.lineNumberMap.set(lineNum, []);
                }
                this.lineNumberMap.get(lineNum).push({
                    line: line,
                    originalColor: this.moveColors.cutting,
                    type: 'cutting'
                });
            });
        });

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
        console.log('markLineCompleted called for line:', lineNumber);

        if (this.completedLines.has(lineNumber)) {
            console.log('Line already marked as completed:', lineNumber);
            return; // Already marked as completed
        }

        this.completedLines.add(lineNumber);

        // Get all THREE.Line objects associated with this line number
        const lineObjects = this.lineNumberMap.get(lineNumber);
        console.log('Line objects for line', lineNumber, ':', lineObjects);

        if (!lineObjects) {
            console.log('No visual representation for line:', lineNumber);
            console.log('Available line numbers:', Array.from(this.lineNumberMap.keys()).slice(0, 20));
            return; // No visual representation for this line
        }

        // Update the color of each line segment
        lineObjects.forEach(({ line, type }) => {
            const completedColor = type === 'cutting'
                ? this.moveColors.completedCutting
                : this.moveColors.completedRapid;

            console.log('Setting line', lineNumber, 'to color:', completedColor.toString(16));
            line.material.color.setHex(completedColor);
            line.material.opacity = 0.3; // Make completed lines more transparent
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
                lineObjects.forEach(({ line, originalColor, type }) => {
                    line.material.color.setHex(originalColor);
                    line.material.opacity = type === 'cutting' ? 0.9 : 0.6;
                });
            }
        });
        this.completedLines.clear();
    }
}

export default GCodeVisualizer;
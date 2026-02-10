// Moved into toolpath feature (verticalization).
import * as THREE from 'three';
import { ArcCurve } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

class GCodeVisualizer {
    constructor() {
        this.group = new THREE.Group();
        this.pathLines = [];

        // G-code movement types colors
        this.moveColors = {
            rapid: 0x00ff66,  // Rapid moves (dark theme default)
            cutting: 0x3e85c7,  // Cutting moves - Light Blue (fallback)
            completedRapid: 0x333333,  // Completed rapid - Dark Gray
            completedCutting: 0x444444,  // Completed cutting - Dark Gray
            outOfBounds: 0xcc5555,  // Out of bounds - Muted Red
            selected: 0xff6600  // Selected lines - Orange (works on both themes)
        };

        // Tool-based colors (generated dynamically)
        this.toolColors = new Map(); // toolNumber -> color hex
        this.toolsUsed = new Set(); // Set of tool numbers used in program
        this.toolOrder = []; // Array of tool numbers in order of first appearance
        this.toolVisibility = new Map(); // toolNumber -> boolean (visible/hidden)

        // Grid boundaries (set via setGridBounds)
        this.gridBounds = null; // { minX, maxX, minY, maxY, minZ?, maxZ? }

        // Work offset for G28 calculations (set via setWorkOffset)
        this.workOffset = { x: 0, y: 0, z: 0 };

        // Store current G-code for re-rendering
        this.currentGCode = null;

        // Visibility flags for shader
        this.showRapid = true;
        this.showCutting = true;

        // Track line numbers for completion marking and original move type per line
        this.lineNumberMap = new Map(); // lineNumber -> { startVertexIdx, endVertexIdx }
        this.lineMoveType = new Map();  // lineNumber -> 'rapid' | 'cutting'
        this.lineToolNumber = new Map(); // lineNumber -> tool number (for cutting moves)
        this.completedLines = new Set();
        this.selectedLines = new Set(); // Track currently selected lines for highlighting
        this.highlightLine = null; // Separate line object for selection glow effect

        // Track which axes have any out-of-bounds vertices
        this._outOfBoundsAxes = new Set(); // subset of ['X','Y','Z']
        // Track which directions are out-of-bounds (e.g., 'X+', 'X-', 'Y+', 'Y-', 'Z+', 'Z-')
        this._outOfBoundsDirections = new Set();

        return this;
    }

    // Get the original color for a line based on its tool (both rapid and cutting use tool color)
    getLineColor(lineNumber) {
        const moveType = this.lineMoveType.get(lineNumber) || 'cutting';
        const toolNum = this.lineToolNumber.get(lineNumber);

        // Use tool-specific color for all moves if tool is known
        if (toolNum !== undefined && this.toolColors.has(toolNum)) {
            return new THREE.Color(this.toolColors.get(toolNum));
        }

        // Fallback to move-type specific colors if no tool
        if (moveType === 'rapid') {
            return new THREE.Color(this.moveColors.rapid);
        }
        return new THREE.Color(this.moveColors.cutting);
    }

    // Predefined color palette for tools (up to 16 tools)
    getToolColorPalette() {
        return [
            0x3e85c7,  // T1  - Blue (default cutting color)
            0xffa500,  // T2  - Orange
            0x4ecdc4,  // T3  - Cyan
            0xffe66d,  // T4  - Yellow
            0x95e1d3,  // T5  - Mint
            0xaa96da,  // T6  - Purple
            0xfcbad3,  // T7  - Pink
            0xa8e6cf,  // T8  - Light Green
            0xffd3b6,  // T9  - Peach
            0xc7ceea,  // T10 - Lavender
            0xb4f8c8,  // T11 - Pastel Green
            0xfbe7c6,  // T12 - Cream
            0xa0e7e5,  // T13 - Aqua
            0xdda15e,  // T14 - Bronze
            0x9d84b7,  // T15 - Violet
            0x81b29a   // T16 - Sage Green
        ];
    }

    // Get color for a specific tool number
    generateToolColor(toolNumber, totalTools) {
        const palette = this.getToolColorPalette();

        // Use predefined color if within palette range
        if (toolNumber > 0 && toolNumber <= palette.length) {
            return palette[toolNumber - 1];
        }

        // For tools beyond T16, generate colors using HSL
        const hue = ((toolNumber - 1) % 360);
        const saturation = 70;
        const lightness = 55;

        // Convert HSL to RGB
        const h = hue / 360;
        const s = saturation / 100;
        const l = lightness / 100;

        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
        const g = Math.round(hue2rgb(p, q, h) * 255);
        const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);

        return (r << 16) | (g << 8) | b;
    }

    clear() {
        this.pathLines.forEach(line => {
            this.group.remove(line);
        });
        this.pathLines = [];
        this.lineNumberMap.clear();
        this.lineToolNumber.clear();
        this.completedLines.clear();
        // Clean up highlight line
        if (this.highlightLine) {
            this.group.remove(this.highlightLine);
            this.highlightLine.geometry.dispose();
            this.highlightLine.material.dispose();
            this.highlightLine = null;
        }
        this.selectedLines.clear();
    }

    setGridBounds(gridBounds) {
        this.gridBounds = gridBounds;

        // Recompute out-of-bounds and recolor in-place to preserve completed coloring
        this.updateOutOfBoundsColors();
    }

    setWorkOffset(workOffset) {
        this.workOffset = workOffset || { x: 0, y: 0, z: 0 };
    }

    _axisOutOfBounds(x, y, z) {
        if (!this.gridBounds) return { x: false, y: false, z: false };
        const { minX, maxX, minY, maxY, minZ, maxZ } = this.gridBounds;
        const eps = 0.001; // Small tolerance for floating point comparisons
        const xOob = (typeof minX === 'number' && x < minX - eps) || (typeof maxX === 'number' && x > maxX + eps);
        const yOob = (typeof minY === 'number' && y < minY - eps) || (typeof maxY === 'number' && y > maxY + eps);
        const zOob = (typeof minZ === 'number' && z < minZ - eps) || (typeof maxZ === 'number' && z > maxZ + eps);
        return { x: !!xOob, y: !!yOob, z: !!zOob };
    }

    isPointOutOfBounds(x, y, z) {
        const a = this._axisOutOfBounds(x, y, z);
        return a.x || a.y || a.z;
    }

    hasOutOfBoundsMovement() {
        return this.hasOutOfBounds || false;
    }

    parseGCode(gcodeString) {
        const lines = gcodeString.split('\n');
        const vertices = []; // Flat array of x,y,z coordinates
        const colors = []; // Flat array of r,g,b values
        const frames = []; // Line number to vertex index mapping (start vertex)

        let currentPos = { x: 0, y: 0, z: 0 };
        let lastMoveType = null;
        let unitScale = 1; // Track unit conversion: 1 for mm (G21), 25.4 for inches (G20)
        let hasOutOfBounds = false; // Track if any points are out of bounds
        let currentTool = null; // Track active tool number

        // Reset tracking
        this._outOfBoundsAxes.clear();
        this._outOfBoundsDirections.clear();
        this.toolsUsed.clear();
        this.toolColors.clear();
        this.toolOrder = [];

        // First pass: identify all tools used in the program in order of first appearance
        // Only consider actual tool change commands (T followed by M6), not tool refs in comments
        lines.forEach(line => {
            // Strip parenthetical comments and semicolon comments
            const cleanLine = line.replace(/\((?:[^)]*)\)/g, '').replace(/;.*$/, '').trim().toUpperCase();
            // Only detect tools on M6 (tool change) lines to avoid false positives
            if (/\bM0?6\b/.test(cleanLine)) {
                const tMatch = cleanLine.match(/\bT(\d+)\b/);
                if (tMatch) {
                    const toolNum = parseInt(tMatch[1]);
                    if (!this.toolOrder.includes(toolNum)) {
                        this.toolOrder.push(toolNum);
                    }
                }
            }
        });

        // Generate colors for each tool based on its position in the program (not the tool number)
        // This ensures tools T42, T51, T87 get distinct colors (1st, 2nd, 3rd palette colors)
        // instead of similar colors based on their high tool numbers
        this.toolOrder.forEach((toolNum, index) => {
            // Use index+1 as the "virtual tool number" for color selection
            // This maps the first tool in the program to palette[0], second to palette[1], etc.
            const color = this.generateToolColor(index + 1, this.toolOrder.length);
            this.toolColors.set(toolNum, color);
            this.toolsUsed.add(toolNum);
            // Initialize visibility to true (shown by default)
            if (!this.toolVisibility.has(toolNum)) {
                this.toolVisibility.set(toolNum, true);
            }
        });

        const rapidColor = new THREE.Color(this.moveColors.rapid);
        const cuttingColor = new THREE.Color(this.moveColors.cutting);
        const outOfBoundsColor = new THREE.Color(this.moveColors.outOfBounds);

        lines.forEach((line, lineIndex) => {
            const lineNumber = lineIndex + 1;
            const cleanLine = line.split(';')[0].trim().toUpperCase();
            if (!cleanLine) return;

            // Track vertex index and actual line number for this (source) line
            frames.push({ lineNumber, vertexIdx: vertices.length / 3 });

            // Skip comment lines (parentheses comments may contain X/Y/Z values that aren't moves)
            if (cleanLine.startsWith('(')) {
                return;
            }

            // Skip G53 moves (machine coordinates) - cannot visualize in workpiece coordinates
            if (cleanLine.includes('G53')) {
                return;
            }

            if (cleanLine.includes('G28')) {
                const hasZ = /\bZ/.test(cleanLine);
                if (!hasZ) return;

                const homeZ = this.gridBounds?.maxZ ?? 0;

                if (homeZ !== currentPos.z) {
                    this.lineMoveType.set(lineNumber, 'rapid');
                    if (currentTool !== null) {
                        this.lineToolNumber.set(lineNumber, currentTool);
                    }

                    const color = (currentTool !== null && this.toolColors.has(currentTool))
                        ? new THREE.Color(this.toolColors.get(currentTool))
                        : rapidColor;

                    vertices.push(currentPos.x, currentPos.y, currentPos.z);
                    vertices.push(currentPos.x, currentPos.y, homeZ);
                    colors.push(color.r, color.g, color.b);
                    colors.push(color.r, color.g, color.b);

                    currentPos.z = homeZ;
                }
                return;
            }

            // Parse G-code
            const gMatch = cleanLine.match(/G(\d+)/g); // Match all G codes on the line
            const xMatch = cleanLine.match(/X([-+]?\d*\.?\d+)/);
            const yMatch = cleanLine.match(/Y([-+]?\d*\.?\d+)/);
            const zMatch = cleanLine.match(/Z([-+]?\d*\.?\d+)/);
            const iMatch = cleanLine.match(/I([-+]?\d*\.?\d+)/);
            const jMatch = cleanLine.match(/J([-+]?\d*\.?\d+)/);
            const tMatch = cleanLine.match(/\bT(\d+)\b/);

            // Track tool changes
            if (tMatch) {
                currentTool = parseInt(tMatch[1]);
            }

            if (gMatch) {
                gMatch.forEach(g => {
                    const gCode = parseInt(g.substring(1));
                    // Track unit mode
                    if (gCode === 20) {
                        unitScale = 25.4; // G20 = inches, convert to mm
                    } else if (gCode === 21) {
                        unitScale = 1; // G21 = mm
                    }
                    // Track movement type
                    if ([0, 1, 2, 3].includes(gCode)) {
                        lastMoveType = gCode;
                    }
                });
            }

            const newPos = { ...currentPos };
            if (xMatch) newPos.x = parseFloat(xMatch[1]) * unitScale;
            if (yMatch) newPos.y = parseFloat(yMatch[1]) * unitScale;
            if (zMatch) newPos.z = parseFloat(zMatch[1]) * unitScale;

            const hasMovement = (
                newPos.x !== currentPos.x ||
                newPos.y !== currentPos.y ||
                newPos.z !== currentPos.z
            );

            if (hasMovement && lastMoveType !== null) {
                const isRapid = lastMoveType === 0;
                // Record original move type for this line number
                this.lineMoveType.set(lineNumber, isRapid ? 'rapid' : 'cutting');
                // Record tool number for all moves (both rapid and cutting)
                if (currentTool !== null) {
                    this.lineToolNumber.set(lineNumber, currentTool);
                }

                // Check if move is out of bounds
                const oob1 = this._axisOutOfBounds(currentPos.x, currentPos.y, currentPos.z);
                const oob2 = this._axisOutOfBounds(newPos.x, newPos.y, newPos.z);
                const isOutOfBounds = (oob1.x||oob1.y||oob1.z) || (oob2.x||oob2.y||oob2.z);

                if (isOutOfBounds) hasOutOfBounds = true;
                if (oob1.x || oob2.x) this._outOfBoundsAxes.add('X');
                if (oob1.y || oob2.y) this._outOfBoundsAxes.add('Y');
                if (oob1.z || oob2.z) this._outOfBoundsAxes.add('Z');

                // Determine color based on tool (both rapid and cutting use same tool color)
                let color;
                if (isOutOfBounds) {
                    color = outOfBoundsColor;
                } else {
                    // Use tool-based color for all moves (rapid and cutting) if tool is known
                    if (currentTool !== null && this.toolColors.has(currentTool)) {
                        color = new THREE.Color(this.toolColors.get(currentTool));
                    } else if (isRapid) {
                        color = rapidColor; // Fallback to rapid color if no tool
                    } else {
                        color = cuttingColor; // Fallback to cutting color if no tool
                    }
                }

                if (lastMoveType === 2 || lastMoveType === 3) {
                    // Arc move
                    const i = iMatch ? parseFloat(iMatch[1]) * unitScale : 0;
                    const j = jMatch ? parseFloat(jMatch[1]) * unitScale : 0;

                    const centerX = currentPos.x + i;
                    const centerY = currentPos.y + j;
                    const radius = Math.sqrt(i * i + j * j);
                    const startAngle = Math.atan2(currentPos.y - centerY, currentPos.x - centerX);
                    const endAngle = Math.atan2(newPos.y - centerY, newPos.x - centerX);

                    const arcCurve = new ArcCurve(
                        centerX,
                        centerY,
                        radius,
                        startAngle,
                        endAngle,
                        lastMoveType === 2 // G2 = clockwise
                    );

                    const points = arcCurve.getPoints(30);

                    // Add arc as connected line segment pairs for THREE.LineSegments
                    for (let i = 0; i < points.length - 1; i++) {
                        const point1 = points[i];
                        const point2 = points[i + 1];
                        const z1 = currentPos.z + (newPos.z - currentPos.z) * (i / (points.length - 1));
                        const z2 = currentPos.z + (newPos.z - currentPos.z) * ((i + 1) / (points.length - 1));

                        // Push as pair for LineSegments
                        vertices.push(point1.x, point1.y, z1);
                        vertices.push(point2.x, point2.y, z2);
                        colors.push(color.r, color.g, color.b);
                        colors.push(color.r, color.g, color.b);
                    }
                } else {
                    // Linear move - add as pair
                    vertices.push(currentPos.x, currentPos.y, currentPos.z);
                    vertices.push(newPos.x, newPos.y, newPos.z);

                    colors.push(color.r, color.g, color.b);
                    colors.push(color.r, color.g, color.b);
                }

                currentPos = newPos;
            }
        });

        return { vertices, colors, frames, hasOutOfBounds };
    }

    render(gcodeString) {
        this.clear();

        if (!gcodeString) return;

        // Store G-code for re-rendering when bounds change
        this.currentGCode = gcodeString;

        // Reset per-line maps for fresh render
        this.lineNumberMap.clear();
        this.lineMoveType.clear();
        this.lineToolNumber.clear();

        const { vertices, colors, frames, hasOutOfBounds } = this.parseGCode(gcodeString);

        // Store out of bounds status
        this.hasOutOfBounds = hasOutOfBounds;

        if (vertices.length === 0) return;

        // Create single line with all vertices
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        // Custom shader material that can hide vertices by color
        const material = new THREE.ShaderMaterial({
            vertexShader: `
                attribute vec3 color;
                varying vec3 vColor;

                void main() {
                    vColor = color;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 rapidColor;
                uniform vec3 outOfBoundsColor;
                uniform bool showRapid;
                uniform bool showCutting;
                uniform float opacity;

                varying vec3 vColor;

                void main() {
                    // Discard hidden tools (black color = hidden)
                    if (length(vColor) < 0.01) discard;

                    // Calculate distance from vertex color to rapid and out-of-bounds colors
                    float distToRapid = distance(vColor, rapidColor);
                    float distToOutOfBounds = distance(vColor, outOfBoundsColor);

                    // Determine color group (with tolerance)
                    bool isRapid = distToRapid < 0.1;
                    bool isOutOfBounds = distToOutOfBounds < 0.1;
                    // Anything that's not rapid or out-of-bounds is a cutting move (tool-based color)
                    bool isCutting = !isRapid && !isOutOfBounds;

                    // Discard fragment if its color group is hidden
                    if (isRapid && !showRapid) discard;
                    if (isCutting && !showCutting) discard;

                    gl_FragColor = vec4(vColor, opacity);
                }
            `,
            uniforms: {
                rapidColor: { value: new THREE.Color(this.moveColors.rapid) },
                outOfBoundsColor: { value: new THREE.Color(this.moveColors.outOfBounds) },
                showRapid: { value: this.showRapid },
                showCutting: { value: this.showCutting },
                opacity: { value: 0.9 }
            },
            transparent: true,
            depthTest: false
        });

        const line = new THREE.Line(geometry, material);
        line.name = 'gcode-toolpath';
        line.renderOrder = 999;

        this.pathLines.push(line);
        this.group.add(line);

        // Store frames for line number tracking (compute end indices for quick access)
        // frames is an array of { lineNumber, vertexIdx } objects
        this.frames = frames;
        this.lineNumberMap.clear();
        for (let i = 0; i < frames.length; i++) {
            const { lineNumber, vertexIdx: startVertexIdx } = frames[i];
            const endVertexIdx = i < frames.length - 1 ? frames[i + 1].vertexIdx : geometry.attributes.position.count;
            this.lineNumberMap.set(lineNumber, { startVertexIdx, endVertexIdx });
        }

        // Calculate bounds
        const box = new THREE.Box3().setFromObject(this.group);
        this.bounds = {
            min: box.min,
            max: box.max,
            center: box.getCenter(new THREE.Vector3()),
            size: box.getSize(new THREE.Vector3())
        };

        // Ensure OOB recoloring and axis flags are consistent with current bounds
        this.updateOutOfBoundsColors();

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

    setMoveTypeVisibility(type, visible) {
        if (type === 'rapid') {
            this.showRapid = visible;
        } else if (type === 'cutting') {
            this.showCutting = visible;
        }

        // Update shader uniforms
        this.pathLines.forEach(line => {
            if (line.material.uniforms) {
                line.material.uniforms.showRapid.value = this.showRapid;
                line.material.uniforms.showCutting.value = this.showCutting;
            }
        });
    }

    setCuttingVisibility(visible) {
        this.setMoveTypeVisibility('cutting', visible);
    }

    setRapidVisibility(visible) {
        this.setMoveTypeVisibility('rapid', visible);
    }

    // Update rapid color and recolor existing geometry based on new palette
    setRapidColor(hex) {
        if (!hex) return;
        this.moveColors.rapid = hex;
        // Update shader uniform reference color (used for visibility masking)
        this.pathLines.forEach(line => {
            if (line.material && line.material.uniforms && line.material.uniforms.rapidColor) {
                line.material.uniforms.rapidColor.value = new THREE.Color(hex);
            }
        });
        // Recompute colors for all vertices based on new palette
        this.updateOutOfBoundsColors();
    }

    markLineCompleted(lineNumber) {
        if (this.completedLines.has(lineNumber)) {
            return; // Already marked
        }

        this.completedLines.add(lineNumber);

        // Find the line object
        const line = this.pathLines[0];
        if (!line || !line.geometry.attributes.color) return;

        // Get the vertex index range for this line number
        const range = this.lineNumberMap.get(lineNumber);
        if (!range) return;
        const { startVertexIdx, endVertexIdx } = range;

        // Update colors for this line's vertices
        const colors = line.geometry.attributes.color.array;
        const moveType = this.lineMoveType.get(lineNumber) || 'cutting';
        const completedColor = new THREE.Color(
            moveType === 'rapid' ? this.moveColors.completedRapid : this.moveColors.completedCutting
        );

        for (let i = startVertexIdx; i < endVertexIdx; i++) {
            colors[i * 3] = completedColor.r;
            colors[i * 3 + 1] = completedColor.g;
            colors[i * 3 + 2] = completedColor.b;
        }

        line.geometry.attributes.color.needsUpdate = true;
    }

    markLinesCompleted(lineNumbers) {
        lineNumbers.forEach(lineNum => this.markLineCompleted(lineNum));
    }

    resetCompletedLines() {
        const line = this.pathLines[0];
        if (!line || !line.geometry.attributes.color) return;

        // Reset all previously completed vertices to their original colors
        const colors = line.geometry.attributes.color.array;

        this.completedLines.forEach(lineNumber => {
            const range = this.lineNumberMap.get(lineNumber);
            if (!range) return;
            const { startVertexIdx, endVertexIdx } = range;
            const originalColor = this.getLineColor(lineNumber);
            for (let i = startVertexIdx; i < endVertexIdx; i++) {
                colors[i * 3] = originalColor.r;
                colors[i * 3 + 1] = originalColor.g;
                colors[i * 3 + 2] = originalColor.b;
            }
        });

        line.geometry.attributes.color.needsUpdate = true;
        this.completedLines.clear();
    }

    highlightSelectedLines(lineNumbers) {
        const mainLine = this.pathLines[0];
        if (!mainLine || !mainLine.geometry.attributes.position) return;

        // Remove existing highlight line
        if (this.highlightLine) {
            this.group.remove(this.highlightLine);
            this.highlightLine.geometry.dispose();
            this.highlightLine.material.dispose();
            this.highlightLine = null;
        }

        // Clear selection tracking
        this.selectedLines.clear();

        // Filter out completed lines and collect valid line numbers
        const validLineNumbers = lineNumbers.filter(ln => {
            if (this.completedLines.has(ln)) return false;
            if (!this.lineNumberMap.has(ln)) return false;
            return true;
        });

        if (validLineNumbers.length === 0) return;

        // Extract vertices for selected lines
        const mainPositions = mainLine.geometry.attributes.position.array;
        const highlightVertices = [];

        validLineNumbers.forEach(lineNumber => {
            const range = this.lineNumberMap.get(lineNumber);
            if (!range) return;

            const { startVertexIdx, endVertexIdx } = range;
            for (let i = startVertexIdx; i < endVertexIdx; i++) {
                highlightVertices.push(
                    mainPositions[i * 3],
                    mainPositions[i * 3 + 1],
                    mainPositions[i * 3 + 2]
                );
            }

            this.selectedLines.add(lineNumber);
        });

        if (highlightVertices.length < 2) return;

        // Create thick line using Line2
        const lineGeometry = new LineGeometry();
        lineGeometry.setPositions(highlightVertices);

        // Purple color material with thick line width
        const lineMaterial = new LineMaterial({
            color: 0xcc00ff,  // Bright purple - visible on both themes
            linewidth: 4,     // Thick line (in pixels)
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            worldUnits: false  // Use screen pixels for line width
        });

        // Set resolution for LineMaterial (required)
        lineMaterial.resolution.set(window.innerWidth, window.innerHeight);

        // Create and add highlight line
        this.highlightLine = new Line2(lineGeometry, lineMaterial);
        this.highlightLine.name = 'selection-highlight';
        this.highlightLine.renderOrder = 1000; // Render on top
        this.highlightLine.computeLineDistances();
        this.group.add(this.highlightLine);
    }

    clearSelectedLines() {
        if (this.highlightLine) {
            this.group.remove(this.highlightLine);
            this.highlightLine.geometry.dispose();
            this.highlightLine.material.dispose();
            this.highlightLine = null;
        }
        this.selectedLines.clear();
    }

    // Find line number from screen coordinates (for click/tap detection)
    // camera and renderer are required to project 3D to 2D
    getLineNumberFromScreenPoint(screenX, screenY, camera, rendererWidth, rendererHeight, tolerance = 10) {
        const line = this.pathLines[0];
        if (!line) return null;

        const positions = line.geometry.attributes.position.array;
        let closestLineNumber = null;
        let closestDistance = Infinity;
        let closestDepth = Infinity;

        const tempVec = new THREE.Vector3();

        // Ensure group's world matrix is up to date (needed for Spindle View mode offset)
        this.group.updateMatrixWorld(true);

        // Project a 3D point to normalized screen coordinates (-1 to 1)
        // Apply group's world transform to account for Spindle View mode offset
        const projectToScreen = (x, y, z) => {
            tempVec.set(x, y, z);
            // Transform from local to world coordinates
            tempVec.applyMatrix4(this.group.matrixWorld);
            tempVec.project(camera);
            return {
                x: (tempVec.x + 1) / 2 * rendererWidth,
                y: (-tempVec.y + 1) / 2 * rendererHeight,
                z: tempVec.z // depth for sorting
            };
        };

        // Check each line segment
        for (const [lineNumber, range] of this.lineNumberMap.entries()) {
            const { startVertexIdx, endVertexIdx } = range;

            // Skip lines with no vertices
            if (startVertexIdx >= endVertexIdx) continue;

            // Check distance to each segment in this line
            for (let i = startVertexIdx; i < endVertexIdx - 1; i++) {
                const p1 = projectToScreen(
                    positions[i * 3],
                    positions[i * 3 + 1],
                    positions[i * 3 + 2]
                );
                const p2 = projectToScreen(
                    positions[(i + 1) * 3],
                    positions[(i + 1) * 3 + 1],
                    positions[(i + 1) * 3 + 2]
                );

                // Calculate 2D distance from click to line segment
                const dist = this._pointToSegmentDistance2D(screenX, screenY, p1.x, p1.y, p2.x, p2.y);

                // Use depth (z) as tiebreaker - smaller z is closer to camera
                const segmentDepth = Math.min(p1.z, p2.z);

                if (dist < tolerance) {
                    // If same distance (within epsilon), prefer closer to camera
                    if (dist < closestDistance - 0.5 ||
                        (Math.abs(dist - closestDistance) < 0.5 && segmentDepth < closestDepth)) {
                        closestDistance = dist;
                        closestDepth = segmentDepth;
                        closestLineNumber = lineNumber;
                    }
                }
            }
        }

        return closestLineNumber;
    }

    // Calculate distance from point to line segment in 2D
    _pointToSegmentDistance2D(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) {
            return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        }

        let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));

        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;

        return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
    }

    updateOutOfBoundsColors() {
        try {
            const line = this.pathLines[0];
            if (!line) return;

            const posAttr = line.geometry?.attributes?.position;
            const colorAttr = line.geometry?.attributes?.color;
            if (!posAttr || !colorAttr) return;

            const colors = colorAttr.array;
            const positions = posAttr.array;
            const completedRapid = new THREE.Color(this.moveColors.completedRapid);
            const completedCutting = new THREE.Color(this.moveColors.completedCutting);
            const oobColor = new THREE.Color(this.moveColors.outOfBounds);

            let anyOob = false;
            const axes = new Set();
            const dirs = new Set();

            // Iterate by line ranges for efficiency
            for (const [lineNumber, range] of this.lineNumberMap.entries()) {
                const { startVertexIdx, endVertexIdx } = range;
                const moveType = this.lineMoveType.get(lineNumber) || 'cutting';
                const isCompleted = this.completedLines.has(lineNumber);

                const baseCompleted = moveType === 'rapid' ? completedRapid : completedCutting;
                const baseActive = this.getLineColor(lineNumber);

                for (let i = startVertexIdx; i < endVertexIdx; i++) {
                    const x = positions[i * 3];
                    const y = positions[i * 3 + 1];
                    const z = positions[i * 3 + 2];

                    let c;
                    if (isCompleted) {
                        // Completed has priority over OOB
                        c = baseCompleted;
                    } else if (this.gridBounds && this.isPointOutOfBounds(x, y, z)) {
                        c = oobColor;
                        anyOob = true;
                        const a = this._axisOutOfBounds(x, y, z);
                        if (a.x) axes.add('X');
                        if (a.y) axes.add('Y');
                        if (a.z) axes.add('Z');

                        // Track directions
                        const { minX, maxX, minY, maxY, minZ, maxZ } = this.gridBounds || {};
                        if (typeof minX === 'number' && x < minX) dirs.add('X-');
                        if (typeof maxX === 'number' && x > maxX) dirs.add('X+');
                        if (typeof minY === 'number' && y < minY) dirs.add('Y-');
                        if (typeof maxY === 'number' && y > maxY) dirs.add('Y+');
                        if (typeof minZ === 'number' && z < minZ) dirs.add('Z-');
                        if (typeof maxZ === 'number' && z > maxZ) dirs.add('Z+');
                    } else {
                        c = baseActive;
                    }

                    colors[i * 3] = c.r;
                    colors[i * 3 + 1] = c.g;
                    colors[i * 3 + 2] = c.b;
                }
            }

            colorAttr.needsUpdate = true;
            this.hasOutOfBounds = anyOob;
            this._outOfBoundsAxes = axes;
            this._outOfBoundsDirections = dirs;
        } catch {
            // ignore coloring failures to avoid disrupting rendering
        }
    }

    getMoveTypeVisibility() {
        return {
            cutting: true,
            rapid: true
        };
    }

    // Get all tools used in the program with their colors and visibility
    // Returns tools in order of first appearance in the G-code
    getToolsInfo() {
        return this.toolOrder.map(toolNum => ({
            number: toolNum,
            color: this.toolColors.get(toolNum),
            visible: this.toolVisibility.get(toolNum) !== false
        }));
    }

    // Toggle visibility for a specific tool
    setToolVisibility(toolNumber, visible) {
        this.toolVisibility.set(toolNumber, visible);
        this.updateVertexVisibility();
    }

    // Update vertex colors based on tool visibility
    updateVertexVisibility() {
        const line = this.pathLines[0];
        if (!line || !line.geometry.attributes.color) return;

        const colors = line.geometry.attributes.color.array;
        const positions = line.geometry.attributes.position.array;
        const completedRapid = new THREE.Color(this.moveColors.completedRapid);
        const completedCutting = new THREE.Color(this.moveColors.completedCutting);
        const oobColor = new THREE.Color(this.moveColors.outOfBounds);

        // Iterate through all lines and update colors based on visibility
        for (const [lineNumber, range] of this.lineNumberMap.entries()) {
            const { startVertexIdx, endVertexIdx } = range;
            const toolNum = this.lineToolNumber.get(lineNumber);
            const isCompleted = this.completedLines.has(lineNumber);
            const moveType = this.lineMoveType.get(lineNumber) || 'cutting';

            // Check if this line's tool is hidden
            const isToolHidden = toolNum !== undefined && this.toolVisibility.get(toolNum) === false;

            for (let i = startVertexIdx; i < endVertexIdx; i++) {
                let c;

                if (isToolHidden) {
                    // Make vertices transparent/invisible by setting alpha to 0 in fragment shader
                    // For now, we'll use a very dark gray to indicate hidden
                    c = new THREE.Color(0x000000);
                } else {
                    const x = positions[i * 3];
                    const y = positions[i * 3 + 1];
                    const z = positions[i * 3 + 2];

                    if (isCompleted) {
                        c = moveType === 'rapid' ? completedRapid : completedCutting;
                    } else if (this.gridBounds && this.isPointOutOfBounds(x, y, z)) {
                        c = oobColor;
                    } else {
                        c = this.getLineColor(lineNumber);
                    }
                }

                colors[i * 3] = c.r;
                colors[i * 3 + 1] = c.g;
                colors[i * 3 + 2] = c.b;
            }
        }

        line.geometry.attributes.color.needsUpdate = true;
    }

    getOutOfBoundsAxes() {
        return Array.from(this._outOfBoundsAxes);
    }

    getOutOfBoundsDirections() {
        return Array.from(this._outOfBoundsDirections);
    }
}

export default GCodeVisualizer;

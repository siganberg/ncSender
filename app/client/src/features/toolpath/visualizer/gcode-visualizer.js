// Moved into toolpath feature (verticalization).
import * as THREE from 'three';
import { ArcCurve } from 'three';

class GCodeVisualizer {
    constructor() {
        this.group = new THREE.Group();
        this.pathLines = [];

        // G-code movement types colors
        this.moveColors = {
            rapid: 0x00ff66,  // Rapid moves (dark theme default)
            cutting: 0x3e85c7,  // Cutting moves - Light Blue
            completedRapid: 0x333333,  // Completed rapid - Dark Gray
            completedCutting: 0x444444,  // Completed cutting - Dark Gray
            outOfBounds: 0xcc5555  // Out of bounds - Muted Red
        };

        // Grid boundaries (set via setGridBounds)
        this.gridBounds = null; // { minX, maxX, minY, maxY, minZ?, maxZ? }

        // Store current G-code for re-rendering
        this.currentGCode = null;

        // Visibility flags for shader
        this.showRapid = true;
        this.showCutting = true;

        // Track line numbers for completion marking and original move type per line
        this.lineNumberMap = new Map(); // lineNumber -> { startVertexIdx, endVertexIdx }
        this.lineMoveType = new Map();  // lineNumber -> 'rapid' | 'cutting'
        this.completedLines = new Set();

        // Track which axes have any out-of-bounds vertices
        this._outOfBoundsAxes = new Set(); // subset of ['X','Y','Z']
        // Track which directions are out-of-bounds (e.g., 'X+', 'X-', 'Y+', 'Y-', 'Z+', 'Z-')
        this._outOfBoundsDirections = new Set();

        return this;
    }

    clear() {
        this.pathLines.forEach(line => {
            this.group.remove(line);
        });
        this.pathLines = [];
        this.lineNumberMap.clear();
        this.completedLines.clear();
    }

    setGridBounds(gridBounds) {
        this.gridBounds = gridBounds;

        // Recompute out-of-bounds and recolor in-place to preserve completed coloring
        this.updateOutOfBoundsColors();
    }

    _axisOutOfBounds(x, y, z) {
        if (!this.gridBounds) return { x: false, y: false, z: false };
        const { minX, maxX, minY, maxY, minZ, maxZ } = this.gridBounds;
        const xOob = (typeof minX === 'number' && x < minX) || (typeof maxX === 'number' && x > maxX);
        const yOob = (typeof minY === 'number' && y < minY) || (typeof maxY === 'number' && y > maxY);
        const zOob = (typeof minZ === 'number' && z < minZ) || (typeof maxZ === 'number' && z > maxZ);
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
        let hasOutOfBounds = false; // Track if any points are out of bounds
        // Reset axes tracking for fresh parse
        this._outOfBoundsAxes.clear();
        this._outOfBoundsDirections.clear();

        const rapidColor = new THREE.Color(this.moveColors.rapid);
        const cuttingColor = new THREE.Color(this.moveColors.cutting);
        const outOfBoundsColor = new THREE.Color(this.moveColors.outOfBounds);

        lines.forEach((line, lineIndex) => {
            const lineNumber = lineIndex + 1;
            const cleanLine = line.split(';')[0].trim().toUpperCase();
            if (!cleanLine) return;

            // Track vertex index for this (source) line
            frames.push(vertices.length / 3);

            // Parse G-code
            const gMatch = cleanLine.match(/G(\d+)/);
            const xMatch = cleanLine.match(/X([-+]?\d*\.?\d+)/);
            const yMatch = cleanLine.match(/Y([-+]?\d*\.?\d+)/);
            const zMatch = cleanLine.match(/Z([-+]?\d*\.?\d+)/);
            const iMatch = cleanLine.match(/I([-+]?\d*\.?\d+)/);
            const jMatch = cleanLine.match(/J([-+]?\d*\.?\d+)/);

            if (gMatch) {
                const gCode = parseInt(gMatch[1]);
                if ([0, 1, 2, 3].includes(gCode)) {
                    lastMoveType = gCode;
                }
            }

            const newPos = { ...currentPos };
            if (xMatch) newPos.x = parseFloat(xMatch[1]);
            if (yMatch) newPos.y = parseFloat(yMatch[1]);
            if (zMatch) newPos.z = parseFloat(zMatch[1]);

            const hasMovement = (
                newPos.x !== currentPos.x ||
                newPos.y !== currentPos.y ||
                newPos.z !== currentPos.z
            );

            if (hasMovement && lastMoveType !== null) {
                const isRapid = lastMoveType === 0;
                // Record original move type for this line number
                this.lineMoveType.set(lineNumber, isRapid ? 'rapid' : 'cutting');

                // Check if move is out of bounds
                const oob1 = this._axisOutOfBounds(currentPos.x, currentPos.y, currentPos.z);
                const oob2 = this._axisOutOfBounds(newPos.x, newPos.y, newPos.z);
                const isOutOfBounds = (oob1.x||oob1.y||oob1.z) || (oob2.x||oob2.y||oob2.z);

                if (isOutOfBounds) hasOutOfBounds = true;
                if (oob1.x || oob2.x) this._outOfBoundsAxes.add('X');
                if (oob1.y || oob2.y) this._outOfBoundsAxes.add('Y');
                if (oob1.z || oob2.z) this._outOfBoundsAxes.add('Z');

                const color = isOutOfBounds ? outOfBoundsColor : (isRapid ? rapidColor : cuttingColor);

                if (lastMoveType === 2 || lastMoveType === 3) {
                    // Arc move
                    const i = iMatch ? parseFloat(iMatch[1]) : 0;
                    const j = jMatch ? parseFloat(jMatch[1]) : 0;

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

                    // Add arc as connected points
                    for (let i = 0; i < points.length; i++) {
                        const point = points[i];
                        const z = currentPos.z + (newPos.z - currentPos.z) * (i / (points.length - 1));

                        vertices.push(point.x, point.y, z);
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
                uniform vec3 cuttingColor;
                uniform bool showRapid;
                uniform bool showCutting;
                uniform float opacity;

                varying vec3 vColor;

                void main() {
                    // Calculate distance from vertex color to each reference color
                    float distToRapid = distance(vColor, rapidColor);
                    float distToCutting = distance(vColor, cuttingColor);

                    // Determine which color group this vertex belongs to (with tolerance)
                    bool isRapid = distToRapid < 0.1;
                    bool isCutting = distToCutting < 0.1;

                    // Discard fragment if its color group is hidden
                    if (isRapid && !showRapid) discard;
                    if (isCutting && !showCutting) discard;

                    gl_FragColor = vec4(vColor, opacity);
                }
            `,
            uniforms: {
                rapidColor: { value: new THREE.Color(this.moveColors.rapid) },
                cuttingColor: { value: new THREE.Color(this.moveColors.cutting) },
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
        this.frames = frames;
        this.lineNumberMap.clear();
        for (let ln = 1; ln <= frames.length; ln++) {
            const startVertexIdx = frames[ln - 1];
            const endVertexIdx = ln < frames.length ? frames[ln] : geometry.attributes.position.count;
            this.lineNumberMap.set(ln, { startVertexIdx, endVertexIdx });
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

        // Reset all previously completed vertices to their original colors based on move type
        const colors = line.geometry.attributes.color.array;
        const rapidColor = new THREE.Color(this.moveColors.rapid);
        const cuttingColor = new THREE.Color(this.moveColors.cutting);

        this.completedLines.forEach(lineNumber => {
            const range = this.lineNumberMap.get(lineNumber);
            if (!range) return;
            const { startVertexIdx, endVertexIdx } = range;
            const moveType = this.lineMoveType.get(lineNumber) || 'cutting';
            const base = moveType === 'rapid' ? rapidColor : cuttingColor;
            for (let i = startVertexIdx; i < endVertexIdx; i++) {
                colors[i * 3] = base.r;
                colors[i * 3 + 1] = base.g;
                colors[i * 3 + 2] = base.b;
            }
        });

        line.geometry.attributes.color.needsUpdate = true;
        this.completedLines.clear();
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
            const rapidColor = new THREE.Color(this.moveColors.rapid);
            const cuttingColor = new THREE.Color(this.moveColors.cutting);
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
                const baseActive = moveType === 'rapid' ? rapidColor : cuttingColor;

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

    getOutOfBoundsAxes() {
        return Array.from(this._outOfBoundsAxes);
    }

    getOutOfBoundsDirections() {
        return Array.from(this._outOfBoundsDirections);
    }
}

export default GCodeVisualizer;

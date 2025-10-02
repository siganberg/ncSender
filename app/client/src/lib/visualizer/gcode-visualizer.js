import * as THREE from 'three';
import { ArcCurve } from 'three';

class GCodeVisualizer {
    constructor() {
        this.group = new THREE.Group();
        this.pathLines = [];

        // G-code movement types colors
        this.moveColors = {
            rapid: 0x00ff66,  // Rapid moves - Brighter Green
            cutting: 0x3e85c7,  // Cutting moves - Light Blue
            completedRapid: 0x333333,  // Completed rapid - Dark Gray
            completedCutting: 0x444444,  // Completed cutting - Dark Gray
            outOfBounds: 0xcc5555  // Out of bounds - Muted Red
        };

        // Grid boundaries (set via setGridBounds)
        this.gridBounds = null;

        // Store current G-code for re-rendering
        this.currentGCode = null;

        // Visibility flags for shader
        this.showRapid = true;
        this.showCutting = true;

        // Track line numbers for completion marking
        this.lineNumberMap = new Map();
        this.completedLines = new Set();

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

        // Re-render current G-code with new bounds if exists
        if (this.currentGCode) {
            this.render(this.currentGCode);
        }
    }

    isPointOutOfBounds(x, y, z) {
        if (!this.gridBounds) return false;

        const { minX, maxX, minY, maxY } = this.gridBounds;

        return x < minX || x > maxX || y < minY || y > maxY;
    }

    hasOutOfBoundsMovement() {
        return this.hasOutOfBounds || false;
    }

    parseGCode(gcodeString) {
        const lines = gcodeString.split('\n');
        const vertices = []; // Flat array of x,y,z coordinates
        const colors = []; // Flat array of r,g,b values
        const frames = []; // Line number to vertex index mapping

        let currentPos = { x: 0, y: 0, z: 0 };
        let lastMoveType = null;
        let hasOutOfBounds = false; // Track if any points are out of bounds

        const rapidColor = new THREE.Color(this.moveColors.rapid);
        const cuttingColor = new THREE.Color(this.moveColors.cutting);
        const outOfBoundsColor = new THREE.Color(this.moveColors.outOfBounds);

        lines.forEach((line, lineIndex) => {
            const lineNumber = lineIndex + 1;
            const cleanLine = line.split(';')[0].trim().toUpperCase();
            if (!cleanLine) return;

            // Track vertex index for this line
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

                // Check if move is out of bounds
                const isOutOfBounds = this.isPointOutOfBounds(currentPos.x, currentPos.y, currentPos.z) ||
                                     this.isPointOutOfBounds(newPos.x, newPos.y, newPos.z);

                if (isOutOfBounds) hasOutOfBounds = true;

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

        // Store frames for line number tracking
        this.frames = frames;

        // Calculate bounds
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

    markLineCompleted(lineNumber) {
        if (this.completedLines.has(lineNumber)) {
            return; // Already marked
        }

        this.completedLines.add(lineNumber);

        // Find the line object
        const line = this.pathLines[0];
        if (!line || !line.geometry.attributes.color) return;

        // Get the vertex index range for this line number
        if (!this.frames || lineNumber - 1 >= this.frames.length) return;

        const startVertexIdx = this.frames[lineNumber - 1];
        const endVertexIdx = lineNumber < this.frames.length ? this.frames[lineNumber] : line.geometry.attributes.position.count;

        // Update colors for this line's vertices
        const colors = line.geometry.attributes.color.array;
        const completedColor = new THREE.Color(this.moveColors.completedCutting);

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

        // Reset all vertices to original colors
        const colors = line.geometry.attributes.color.array;
        const rapidColor = new THREE.Color(this.moveColors.rapid);
        const cuttingColor = new THREE.Color(this.moveColors.cutting);

        this.completedLines.forEach(lineNumber => {
            if (!this.frames || lineNumber - 1 >= this.frames.length) return;

            const startVertexIdx = this.frames[lineNumber - 1];
            const endVertexIdx = lineNumber < this.frames.length ? this.frames[lineNumber] : line.geometry.attributes.position.count;

            // Restore original color (would need to track which type each line is)
            for (let i = startVertexIdx; i < endVertexIdx; i++) {
                colors[i * 3] = cuttingColor.r;
                colors[i * 3 + 1] = cuttingColor.g;
                colors[i * 3 + 2] = cuttingColor.b;
            }
        });

        line.geometry.attributes.color.needsUpdate = true;
        this.completedLines.clear();
    }

    getMoveTypeVisibility() {
        return {
            cutting: true,
            rapid: true
        };
    }
}

export default GCodeVisualizer;

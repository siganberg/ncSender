import * as THREE from 'three';
import { ArcCurve } from 'three';

class GCodeVisualizer {
    constructor() {
        this.group = new THREE.Group();
        this.pathLines = [];

        // G-code movement types colors
        this.moveColors = {
            rapid: 0x00ff00,  // Rapid moves - Bright Green
            cutting: 0x3e85c7,  // Cutting moves - Light Blue
            completedRapid: 0x333333,  // Completed rapid - Dark Gray
            completedCutting: 0x444444  // Completed cutting - Dark Gray
        };

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

    parseGCode(gcodeString) {
        const lines = gcodeString.split('\n');
        const vertices = []; // Flat array of x,y,z coordinates
        const colors = []; // Flat array of r,g,b values
        const frames = []; // Line number to vertex index mapping

        let currentPos = { x: 0, y: 0, z: 0 };
        let lastMoveType = null;

        const rapidColor = new THREE.Color(this.moveColors.rapid);
        const cuttingColor = new THREE.Color(this.moveColors.cutting);

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
                const color = isRapid ? rapidColor : cuttingColor;

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

        return { vertices, colors, frames };
    }

    render(gcodeString) {
        this.clear();

        if (!gcodeString) return;

        const { vertices, colors, frames } = this.parseGCode(gcodeString);

        if (vertices.length === 0) return;

        // Create single line with all vertices
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            linewidth: 2
        });

        const line = new THREE.Line(geometry, material);
        line.name = 'gcode-toolpath';
        line.renderOrder = 1;

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
        // Simplified - would need separate geometry for each type
        this.group.visible = visible;
    }

    setCuttingVisibility(visible) {
        this.setMoveTypeVisibility('cutting', visible);
    }

    setRapidVisibility(visible) {
        this.setMoveTypeVisibility('rapid', visible);
    }

    markLineCompleted(lineNumber) {
        // Simplified - just track it
        this.completedLines.add(lineNumber);
    }

    markLinesCompleted(lineNumbers) {
        lineNumbers.forEach(lineNum => this.markLineCompleted(lineNum));
    }

    resetCompletedLines() {
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

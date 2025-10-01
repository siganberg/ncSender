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
            cutting: 0x3e85c7  // Cutting moves - Light Blue
        };

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
    }

    _closeIfLoop(path) {
        if (!path || path.length < 2) return path;
        const first = path[0];
        const last = path[path.length - 1];
        const dx = (last.x - first.x);
        const dy = (last.y - first.y);
        const eps = 1e-3; // mm tolerance
        if (Math.hypot(dx, dy) <= eps) {
            // Ensure exact closure by snapping last to first
            const closed = path.slice(0, -1);
            closed.push({ x: first.x, y: first.y, z: last.z });
            return closed;
        }
        return path;
    }

    parseGCode(gcodeString) {
        const lines = gcodeString.split('\n');
        const toolpaths = { rapid: [], cutting: [] };
        let currentPosition = { x: 0, y: 0, z: 0 };
        let lastMoveType = null;
        let currentToolpath = [];
        // Tool-down heuristics are unreliable across files; classify by modal move only
        let isToolDown = false; // kept for compatibility but not used in classification
        
        lines.forEach(line => {
            // Strip inline comments: both ';' and '( ... )' styles, then normalize
            const noParenComments = line.replace(/\([^)]*\)/g, '');
            const cleanLine = noParenComments.split(';')[0].trim().toUpperCase();
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
                // Classify moves by modal code only; treat G1/G2/G3 with XY change as cutting; G0 as rapid
                const isArcMove = (moveType === 'G2' || moveType === 'G3');
                const isRapidMove = (moveType === 'G0');
                const isLinearMove = (moveType === 'G1');
                const xyChanged = (newPosition.x !== currentPosition.x || newPosition.y !== currentPosition.y);
                const isCuttingMove = isArcMove || (isLinearMove && xyChanged);
                
                
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
                } else {
                    // Finish current cutting path on any non-cutting move
                    if (currentToolpath.length > 1) {
                        toolpaths.cutting.push(this._closeIfLoop([...currentToolpath]));
                        currentToolpath = [];
                    }

                    // Only record explicit rapids as rapid moves
                    if (isRapidMove) {
                        toolpaths.rapid.push([
                            { ...currentPosition },
                            { ...newPosition }
                        ]);
                    }
                }
                
                currentPosition = newPosition;
            }
        });

        if (currentToolpath.length > 1) {
            toolpaths.cutting.push(this._closeIfLoop(currentToolpath));
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
        
        // Render cutting toolpaths (continuous lines)
        toolpaths.cutting.forEach((path, index) => {
            if (path.length < 2) return;
            
            const points = path.map(point => new THREE.Vector3(point.x, point.y, point.z));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            
            const material = new THREE.LineBasicMaterial({
                color: this.moveColors.cutting, // Cutting color
                transparent: true,
                opacity: 0.9,
                linewidth: 2
            });
            
            const line = new THREE.Line(geometry, material);
            line.userData = { type: 'cutting', pathIndex: index };
            line.name = `cutting-path-${index}`;
            line.renderOrder = 1; // Ensure lines render on top
            
            this.pathLines.push(line);
            this.group.add(line);
        });
        
        // Render rapid moves (solid lines)
        toolpaths.rapid.forEach((path, index) => {
            if (path.length < 2) return;
            
            const points = path.map(point => new THREE.Vector3(point.x, point.y, point.z));
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            
            const material = new THREE.LineBasicMaterial({
                color: this.moveColors.rapid, // Rapid color - bright green
                transparent: true,
                opacity: 0.6, // Slightly more transparent than cutting paths
                linewidth: 1
            });
            
            const line = new THREE.Line(geometry, material);
            line.userData = { type: 'rapid', pathIndex: index };
            line.name = `rapid-path-${index}`;
            
            this.pathLines.push(line);
            this.group.add(line);
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
}

export default GCodeVisualizer;

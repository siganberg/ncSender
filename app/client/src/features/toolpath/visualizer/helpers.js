// Moved into toolpath feature (verticalization).
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

// Helper functions for the visualizer
export const getBoundingBox = (object) => {
    const box = new THREE.Box3().setFromObject(object);
    const boundingBox = {
        min: {
            x: box.min.x === Infinity ? 0 : box.min.x,
            y: box.min.y === Infinity ? 0 : box.min.y,
            z: box.min.z === Infinity ? 0 : box.min.z,
        },
        max: {
            x: box.max.x === -Infinity ? 0 : box.max.x,
            y: box.max.y === -Infinity ? 0 : box.max.y,
            z: box.max.z === -Infinity ? 0 : box.max.z,
        },
    };
    return boundingBox;
};

export const loadTexture = (url) => new Promise((resolve) => {
    new THREE.TextureLoader().load(url, resolve);
});

export const generateCuttingPointer = () => {
    const group = new THREE.Group();

    // Get accent color from CSS variable
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#1abc9c';

    const material = new THREE.MeshStandardMaterial({
        color: accentColor,
        flatShading: true,
        transparent: true,
        opacity: 0.6
    });

    // Load MTL file first, then OBJ
    const mtlLoader = new MTLLoader();
    mtlLoader.load(
        '/assets/cnc-bit.mtl',
        (materials) => {
            materials.preload();
            // Keep reference to material creator for later helpers
            group.userData._materialCreator = materials;

            // Build ordered material name list (1-based index from file order)
            const mtlNames = Object.keys(materials.materialsInfo || {});
            // Default: recolor material index 1 if present
            const defaultMaterialIndex = 1;

            // Now load OBJ with materials
            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.load(
                '/assets/cnc-bit.txt',
                (obj) => {
                    // Collect meshes in encounter order
                    const meshes = [];
                    obj.traverse((child) => {
                        if (child.isMesh) {
                            meshes.push(child);
                            // Keep original material, add transparency and metallic properties
                            if (child.material) {
                                // Handle single or array materials
                                const mats = Array.isArray(child.material) ? child.material : [child.material];
                                mats.forEach((m) => {
                                    m.transparent = true;
                                    m.opacity = 1;
                                    if ('metalness' in m) m.metalness = 0.9;
                                    if ('roughness' in m) m.roughness = 0.3;
                                });
                            }
                            child.castShadow = true;
                        }
                    });

                    // Tag meshes with a stable traversal index and set renderOrder
                    // Start at 1000 and increment to preserve relative order while staying above gcode (999)
                    meshes.forEach((m, idx) => {
                        m.userData.pointerIndex = idx;
                        m.renderOrder = 1000 + idx; // Preserve order relative to each other
                    });

                    // Log mesh indices and names for debugging/selection
                    // Removed mesh logging - no longer needed

                    // Recolor all meshes using selected material index to black (keep accent plumbing for future)
                    const targetMatName = mtlNames[defaultMaterialIndex - 1];
                    const targetColor = '#4a4a4a';
                    if (targetMatName) {
                        meshes.forEach((mesh) => {
                            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                            mats.forEach((m) => {
                                if (m && m.name === targetMatName && m.color) {
                                    m.color.set(targetColor);
                                    m.needsUpdate = true;
                                }
                            });
                        });
                    } else {
                        // eslint-disable-next-line no-console
                        console.warn('[Pointer OBJ] Material index out of range:', defaultMaterialIndex);
                    }

                    // The OBJ is in meters and very small, scale it up to millimeters
                    // Model is ~0.001m, scale by 500
                    obj.scale.set(500, 500, 500);

                    // Rotate to point down along negative Z axis
                    obj.rotation.x = Math.PI / 2; // 90° rotation

                    // Center the object
                    const boxScaled = new THREE.Box3().setFromObject(obj);
                    const center = boxScaled.getCenter(new THREE.Vector3());
                    obj.position.sub(center);

                    obj.position.z += 10;

                    group.add(obj);

                    // No shading toggles; rely on scene lighting only
                },
                undefined, // Progress callback removed
                (error) => {
                    console.error('Error loading CNC pointer OBJ:', error);
                    // Fallback to simple cone if loading fails
                    const geometry = new THREE.ConeGeometry(1, 10, 8);
                    const cone = new THREE.Mesh(geometry, material);
                    cone.rotation.x = Math.PI;
                    cone.position.z = -5;
                    cone.renderOrder = 1000; // Higher than gcode
                    material.depthTest = false; // Always render on top
                    group.add(cone);
                }
            );
        },
        undefined, // Progress callback removed
        (error) => {
            console.error('Error loading MTL file:', error);
            // Fallback: load OBJ without materials
            const objLoader = new OBJLoader();
            objLoader.load(
                '/assets/cnc-bit.txt',
                (obj) => {
                    // Collect meshes first; without MTL, material names are not available
                    const meshes = [];
                    obj.traverse((child) => {
                        if (child.isMesh) {
                            meshes.push(child);

                        }
                    });

                    // Tag indices and log inventory for selection
                    meshes.forEach((m, idx) => { m.userData.pointerIndex = idx; });
                    // Removed mesh logging - no longer needed

                    // Without MTL, we cannot target by material index; leave materials as-is
                    // eslint-disable-next-line no-console
                    console.warn('[Pointer OBJ] MTL not loaded; material-index recolor unavailable.');

                    obj.scale.set(500, 500, 500);
                    obj.rotation.x = Math.PI / 2;
                    const boxScaled = new THREE.Box3().setFromObject(obj);
                    const center = boxScaled.getCenter(new THREE.Vector3());
                    obj.position.sub(center);
                    obj.position.z += 11.5;
                    group.add(obj);

                    // No shading helpers in OBJ-only path
                },
                undefined,
                (objError) => {
                    console.error('Error loading OBJ file:', objError);
                    // Final fallback to simple cone if OBJ loading fails
                    const geometry = new THREE.ConeGeometry(1, 10, 8);
                    const cone = new THREE.Mesh(geometry, material);
                    cone.rotation.x = Math.PI;
                    cone.position.z = -5;
                    group.add(cone);
                }
            );
        }
    );

    // Helper for downstream debug/selection
    group.userData.recolorPointerParts = (indices = [], color = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#1abc9c') => {
        const meshes = [];
        group.traverse((child) => { if (child.isMesh && typeof child.userData.pointerIndex === 'number') meshes.push(child); });
        const colorObj = new THREE.Color(color);
        meshes.forEach((m) => {
            if (indices.includes(m.userData.pointerIndex)) {
                const mats = Array.isArray(m.material) ? m.material : [m.material];
                mats.forEach((mat) => { if (mat && mat.color) mat.color.copy(colorObj); });
        }});
    };

    // Allow recoloring by material index (1-based) when MTL was loaded
    group.userData.recolorPointerMaterialByIndex = (index1Based = 1, color = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#1abc9c') => {
        const colorObj = new THREE.Color(color);
        // Try to access MaterialCreator cached on the group (if any)
        const materialCreator = group.userData._materialCreator;
        let mtlNames = [];
        if (materialCreator && materialCreator.materialsInfo) {
            mtlNames = Object.keys(materialCreator.materialsInfo);
        }
        const targetName = mtlNames[index1Based - 1];
        if (!targetName) {
            // eslint-disable-next-line no-console
            console.warn('[Pointer OBJ] Invalid material index:', index1Based);
            return;
        }
        group.traverse((child) => {
            if (child.isMesh) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach((mat) => {
                    if (mat && mat.name === targetName && mat.color) {
                        mat.color.copy(colorObj);
                        mat.needsUpdate = true;
                    }
                });
            }
        });
    };

    return group;
};

// Utility: list pointer meshes with indices to the console
export const listPointerMeshes = (group) => {
    const meshes = [];
    group.traverse((child) => { if (child.isMesh) meshes.push(child); });
    // Removed mesh logging - no longer needed
};

const axisBounds = (size, offset, home) => {
    const axisSize = typeof size === 'number' && !Number.isNaN(size) ? size : 0;
    if (home === 'max') {
        return {
            min: -axisSize - offset,
            max: -offset
        };
    }
    return {
        min: -offset,
        max: axisSize - offset
    };
};

export const createGridLines = ({ gridSizeX = 1220, gridSizeY = 1220, workOffset = { x: 0, y: 0, z: 0 }, orientation = { xHome: 'min', yHome: 'max' }, units = 'metric' } = {}) => {
    const group = new THREE.Group();

    // Grid spacing based on units
    // In metric: 10mm grid, 100mm major lines (every 10th line)
    // In imperial: 12.7mm (0.5in) grid, 127mm (5in) major lines (every 10th line)
    const MM_PER_INCH = 25.4;
    const step = units === 'imperial' ? MM_PER_INCH / 2 : 10; // 0.5in or 10mm
    const majorStep = units === 'imperial' ? MM_PER_INCH * 5 : 100; // 5in or 100mm

    // Calculate dynamic boundaries based on work offset
    const xBounds = axisBounds(gridSizeX, workOffset.x || 0, orientation.xHome || 'min');
    const yBounds = axisBounds(gridSizeY, workOffset.y || 0, orientation.yHome || 'max');
    const { min: minX, max: maxX } = xBounds;
    const { min: minY, max: maxY } = yBounds;

    // Regular grid lines
    const material = new THREE.LineBasicMaterial({
        color: 0x77a9d7,
        transparent: true,
        opacity: 0.2
    });

    // Major grid lines (every 100mm)
    const majorMaterial = new THREE.LineBasicMaterial({
        color: 0x77a9d7,
        transparent: true,
        opacity: 0.4
    });

    // X-axis (Y=0) line material - Red
    const xAxisLineMaterial = new THREE.LineBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 1.0
    });

    // Y-axis (X=0) line material - Green
    const yAxisLineMaterial = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        transparent: true,
        opacity: 1.0
    });

    // Edge lines
    const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x77a9d7,
        transparent: true,
        opacity: 1.0
    });

    const points = [];
    const majorPoints = [];

    // Helper to check if a value is close to a multiple of majorStep
    const isMajorLine = (value) => {
        const remainder = Math.abs(value % majorStep);
        return remainder < 0.01 || remainder > majorStep - 0.01;
    };

    // Create horizontal lines (parallel to X axis)
    for (let i = Math.round(minY / step) * step; i <= maxY; i += step) {
        const linePoints = [
            new THREE.Vector3(minX, i, 0),
            new THREE.Vector3(maxX, i, 0)
        ];

        if (Math.abs(i) < 0.01) {
            const axisGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
            const xAxisLine = new THREE.Line(axisGeom, xAxisLineMaterial);
            xAxisLine.renderOrder = 1;
            group.add(xAxisLine);
        } else if (isMajorLine(i)) {
            majorPoints.push(...linePoints);
        } else {
            points.push(...linePoints);
        }
    }

    // Create vertical lines (parallel to Y axis)
    for (let i = Math.round(minX / step) * step; i <= maxX; i += step) {
        const linePoints = [
            new THREE.Vector3(i, minY, 0),
            new THREE.Vector3(i, maxY, 0)
        ];

        if (Math.abs(i) < 0.01) {
            const axisGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
            const yAxisLine = new THREE.Line(axisGeom, yAxisLineMaterial);
            yAxisLine.renderOrder = 1;
            group.add(yAxisLine);
        } else if (isMajorLine(i)) {
            majorPoints.push(...linePoints);
        } else {
            points.push(...linePoints);
        }
    }

    // Add regular grid lines
    if (points.length > 0) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const lines = new THREE.LineSegments(geometry, material);
        lines.renderOrder = 0;
        group.add(lines);
    }

    // Add major grid lines
    if (majorPoints.length > 0) {
        const majorGeometry = new THREE.BufferGeometry().setFromPoints(majorPoints);
        const majorLines = new THREE.LineSegments(majorGeometry, majorMaterial);
        majorLines.renderOrder = 0;
        group.add(majorLines);
    }

    // Add edge lines
    const edgePoints = [
        new THREE.Vector3(minX, minY, 0),
        new THREE.Vector3(maxX, minY, 0),
        new THREE.Vector3(minX, maxY, 0),
        new THREE.Vector3(maxX, maxY, 0),
        new THREE.Vector3(minX, minY, 0),
        new THREE.Vector3(minX, maxY, 0),
        new THREE.Vector3(maxX, minY, 0),
        new THREE.Vector3(maxX, maxY, 0),
    ];
    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeLines.renderOrder = 1; // Render on top of other grid lines
    group.add(edgeLines);

    // Add grid numbers
    const textMaterial = new THREE.SpriteMaterial({
        color: 0x77a9d7,
        transparent: true,
        opacity: 0.6
    });

    // Label spacing: metric = every 20mm, imperial = every 1in (25.4mm)
    const labelStep = units === 'imperial' ? MM_PER_INCH : 20;

    // Helper to check if a value should have a label
    const shouldLabel = (value) => {
        const remainder = Math.abs(value % labelStep);
        return remainder < 0.01 || remainder > labelStep - 0.01;
    };

    // Add X-axis numbers (at label intervals)
    for (let i = Math.round(minX / step) * step; i <= maxX; i += step) {
        if (Math.abs(i) < 0.01) continue; // Skip center
        if (!shouldLabel(i)) continue; // Skip non-label positions

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // Higher resolution for sharper text
        const scale = 4; // 4x resolution for crisp text
        canvas.width = 128 * scale;
        canvas.height = 64 * scale;

        // Scale the context to match
        context.scale(scale, scale);

        context.clearRect(0, 0, 128, 64);
        context.fillStyle = '#cc6666'; // Muted red color for X-axis
        context.font = 'bold 20px Arial'; // Font size 20
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        // Anti-aliasing and text rendering improvements
        context.textRenderingOptimization = 'optimizeQuality';
        context.imageSmoothingEnabled = true;

        // Convert to inches if imperial, otherwise keep mm
        const displayValue = units === 'imperial' ? Math.round(i / MM_PER_INCH).toString() : i.toString();
        context.fillText(displayValue, 64, 32);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.generateMipmaps = false; // Prevent blurring on zoom
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const planeMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const planeGeometry = new THREE.PlaneGeometry(32, 20);
        const mesh = new THREE.Mesh(planeGeometry, planeMaterial);
        mesh.position.set(i, -5, 0.01); // Slightly above grid to avoid z-fighting
        mesh.renderOrder = 2; // Render after grid lines
        group.add(mesh);
    }

    // Add Y-axis numbers (at label intervals)
    for (let i = Math.round(minY / step) * step; i <= maxY; i += step) {
        if (Math.abs(i) < 0.01) continue; // Skip center
        if (!shouldLabel(i)) continue; // Skip non-label positions

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // Higher resolution for sharper text
        const scale = 4; // 4x resolution for crisp text
        canvas.width = 128 * scale;
        canvas.height = 64 * scale;

        // Scale the context to match
        context.scale(scale, scale);

        context.clearRect(0, 0, 128, 64);
        context.fillStyle = '#4d994d'; // Darker green color for Y-axis
        context.font = 'bold 20px Arial'; // Font size 20
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        // Anti-aliasing and text rendering improvements
        context.textRenderingOptimization = 'optimizeQuality';
        context.imageSmoothingEnabled = true;

        // Convert to inches if imperial, otherwise keep mm
        const displayValue = units === 'imperial' ? Math.round(i / MM_PER_INCH).toString() : i.toString();
        context.fillText(displayValue, 64, 32);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.generateMipmaps = false; // Prevent blurring on zoom
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const planeMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const planeGeometry = new THREE.PlaneGeometry(32, 20);
        const mesh = new THREE.Mesh(planeGeometry, planeMaterial);
        mesh.position.set(-5, i, 0.01); // Slightly above grid to avoid z-fighting
        mesh.renderOrder = 2; // Render after grid lines
        group.add(mesh);
    }

    group.name = 'grid-with-numbers';
    return group;
};

export const createCoordinateAxes = (size = 50) => {
    const group = new THREE.Group();

    // X axis (red) - pointing right in standard CNC orientation
    const xGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(size, 0, 0)
    ]);
    const xMaterial = new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 3
    });
    const xLine = new THREE.Line(xGeometry, xMaterial);
    group.add(xLine);

    // Y axis (green) - pointing forward in standard CNC orientation
    const yGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, size, 0)
    ]);
    const yMaterial = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        linewidth: 3
    });
    const yLine = new THREE.Line(yGeometry, yMaterial);
    group.add(yLine);

    // Z axis (blue) - pointing up in standard CNC orientation
    const zGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, size)
    ]);
    const zMaterial = new THREE.LineBasicMaterial({
        color: 0x0000ff,
        linewidth: 3
    });
    const zLine = new THREE.Line(zGeometry, zMaterial);
    group.add(zLine);

    group.name = 'coordinates';
    return group;
};

export const createDynamicAxisLabels = (bounds) => {
    const group = new THREE.Group();

    const createAxisLabel = (text, position, color) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 128;
        canvas.height = 128;

        // Ensure a transparent background
        context.globalAlpha = 1.0;
        context.clearRect(0, 0, canvas.width, canvas.height);

        const colorStr = `#${color.toString(16).padStart(6, '0')}`;

        context.font = 'bold 72px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        // Add a thick outline for contrast against toolpath colors
        context.strokeStyle = '#000000';
        context.lineWidth = 12;
        context.strokeText(text, canvas.width / 2, canvas.height / 2);

        // Main fill
        context.fillStyle = colorStr;
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.75,
            alphaTest: 0.01
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.copy(position);
        sprite.scale.set(30, 30, 1);
        return sprite;
    };

    if (bounds) {
        // Position labels 20mm away from the highest point values
        const xPos = new THREE.Vector3(bounds.max.x + 20, 0, 0);
        const yPos = new THREE.Vector3(0, bounds.max.y + 20, 0);
        const zPos = new THREE.Vector3(0, 0, bounds.max.z + 20);

        group.add(createAxisLabel('X', xPos, 0xcc6666)); // Muted red
        group.add(createAxisLabel('Y', yPos, 0x4d994d)); // Darker green
        group.add(createAxisLabel('Z', zPos, 0x6666cc)); // Muted blue
    } else {
        // Fallback positions if no bounds
        group.add(createAxisLabel('X', new THREE.Vector3(60, 0, 0), 0xcc6666)); // Muted red
        group.add(createAxisLabel('Y', new THREE.Vector3(0, 60, 0), 0x4d994d)); // Darker green
        group.add(createAxisLabel('Z', new THREE.Vector3(0, 0, 60), 0x6666cc)); // Muted blue
    }

    group.name = 'axis-labels';
    return group;
};

let cachedHomeIconTexture = null;

const getHomeIconTexture = () => {
    const fillColor = '#3f7cac';
    if (cachedHomeIconTexture) {
        return cachedHomeIconTexture;
    }

    const svgMarkup = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460.298 460.297">
      <path fill="${fillColor}" d="M230.149,120.939L65.986,256.274c0,0.191-0.048,0.472-0.144,0.855c-0.094,0.38-0.144,0.656-0.144,0.852v137.041c0,4.948,1.809,9.236,5.426,12.847c3.616,3.613,7.898,5.431,12.847,5.431h109.63V303.664h73.097v109.64h109.629c4.948,0,9.236-1.814,12.847-5.435c3.617-3.607,5.432-7.898,5.432-12.847V257.981c0-0.76-0.104-1.334-0.288-1.707L230.149,120.939z"/>
      <path fill="${fillColor}" d="M457.122,225.438L394.6,173.476V56.989c0-2.663-0.856-4.853-2.574-6.567c-1.704-1.712-3.894-2.568-6.563-2.568h-54.816c-2.666,0-4.855,0.856-6.57,2.568c-1.711,1.714-2.566,3.905-2.566,6.567v55.673l-69.662-58.245c-6.084-4.949-13.318-7.423-21.694-7.423c-8.375,0-15.608,2.474-21.698,7.423L3.172,225.438c-1.903,1.52-2.946,3.566-3.14,6.136c-0.193,2.568,0.472,4.811,1.997,6.713l17.701,21.128c1.525,1.712,3.521,2.759,5.996,3.142c2.285,0.192,4.57-0.476,6.855-1.998L230.149,95.817l197.57,164.741c1.526,1.328,3.521,1.991,5.996,1.991h0.858c2.471-0.376,4.463-1.43,5.996-3.138l17.703-21.125c1.522-1.906,2.189-4.145,1.991-6.716C460.068,229.007,459.021,226.961,457.122,225.438z"/>
    </svg>`;

    const encoded = encodeURIComponent(svgMarkup)
        .replace(/'/g, '%27')
        .replace(/"/g, '%22')
        .replace(/\n/g, '');

    const dataUrl = `data:image/svg+xml;utf8,${encoded}`;
    const texture = new THREE.TextureLoader().load(dataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    cachedHomeIconTexture = texture;
    return texture;
};

export const createHomeIndicator = () => {
    const group = new THREE.Group();
    group.name = 'home-indicator';

    const accentBase = new THREE.Color('#3f7cac');
    const accentBright = accentBase.clone().lerp(new THREE.Color('#f3f4f6'), 0.4);
    const accentDim = accentBase.clone().lerp(new THREE.Color('#1f2933'), 0.6);

    // Soft base disc
    const baseGeometry = new THREE.CircleGeometry(12, 72);
    const baseMaterial = new THREE.MeshBasicMaterial({
        color: accentDim,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        depthTest: false
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.set(0, 0, 0.08);
    base.renderOrder = 1200;
    group.add(base);

    // Accent ring
    const ringGeometry = new THREE.RingGeometry(12.5, 14, 72);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: accentBright,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(0, 0, 0.1);
    ring.renderOrder = 1201;
    group.add(ring);

    // Vertical marker pole (aligned to Z)
    const poleGeometry = new THREE.CylinderGeometry(0.6, 0.6, 40, 32);
    const poleMaterial = new THREE.MeshBasicMaterial({
        color: accentBright,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false
    });
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.rotation.x = Math.PI / 2;
    pole.position.set(0, 0, 20);
    pole.renderOrder = 1202;
    group.add(pole);

    // Marker cap
    const capGeometry = new THREE.SphereGeometry(1.1, 32, 32);
    const capMaterial = new THREE.MeshBasicMaterial({
        color: accentBright,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false
    });
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.position.set(0, 0, 40);
    cap.renderOrder = 1203;
    group.add(cap);

    const spriteMaterial = new THREE.SpriteMaterial({
        map: getHomeIconTexture(),
    transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(36, 36, 1);
    sprite.position.set(0, 0, 40);
    sprite.renderOrder = 1204;
    group.add(sprite);

    return group;
};

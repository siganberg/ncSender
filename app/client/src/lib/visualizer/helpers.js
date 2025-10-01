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

            // Now load OBJ with materials
            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.load(
                '/assets/cnc-bit.obj',
                (obj) => {
                    // Apply transparency and metallic look to all meshes in the loaded object
                    obj.traverse((child) => {
                        if (child.isMesh) {
                            // Keep original material, add transparency and metallic properties
                            if (child.material) {
                                child.material.transparent = true;
                                child.material.opacity = 1;
                                child.material.metalness = 0.9;
                                child.material.roughness = 0.3;
                            }
                            child.castShadow = true;
                        }
                    });

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
                },
                undefined, // Progress callback removed
                (error) => {
                    console.error('Error loading CNC pointer OBJ:', error);
                    // Fallback to simple cone if loading fails
                    const geometry = new THREE.ConeGeometry(1, 10, 8);
                    const cone = new THREE.Mesh(geometry, material);
                    cone.rotation.x = Math.PI;
                    cone.position.z = -5;
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
                '/assets/cnc-bit.obj',
                (obj) => {
                    obj.scale.set(500, 500, 500);
                    obj.rotation.x = Math.PI / 2;
                    const boxScaled = new THREE.Box3().setFromObject(obj);
                    const center = boxScaled.getCenter(new THREE.Vector3());
                    obj.position.sub(center);
                    obj.position.z += 11.5;
                    group.add(obj);
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

    return group;
};

export const createGridLines = () => {
    const group = new THREE.Group();

    // Create 1220x1220mm grid with 10mm spacing
    const size = 610; // Half of 1220mm (center at origin)
    const step = 10; // 10mm grid spacing
    const majorStep = 100; // Major grid lines every 100mm

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

    const points = [];
    const majorPoints = [];

    // Create horizontal lines (parallel to X axis)
    for (let i = -size; i <= size; i += step) {
        const linePoints = [
            new THREE.Vector3(-size, i, 0),
            new THREE.Vector3(size, i, 0)
        ];

        if (i % majorStep === 0) {
            majorPoints.push(...linePoints);
        } else {
            points.push(...linePoints);
        }
    }

    // Create vertical lines (parallel to Y axis)
    for (let i = -size; i <= size; i += step) {
        const linePoints = [
            new THREE.Vector3(i, -size, 0),
            new THREE.Vector3(i, size, 0)
        ];

        if (i % majorStep === 0) {
            majorPoints.push(...linePoints);
        } else {
            points.push(...linePoints);
        }
    }

    // Add regular grid lines
    if (points.length > 0) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const lines = new THREE.LineSegments(geometry, material);
        group.add(lines);
    }

    // Add major grid lines
    if (majorPoints.length > 0) {
        const majorGeometry = new THREE.BufferGeometry().setFromPoints(majorPoints);
        const majorLines = new THREE.LineSegments(majorGeometry, majorMaterial);
        group.add(majorLines);
    }

    // Add grid numbers
    const textMaterial = new THREE.SpriteMaterial({
        color: 0x77a9d7,
        transparent: true,
        opacity: 0.6
    });

    // Add X-axis numbers (every 10mm)
    for (let i = -size; i <= size; i += 10) {
        if (i === 0) continue; // Skip center

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
        context.fillText(i.toString(), 64, 32);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.generateMipmaps = false; // Prevent blurring on zoom
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5,
            alphaTest: 0.01
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(i, -5, 0); // Move X-axis labels below center line
        sprite.scale.set(16, 10, 1); // Scale 20
        group.add(sprite);
    }

    // Add Y-axis numbers (every 10mm)
    for (let i = -size; i <= size; i += 10) {
        if (i === 0) continue; // Skip center

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
        context.fillText(i.toString(), 64, 32);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        texture.generateMipmaps = false; // Prevent blurring on zoom
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5,
            alphaTest: 0.01
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.set(-5, i, 0); // Move Y-axis labels left of center line
        sprite.scale.set(16, 10, 1); // Scale 20
        group.add(sprite);
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
        canvas.width = 64;
        canvas.height = 64;

        // Set transparent background explicitly
        context.globalAlpha = 1.0;
        context.clearRect(0, 0, 64, 64);

        // Create a high contrast outline for better visibility
        const colorStr = `#${color.toString(16).padStart(6, '0')}`;

        // Draw text with outline for better contrast
        context.font = 'bold 20px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        // Black outline
        context.strokeStyle = '#000000';
        context.lineWidth = 3;
        context.strokeText(text, 32, 32);

        // Main text
        context.fillStyle = colorStr;
        context.fillText(text, 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.5,
            alphaTest: 0.01
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.copy(position);
        sprite.scale.set(15, 15, 1);
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
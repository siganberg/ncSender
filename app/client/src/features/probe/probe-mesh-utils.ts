/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ncSender is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ncSender. If not, see <https://www.gnu.org/licenses/>.
 */

import * as THREE from 'three';

/**
 * Find all meshes that belong to a specific OBJ group
 * @param object - The Three.js Group object to search
 * @param groupName - The group name to search for (case-insensitive)
 * @returns Array of meshes belonging to the group
 */
export const findMeshesByGroup = (object: THREE.Group, groupName: string): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = [];

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Check userData.group set by obj-group-parser
      const meshGroup = child.userData.group?.toLowerCase() || '';
      if (meshGroup.includes(groupName.toLowerCase())) {
        meshes.push(child);
      }
    }
  });

  return meshes;
};

/**
 * Apply a custom action to all meshes in a group
 * @param object - The Three.js Group object
 * @param groupName - The group name to target (case-insensitive)
 * @param action - Callback function to apply to each mesh
 */
export const applyToGroup = (
  object: THREE.Group,
  groupName: string,
  action: (mesh: THREE.Mesh) => void
): void => {
  const meshes = findMeshesByGroup(object, groupName);
  meshes.forEach(mesh => action(mesh));
};

/**
 * Hide all meshes in a group
 * @param object - The Three.js Group object
 * @param groupName - The group name to hide (case-insensitive)
 */
export const hideGroup = (object: THREE.Group, groupName: string): void => {
  applyToGroup(object, groupName, (mesh) => {
    mesh.visible = false;
  });
};

/**
 * Show all meshes in a group
 * @param object - The Three.js Group object
 * @param groupName - The group name to show (case-insensitive)
 */
export const showGroup = (object: THREE.Group, groupName: string): void => {
  applyToGroup(object, groupName, (mesh) => {
    mesh.visible = true;
  });
};

/**
 * Change the color of all meshes in a group
 * @param object - The Three.js Group object
 * @param groupName - The group name to target (case-insensitive)
 * @param color - Hex color value (e.g., 0xff0000 for red)
 */
export const setGroupColor = (
  object: THREE.Group,
  groupName: string,
  color: number
): void => {
  applyToGroup(object, groupName, (mesh) => {
    if (mesh.material) {
      mesh.material = new THREE.MeshPhongMaterial({
        color: color,
        side: THREE.DoubleSide
      });
    }
  });
};

/**
 * Set the opacity of all meshes in a group
 * @param object - The Three.js Group object
 * @param groupName - The group name to target (case-insensitive)
 * @param opacity - Opacity value (0.0 to 1.0)
 */
export const setGroupOpacity = (
  object: THREE.Group,
  groupName: string,
  opacity: number
): void => {
  applyToGroup(object, groupName, (mesh) => {
    if (mesh.material) {
      mesh.material.transparent = true;
      mesh.material.opacity = opacity;
    }
  });
};

/**
 * Make a group blink by toggling visibility
 * @param object - The Three.js Group object
 * @param groupName - The group name to blink (case-insensitive)
 * @param interval - Blink interval in milliseconds
 * @param renderFn - Function to call to re-render the scene
 * @returns Interval ID for cleanup
 */
export const blinkGroup = (
  object: THREE.Group,
  groupName: string,
  interval: number,
  renderFn: () => void
): number => {
  const meshes = findMeshesByGroup(object, groupName);
  return window.setInterval(() => {
    meshes.forEach(mesh => {
      mesh.visible = !mesh.visible;
    });
    renderFn();
  }, interval);
};

/**
 * Set wireframe mode for all meshes in a group
 * @param object - The Three.js Group object
 * @param groupName - The group name to target (case-insensitive)
 * @param wireframe - Whether to enable wireframe mode
 */
export const setGroupWireframe = (
  object: THREE.Group,
  groupName: string,
  wireframe: boolean
): void => {
  applyToGroup(object, groupName, (mesh) => {
    if (mesh.material) {
      mesh.material.wireframe = wireframe;
    }
  });
};

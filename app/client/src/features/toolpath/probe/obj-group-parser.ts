import * as THREE from 'three';

interface GroupInfo {
  name: string;
  vertexStart: number;
  vertexEnd: number;
  faceIndices: number[];
}

/**
 * Parse OBJ file to extract group information
 * @param objText - Raw OBJ file text content
 * @returns Map of group names to their vertex/face ranges
 */
export const parseObjGroups = (objText: string): Map<string, GroupInfo> => {
  const lines = objText.split('\n');
  const groupMap = new Map<string, GroupInfo>();

  let currentGroup = 'default';
  let vertexCount = 0;
  let faceCount = 0;
  const groupVertexStarts = new Map<string, number>();
  const groupFaceIndices = new Map<string, number[]>();

  lines.forEach((line) => {
    const trimmed = line.trim();

    // Group declaration
    if (trimmed.startsWith('g ')) {
      const groupName = trimmed.substring(2).trim();
      if (groupName) {
        currentGroup = groupName;
        if (!groupVertexStarts.has(currentGroup)) {
          groupVertexStarts.set(currentGroup, vertexCount);
          groupFaceIndices.set(currentGroup, []);
        }
      }
    }
    // Vertex
    else if (trimmed.startsWith('v ')) {
      vertexCount++;
    }
    // Face
    else if (trimmed.startsWith('f ')) {
      const faces = groupFaceIndices.get(currentGroup) || [];
      faces.push(faceCount);
      groupFaceIndices.set(currentGroup, faces);
      faceCount++;
    }
  });

  // Build final group info map
  const groupNames = Array.from(groupVertexStarts.keys());
  groupNames.forEach((groupName, index) => {
    const vertexStart = groupVertexStarts.get(groupName) || 0;
    const vertexEnd = index < groupNames.length - 1
      ? (groupVertexStarts.get(groupNames[index + 1]) || vertexCount)
      : vertexCount;

    groupMap.set(groupName, {
      name: groupName,
      vertexStart,
      vertexEnd,
      faceIndices: groupFaceIndices.get(groupName) || []
    });
  });

  console.log('[OBJ_PARSER] Parsed groups:', groupNames);

  // Log detailed group info
  groupMap.forEach((info, name) => {
    console.log(`[OBJ_PARSER] Group "${name}": vertices ${info.vertexStart}-${info.vertexEnd}, ${info.faceIndices.length} faces`);
  });

  return groupMap;
};

/**
 * Assign group names to meshes based on their geometry
 * @param object - The loaded Three.js object
 * @param groupMap - Map of group info from parseObjGroups
 */
export const assignGroupsToMeshes = (
  object: THREE.Group,
  groupMap: Map<string, GroupInfo>
): void => {
  const meshes: THREE.Mesh[] = [];

  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      meshes.push(child);
    }
  });

  console.log(`[OBJ_PARSER] Assigning groups to ${meshes.length} meshes`);

  // Since OBJLoader combines meshes by material and loses group info,
  // we need a different approach: assign groups based on face count distribution
  const groupsByFaceCount = Array.from(groupMap.entries()).sort((a, b) => {
    return b[1].faceIndices.length - a[1].faceIndices.length;
  });

  // Assign each mesh to the group with the most similar face/vertex characteristics
  meshes.forEach((mesh, meshIndex) => {
    const geometry = mesh.geometry;
    const positions = geometry.attributes.position;

    if (!positions) {
      mesh.userData.group = 'unknown';
      return;
    }

    const vertexCount = positions.count;
    const faceCount = geometry.index ? geometry.index.count / 3 : vertexCount / 3;

    // For small meshes, try to match by face count
    let bestMatch = 'unknown';
    let bestScore = Infinity;

    groupMap.forEach((groupInfo, groupName) => {
      const groupFaceCount = groupInfo.faceIndices.length;
      const groupVertexCount = groupInfo.vertexEnd - groupInfo.vertexStart;

      // Score based on both face and vertex count similarity
      const faceDiff = Math.abs(groupFaceCount - faceCount);
      const vertexDiff = Math.abs(groupVertexCount - vertexCount);
      const score = faceDiff + vertexDiff * 0.5;

      if (score < bestScore) {
        bestScore = score;
        bestMatch = groupName;
      }
    });

    mesh.userData.group = bestMatch;
    console.log(`[OBJ_PARSER] mesh${meshIndex} assigned to group: ${bestMatch} (${vertexCount} vertices, ~${Math.round(faceCount)} faces)`);
  });
};

/**
 * Fetch and parse OBJ file, then assign groups to loaded meshes
 * @param objUrl - URL to the OBJ file
 * @param loadedObject - The Three.js object loaded by OBJLoader
 */
export const fetchAndAssignGroups = async (
  objUrl: string,
  loadedObject: THREE.Group
): Promise<void> => {
  try {
    const response = await fetch(objUrl);
    const objText = await response.text();
    const groupMap = parseObjGroups(objText);
    assignGroupsToMeshes(loadedObject, groupMap);
  } catch (error) {
    console.error('[OBJ_PARSER] Error parsing OBJ groups:', error);
  }
};

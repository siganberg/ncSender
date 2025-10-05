/**
 * Fast shallow comparison for state changes
 * Returns only the changed properties
 */
export function getStateChanges(previousState, currentState) {
  if (!previousState) {
    return currentState;
  }

  const changes = {};
  let hasChanges = false;

  for (const key in currentState) {
    const prev = previousState[key];
    const curr = currentState[key];

    // Fast reference check first
    if (prev === curr) {
      continue;
    }

    // Handle nested objects (one level deep for serverState structure)
    if (typeof curr === 'object' && curr !== null && typeof prev === 'object' && prev !== null) {
      const nestedChanges = {};
      let hasNestedChanges = false;

      for (const nestedKey in curr) {
        if (prev[nestedKey] !== curr[nestedKey]) {
          nestedChanges[nestedKey] = curr[nestedKey];
          hasNestedChanges = true;
        }
      }

      // Check for removed keys
      for (const nestedKey in prev) {
        if (!(nestedKey in curr)) {
          nestedChanges[nestedKey] = undefined;
          hasNestedChanges = true;
        }
      }

      if (hasNestedChanges) {
        changes[key] = nestedChanges;
        hasChanges = true;
      }
    } else {
      changes[key] = curr;
      hasChanges = true;
    }
  }

  // Check for removed top-level keys
  for (const key in previousState) {
    if (!(key in currentState)) {
      changes[key] = undefined;
      hasChanges = true;
    }
  }

  return hasChanges ? changes : null;
}

/**
 * Creates a deep clone snapshot of state for comparison
 * Uses JSON serialization for simplicity and speed
 */
export function createStateSnapshot(state) {
  try {
    return JSON.parse(JSON.stringify(state));
  } catch (error) {
    return null;
  }
}

/**
 * Message type state tracker
 * Tracks previous state for each message type
 */
export class MessageStateTracker {
  constructor() {
    this.previousStates = new Map();
  }

  getDelta(messageType, currentData) {
    const previousData = this.previousStates.get(messageType);
    const changes = getStateChanges(previousData, currentData);

    if (changes) {
      this.previousStates.set(messageType, createStateSnapshot(currentData));
    }

    return changes;
  }

  clear(messageType) {
    if (messageType) {
      this.previousStates.delete(messageType);
    } else {
      this.previousStates.clear();
    }
  }
}

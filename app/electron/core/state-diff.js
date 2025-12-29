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

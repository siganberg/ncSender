# Frontend Plugin UI - Drag-n-Drop Implementation TODO

## Current State
- File: `/Users/francis/projects/ncSender/app/client/src/features/plugins/PluginsTab.vue`
- Current UI: Card-based layout showing all plugins
- No drag-n-drop functionality
- No separation of sortable vs non-sortable plugins

## Required Changes

### 1. Install Dependencies
```bash
npm install @vueuse/core
# Vue 3 has built-in drag-n-drop support via native HTML5 API
# No additional library needed if using native implementation
```

### 2. Update PluginsTab.vue Template

Replace the current card-based `plugins-list` section (line ~53) with:

```vue
<div v-else class="plugins-container">
  <!-- Sortable Plugins Section -->
  <div v-if="sortablePlugins.length > 0" class="plugins-section">
    <h4 class="section-header">Event-based Plugins (Sortable)</h4>
    <div class="plugins-table sortable">
      <div
        v-for="(plugin, index) in sortablePlugins"
        :key="plugin.id"
        class="plugin-row"
        draggable="true"
        @dragstart="handleDragStart(index, $event)"
        @dragover="handleDragOver($event)"
        @drop="handleDrop(index, $event)"
        @dragend="handleDragEnd"
      >
        <div class="drag-handle">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
          </svg>
        </div>

        <div class="plugin-icon-cell">
          <img
            v-if="plugin.hasIcon && !brokenIcons[plugin.id]"
            :src="`${api.baseUrl}/api/plugins/${plugin.id}/icon`"
            :alt="`${plugin.name} icon`"
            class="plugin-icon-small"
            @error="brokenIcons[plugin.id] = true"
          />
          <svg v-else class="plugin-icon-placeholder" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16">
            <path d="M6 10.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5"/>
          </svg>
        </div>

        <div class="plugin-info-cell">
          <div class="plugin-name">{{ plugin.name }}</div>
          <div class="plugin-category">{{ plugin.category }}</div>
        </div>

        <div class="plugin-status-cell">
          <span v-if="plugin.enabled" class="status-badge status-enabled">Enabled</span>
          <span v-else class="status-badge status-disabled">Disabled</span>
        </div>

        <div class="plugin-actions-cell">
          <button class="btn-icon" @click="togglePlugin(plugin)" :disabled="toggling === plugin.id">
            <svg v-if="plugin.enabled" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z"/>
              <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
            </svg>
          </button>

          <button v-if="plugin.hasConfig" class="btn-icon" @click="openConfigPanel(plugin)">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
            </svg>
          </button>

          <button class="btn-icon btn-danger" @click="confirmUninstall(plugin)">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
              <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Section Divider -->
  <div v-if="sortablePlugins.length > 0 && otherPlugins.length > 0" class="section-divider"></div>

  <!-- Other Plugins Section -->
  <div v-if="otherPlugins.length > 0" class="plugins-section">
    <h4 class="section-header">Other Plugins</h4>
    <div class="plugins-table">
      <div
        v-for="plugin in otherPlugins"
        :key="plugin.id"
        class="plugin-row"
      >
        <div class="drag-handle-placeholder"></div>

        <!-- Same structure as sortable, but no draggable attributes -->
        <div class="plugin-icon-cell">...</div>
        <div class="plugin-info-cell">...</div>
        <div class="plugin-status-cell">...</div>
        <div class="plugin-actions-cell">...</div>
      </div>
    </div>
  </div>
</div>
```

### 3. Update Script Section

Add to the script section:

```typescript
import { computed } from 'vue';

// Separate plugins by priority
const sortablePlugins = computed(() =>
  plugins.value.filter(p => p.priority !== undefined && p.priority !== null)
);

const otherPlugins = computed(() =>
  plugins.value.filter(p => p.priority === undefined || p.priority === null)
);

// Drag-n-drop state
let draggedIndex: number | null = null;

const handleDragStart = (index: number, event: DragEvent) => {
  draggedIndex = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', (event.target as HTMLElement).innerHTML);
  }
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
};

const handleDrop = async (targetIndex: number, event: DragEvent) => {
  event.preventDefault();

  if (draggedIndex === null || draggedIndex === targetIndex) {
    return;
  }

  // Reorder the sortable plugins array
  const items = [...sortablePlugins.value];
  const [removed] = items.splice(draggedIndex, 1);
  items.splice(targetIndex, 0, removed);

  // Update the main plugins array
  const newPlugins = [
    ...items,
    ...otherPlugins.value
  ];
  plugins.value = newPlugins;

  // Send new order to backend
  const pluginIds = items.map(p => p.id);
  try {
    await fetch(`${api.baseUrl}/api/plugins/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginIds })
    });
  } catch (error) {
    console.error('Failed to reorder plugins:', error);
    // Optionally: revert the local change and show error
    await loadPlugins();
  }
};

const handleDragEnd = () => {
  draggedIndex = null;
};
```

### 4. Add CSS Styles

Add to the `<style>` section:

```css
.plugins-container {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.plugins-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.section-divider {
  height: 1px;
  background: var(--color-border);
  margin: 16px 0;
}

.plugins-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-row {
  display: grid;
  grid-template-columns: 32px 48px 1fr auto auto;
  gap: 16px;
  align-items: center;
  padding: 12px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  transition: all 0.15s ease;
}

.plugin-row:hover {
  background: var(--color-surface-hover);
}

.plugin-row[draggable="true"] {
  cursor: move;
}

.plugin-row.dragging {
  opacity: 0.5;
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle-placeholder {
  width: 32px;
}

.plugin-icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.plugin-icon-small {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-small);
}

.plugin-icon-placeholder {
  width: 32px;
  height: 32px;
  opacity: 0.3;
}

.plugin-info-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plugin-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.plugin-category {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.plugin-status-cell {
  display: flex;
  align-items: center;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.status-enabled {
  background: rgba(46, 160, 67, 0.15);
  color: var(--color-success);
}

.status-disabled {
  background: rgba(128, 128, 128, 0.15);
  color: var(--color-text-secondary);
}

.plugin-actions-cell {
  display: flex;
  gap: 8px;
  align-items: center;
}
```

### 5. Update TypeScript Interface

In `/Users/francis/projects/ncSender/app/client/src/features/plugins/api.ts`, update the `PluginListItem` interface to include:

```typescript
export interface PluginListItem {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  category: string;  // ADD THIS
  priority?: number; // ADD THIS
  loaded: boolean;
  loadedAt?: string;
  installedAt: string;
  hasConfig: boolean;
  hasIcon: boolean;
  author?: string;
}
```

## Testing Checklist
- [ ] Sortable plugins show with drag handles
- [ ] Other plugins show without drag handles
- [ ] Drag-n-drop updates order visually
- [ ] Drag-n-drop persists order via API
- [ ] Priority values update correctly (100, 90, 80...)
- [ ] Plugin execution order follows new priorities

## Notes
- This is a significant UI change from card-based to table-based layout
- Consider user feedback before fully committing to this change
- May want to make this an optional view toggle

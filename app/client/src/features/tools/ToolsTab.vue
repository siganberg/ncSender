<!--
  This file is part of ncSender.

  ncSender is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  ncSender is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with ncSender. If not, see <https://www.gnu.org/licenses/>.
-->

<template>
  <div class="tools-tab">
    <div class="tools-content">
      <div class="tools-inner-content">
        <!-- Header with search and actions -->
        <div class="tools-header">
        <input
          type="text"
          class="tool-search"
          v-model="searchQuery"
          placeholder="Search tools by T#, name, or type..."
        >
        <button class="import-export-button" @click="importTools">Import</button>
        <button class="import-export-button" @click="exportTools">Export</button>
        <button class="btn btn-primary" @click="addNewTool">Add Tool</button>
      </div>

      <!-- Table container with empty state -->
      <div v-if="filteredTools.length === 0" class="empty-state">
        <div class="empty-state-text">No tools found</div>
        <div class="empty-state-hint">Click "Add Tool" to add your first tool</div>
      </div>

      <!-- Tools table -->
      <div v-else class="tools-table-container">
        <table class="tools-table">
        <thead>
          <tr>
            <th class="col-tool-number">
              <button
                class="column-header"
                :class="{ 'column-header--active': sortBy === 'toolNumber' }"
                @click="toggleSort('toolNumber')"
              >
                <span>Tool #</span>
                <svg v-if="sortBy === 'toolNumber'" class="sort-icon" :class="{ 'sort-icon--desc': sortOrder === 'desc' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              </button>
            </th>
            <th class="col-description">
              <button
                class="column-header"
                :class="{ 'column-header--active': sortBy === 'name' }"
                @click="toggleSort('name')"
              >
                <span>Description</span>
                <svg v-if="sortBy === 'name'" class="sort-icon" :class="{ 'sort-icon--desc': sortOrder === 'desc' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              </button>
            </th>
            <th class="col-type">
              <button
                class="column-header"
                :class="{ 'column-header--active': sortBy === 'type' }"
                @click="toggleSort('type')"
              >
                <span>Type</span>
                <svg v-if="sortBy === 'type'" class="sort-icon" :class="{ 'sort-icon--desc': sortOrder === 'desc' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              </button>
            </th>
            <th class="col-diameter">
              <button
                class="column-header"
                :class="{ 'column-header--active': sortBy === 'diameter' }"
                @click="toggleSort('diameter')"
              >
                <span>Diameter ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</span>
                <svg v-if="sortBy === 'diameter'" class="sort-icon" :class="{ 'sort-icon--desc': sortOrder === 'desc' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              </button>
            </th>
            <th class="col-tlo">
              <button
                class="column-header"
                :class="{ 'column-header--active': sortBy === 'tlo' }"
                @click="toggleSort('tlo')"
              >
                <span>TLO ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</span>
                <svg v-if="sortBy === 'tlo'" class="sort-icon" :class="{ 'sort-icon--desc': sortOrder === 'desc' }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              </button>
            </th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="tool in filteredTools" :key="tool.id">
            <td class="col-tool-number">
              <select 
                class="tool-number-select"
                :class="{ 'tool-number-select-empty': tool.toolNumber === null }"
                :value="tool.toolNumber" 
                @change="updateToolNumber(tool, ($event.target as HTMLSelectElement).value)"
              >
                <option :value="null">-</option>
                <option
                  v-for="num in maxToolCount"
                  :key="num"
                  :value="num"
                >
                  T{{ num }}{{ getToolNumberInfoForTool(num, tool) }}
                </option>
              </select>
            </td>
            <td class="col-description">{{ tool.name }}</td>
            <td class="col-type">{{ formatType(tool.type) }}</td>
            <td class="col-diameter">{{ formatCoordinate(tool.diameter, appStore.unitsPreference.value) }}</td>
            <td class="col-tlo">{{ formatCoordinate(tool.offsets.tlo, appStore.unitsPreference.value) }}</td>
            <td class="col-actions">
              <div class="tool-actions">
                <button class="btn btn-small btn-accent" @click="editTool(tool)">Edit</button>
                <button class="btn btn-small btn-danger" @click="deleteTool(tool)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

        <!-- Footer with tool count and controls -->
        <div class="tools-footer">
          <div class="tools-footer-content">
            <div class="tools-footer-row">
              <div class="tool-settings">
                <div class="setting-item">
                  <label class="setting-label">Magazine Size</label>
                  <select class="setting-select" :value="toolCount" @change="handleMagazineSizeChange" :disabled="toolCountDisabled">
                    <option v-for="n in 99" :key="n-1" :value="n-1">{{ n-1 }}</option>
                  </select>
                </div>
                <div class="setting-item">
                  <label class="setting-label">Manual</label>
                  <ToggleSwitch :modelValue="showManualButton" @update:modelValue="$emit('update:showManualButton', $event)" :disabled="toolCountDisabled" />
                </div>
                <div class="setting-item">
                  <label class="setting-label">TLS</label>
                  <ToggleSwitch :modelValue="showTlsButton" @update:modelValue="$emit('update:showTlsButton', $event)" :disabled="toolCountDisabled" />
                </div>
                <div class="setting-item">
                  <label class="setting-label">Probe</label>
                  <ToggleSwitch :modelValue="showProbeButton" @update:modelValue="$emit('update:showProbeButton', $event)" :disabled="toolCountDisabled" />
                </div>
              </div>
              <div class="tool-count">{{ tools.length }} tool{{ tools.length !== 1 ? 's' : '' }} total</div>
            </div>
            <div v-if="toolSourceName" class="settings-note">
              Controls are disabled because they are currently controlled by Plugin: {{ toolSourceName }}
            </div>
            <div v-if="storagePath" class="tools-storage-info" :title="storagePath">
              Storage: <em>{{ storagePath }}</em>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tool Form Modal -->
    <div v-if="showToolForm" class="modal-overlay" @click.self="closeToolForm">
      <div class="modal-content">
        <div class="modal-header">{{ editingTool ? 'Edit Tool' : 'Add Tool' }}</div>
        <form @submit.prevent="saveTool" class="modal-form">
          <div class="modal-body">
            <!-- Tool Number -->
            <div class="form-group">
              <label class="form-label">Tool Number (T#)</label>
              <select class="form-select" v-model="toolForm.toolNumber">
                <option :value="null">None (Not in magazine)</option>
                <option
                  v-for="num in maxToolCount"
                  :key="num"
                  :value="num"
                >
                  T{{ num }}{{ getToolNumberInfo(num) }}
                </option>
              </select>
            </div>

            <!-- Tool Name -->
            <div class="form-group">
              <label class="form-label required">Tool Name / Description</label>
              <input
                type="text"
                class="form-input"
                v-model="toolForm.name"
                placeholder="e.g., 1/4in Flat Endmill"
                required
              >
              <div v-if="formErrors.name" class="form-error">{{ formErrors.name }}</div>
            </div>

            <!-- Tool Type -->
            <div class="form-group">
              <label class="form-label required">Tool Type</label>
              <select class="form-select" v-model="toolForm.type" required>
                <option value="flat">Flat End Mill</option>
                <option value="ball">Ball End Mill</option>
                <option value="v-bit">V-Bit</option>
                <option value="drill">Drill</option>
                <option value="chamfer">Chamfer</option>
                <option value="surfacing">Surfacing</option>
                <option value="thread-mill">Thread Mill</option>
                <option value="probe">Probe</option>
              </select>
            </div>

            <!-- Diameter and TLO -->
            <div class="form-row">
              <div class="form-group">
                <label class="form-label required">Diameter ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</label>
                <input
                  type="number"
                  class="form-input"
                  v-model.number="toolForm.diameter"
                  min="0.0001"
                  step="any"
                  :placeholder="diameterPlaceholder"
                  required
                >
                <div v-if="formErrors.diameter" class="form-error">{{ formErrors.diameter }}</div>
              </div>
              <div class="form-group">
                <label class="form-label">TLO ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</label>
                <input
                  type="number"
                  class="form-input"
                  v-model.number="toolForm.offsets.tlo"
                  step="any"
                  :placeholder="tloPlaceholder"
                >
              </div>
            </div>

            <!-- TLS X/Y/Z Offsets -->
            <div class="form-row form-row-3">
              <div class="form-group">
                <label class="form-label">TLS X Offset ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</label>
                <input
                  type="number"
                  class="form-input"
                  v-model.number="toolForm.offsets.x"
                  step="any"
                  :placeholder="tloPlaceholder"
                >
              </div>
              <div class="form-group">
                <label class="form-label">TLS Y Offset ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</label>
                <input
                  type="number"
                  class="form-input"
                  v-model.number="toolForm.offsets.y"
                  step="any"
                  :placeholder="tloPlaceholder"
                >
              </div>
              <div class="form-group">
                <label class="form-label">TLS Z Offset ({{ getDistanceUnitLabel(appStore.unitsPreference.value) }})</label>
                <input
                  type="number"
                  class="form-input"
                  v-model.number="toolForm.offsets.z"
                  step="any"
                  :placeholder="tloPlaceholder"
                >
              </div>
            </div>

            <!-- Notes -->
            <div class="form-group">
              <label class="form-label">Notes</label>
              <textarea
                class="form-textarea"
                v-model="toolForm.metadata.notes"
                placeholder="Any additional information about this tool..."
              ></textarea>
            </div>

            <!-- SKU -->
            <div class="form-group">
              <label class="form-label">SKU / Part Number</label>
              <input
                type="text"
                class="form-input"
                v-model="toolForm.metadata.sku"
                placeholder="e.g., MANUFACTURER-12345"
              >
            </div>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeToolForm">Cancel</button>
            <button type="submit" class="btn btn-primary">{{ editingTool ? 'Save Changes' : 'Add Tool' }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Hidden file input for import -->
    <input
      ref="importFileInput"
      type="file"
      accept=".json"
      style="display: none"
      @change="handleImport"
    >

    <!-- Save Error Dialog -->
    <Dialog v-if="showSaveErrorDialog" @close="showSaveErrorDialog = false" :show-header="false" size="small">
      <ConfirmPanel
        title="Error Saving Tool"
        :message="saveErrorMessage"
        :show-cancel="false"
        confirm-text="OK"
        variant="primary"
        @confirm="showSaveErrorDialog = false"
      />
    </Dialog>

    <!-- Delete Confirmation Dialog -->
    <Dialog v-if="showDeleteConfirmDialog" @close="showDeleteConfirmDialog = false" :show-header="false" size="small">
      <ConfirmPanel
        title="Delete Tool"
        :message="`Are you sure you want to delete ${deleteToolRef?.name}?`"
        :show-cancel="true"
        confirm-text="Delete"
        cancel-text="Cancel"
        variant="danger"
        @confirm="confirmDeleteTool"
        @cancel="showDeleteConfirmDialog = false"
      />
    </Dialog>

    <!-- Delete Error Dialog -->
    <Dialog v-if="showDeleteErrorDialog" @close="showDeleteErrorDialog = false" :show-header="false" size="small">
      <ConfirmPanel
        title="Error Deleting Tool"
        :message="deleteErrorMessage"
        :show-cancel="false"
        confirm-text="OK"
        variant="primary"
        @confirm="showDeleteErrorDialog = false"
      />
    </Dialog>

    <!-- Export Warning Dialog -->
    <Dialog v-if="showExportWarningDialog" @close="showExportWarningDialog = false" :show-header="false" size="small">
      <ConfirmPanel
        title="No Tools to Export"
        message="There are no tools in your library to export."
        :show-cancel="false"
        confirm-text="OK"
        variant="primary"
        @confirm="showExportWarningDialog = false"
      />
    </Dialog>

    <!-- Import Error Dialog -->
    <Dialog v-if="showImportErrorDialog" @close="showImportErrorDialog = false" :show-header="false" size="small">
      <ConfirmPanel
        title="Import Error"
        :message="importErrorMessage"
        :show-cancel="false"
        confirm-text="OK"
        variant="primary"
        @confirm="showImportErrorDialog = false"
      />
    </Dialog>

    <!-- Import Conflict Dialog -->
    <Dialog v-if="showImportConflictDialog" @close="showImportConflictDialog = false" :show-header="false" size="small">
      <ConfirmPanel
        title="Confirm Import"
        :message="importConflictMessage"
        :show-cancel="true"
        confirm-text="Replace and Import"
        cancel-text="Cancel"
        variant="primary"
        @confirm="confirmImportWithConflicts"
        @cancel="showImportConflictDialog = false"
      />
    </Dialog>

    <!-- Import Success Dialog -->
    <Dialog v-if="showImportSuccessDialog" @close="showImportSuccessDialog = false" :show-header="false" size="small">
      <ConfirmPanel
        title="Import Successful"
        :message="importSuccessMessage"
        :show-cancel="false"
        confirm-text="OK"
        variant="primary"
        @confirm="showImportSuccessDialog = false"
      />
    </Dialog>

    <!-- Magazine Size Confirmation Dialog -->
    <Dialog v-if="showMagazineSizeConfirmDialog" @close="cancelMagazineSizeChange" :show-header="false" size="small">
      <ConfirmPanel
        title="Reduce Magazine Size"
        :message="`Changing magazine size to ${pendingMagazineSize} will unassign ${affectedToolsCount} tool${affectedToolsCount !== 1 ? 's' : ''} that ${affectedToolsCount !== 1 ? 'are' : 'is'} currently assigned to slots T${(pendingMagazineSize || 0) + 1} and above. Do you want to continue?`"
        :show-cancel="true"
        confirm-text="Confirm"
        cancel-text="Cancel"
        variant="primary"
        @confirm="confirmMagazineSizeChange"
        @cancel="cancelMagazineSizeChange"
      />
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '../../lib/api.js';
import { settingsStore, updateSettings } from '../../lib/settings-store.js';
import Dialog from '../../components/Dialog.vue';
import ConfirmPanel from '../../components/ConfirmPanel.vue';
import ToggleSwitch from '../../components/ToggleSwitch.vue';
import { formatCoordinate, getDistanceUnitLabel, parseDistanceInput } from '@/lib/units';
import { useAppStore } from '@/composables/use-app-store';

interface Tool {
  id: number;
  toolNumber: number | null;
  name: string;
  type: string;
  diameter: number;
  offsets: {
    tlo: number;
    x: number;
    y: number;
    z: number;
  };
  metadata: {
    notes: string;
    image: string;
    sku: string;
  };
  dimensions?: {
    flute_length: number | null;
    overall_length: number | null;
    taper_angle: number | null;
    radius: number | null;
    stickout: number | null;
  };
  specs?: {
    material: string | null;
    coating: string | null;
  };
  life?: {
    enabled: boolean;
    total_minutes: number | null;
    used_minutes: number;
    remaining_minutes: number | null;
    usage_count: number;
  };
}

const props = defineProps<{
  maxToolCount?: number;
  toolCount?: number;
  showManualButton?: boolean;
  showTlsButton?: boolean;
  showProbeButton?: boolean;
  toolCountDisabled?: boolean;
  toolSourceName?: string | null;
}>();

const emit = defineEmits<{
  'update:toolCount': [value: number];
  'update:showManualButton': [value: boolean];
  'update:showTlsButton': [value: boolean];
  'update:showProbeButton': [value: boolean];
}>();

// App store for units preference
const appStore = useAppStore();

// Computed
const maxToolCount = computed(() => props.maxToolCount || 1);
const diameterStep = computed(() => appStore.unitsPreference.value === 'imperial' ? 0.0001 : 0.001);
const diameterPlaceholder = computed(() => appStore.unitsPreference.value === 'imperial' ? '0.2500' : '6.350');
const tloPlaceholder = computed(() => appStore.unitsPreference.value === 'imperial' ? '0.0000' : '0.000');

// State
const tools = ref<Tool[]>([]);
const storagePath = ref('');
const searchQuery = ref('');
const showToolForm = ref(false);
const editingTool = ref<Tool | null>(null);
const importFileInput = ref<HTMLInputElement | null>(null);
const formErrors = ref<Record<string, string>>({});

// Sorting state
type SortField = 'toolNumber' | 'name' | 'type' | 'diameter' | 'tlo';
type SortOrder = 'asc' | 'desc';
const sortBy = ref<SortField>('toolNumber');
const sortOrder = ref<SortOrder>('asc');

// Dialog state
const showSaveErrorDialog = ref(false);
const saveErrorMessage = ref('');
const showDeleteConfirmDialog = ref(false);
const deleteToolRef = ref<Tool | null>(null);
const showDeleteErrorDialog = ref(false);
const deleteErrorMessage = ref('');
const showExportWarningDialog = ref(false);
const showImportErrorDialog = ref(false);
const importErrorMessage = ref('');
const showImportConflictDialog = ref(false);
const importConflictMessage = ref('');
const importConflictTools = ref<Tool[]>([]);
const showImportSuccessDialog = ref(false);
const importSuccessMessage = ref('');
const showMagazineSizeConfirmDialog = ref(false);
const pendingMagazineSize = ref<number | null>(null);
const affectedToolsCount = ref(0);

// Tool form data
const defaultToolForm = () => ({
  id: 0,
  toolNumber: null as number | null,
  name: '',
  type: 'flat',
  diameter: 0,
  offsets: {
    tlo: 0,
    x: 0,
    y: 0,
    z: 0
  },
  metadata: {
    notes: '',
    image: '',
    sku: ''
  },
  dimensions: {
    flute_length: null,
    overall_length: null,
    taper_angle: null,
    radius: null,
    stickout: null
  },
  specs: {
    material: null,
    coating: null
  },
  life: {
    enabled: false,
    total_minutes: null,
    used_minutes: 0,
    remaining_minutes: null,
    usage_count: 0
  }
});

const toolForm = ref(defaultToolForm());

const toggleSort = async (field: SortField) => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = field;
    sortOrder.value = 'asc';
  }
  // Persist sorting preferences
  await updateSettings({
    toolLibrary: {
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    }
  });
};

// Computed
const filteredTools = computed(() => {
  let result = tools.value;

  // Filter by search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase().trim();
    result = result.filter(tool => {
      const toolNum = tool.toolNumber !== null && tool.toolNumber !== undefined
        ? tool.toolNumber.toString()
        : '';

      // Handle "T7" format - strip the "T" prefix if present
      const searchTerm = query.startsWith('t') ? query.substring(1) : query;

      return toolNum.includes(searchTerm) ||
        tool.name.toLowerCase().includes(query) ||
        tool.type.toLowerCase().includes(query);
    });
  }

  // Sort based on current sort settings
  result = [...result].sort((a, b) => {
    let comparison = 0;
    
    if (sortBy.value === 'toolNumber') {
      const aVal = a.toolNumber !== null && a.toolNumber !== undefined ? a.toolNumber : 9999;
      const bVal = b.toolNumber !== null && b.toolNumber !== undefined ? b.toolNumber : 9999;
      comparison = aVal - bVal;
    } else if (sortBy.value === 'name') {
      comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    } else if (sortBy.value === 'type') {
      comparison = a.type.localeCompare(b.type, undefined, { sensitivity: 'base' });
    } else if (sortBy.value === 'diameter') {
      comparison = a.diameter - b.diameter;
    } else if (sortBy.value === 'tlo') {
      comparison = a.offsets.tlo - b.offsets.tlo;
    }

    return sortOrder.value === 'asc' ? comparison : -comparison;
  });

  return result;
});

// Methods
const loadTools = async () => {
  try {
    const response = await fetch(`${api.baseUrl}/api/tools`);
    if (response.ok) {
      tools.value = await response.json();
    } else {
      console.error('Failed to load tools');
    }
  } catch (error) {
    console.error('Error loading tools:', error);
  }
};

const loadToolsInfo = async () => {
  try {
    const response = await fetch(`${api.baseUrl}/api/tools/info`);
    if (response.ok) {
      const info = await response.json();
      storagePath.value = info.storagePath || '';
    }
  } catch (error) {
    console.error('Error loading tools info:', error);
  }
};

const handleMagazineSizeChange = (event: Event) => {
  const newSize = parseInt((event.target as HTMLSelectElement).value);
  const currentSize = props.toolCount || 0;

  if (newSize < currentSize) {
    // Check if there are any tools with toolNumber > newSize (1-indexed, so T1-T6 for size 6)
    const affectedTools = tools.value.filter(t => t.toolNumber !== null && t.toolNumber > newSize);

    if (affectedTools.length > 0) {
      // Show confirmation dialog
      pendingMagazineSize.value = newSize;
      affectedToolsCount.value = affectedTools.length;
      showMagazineSizeConfirmDialog.value = true;
      return;
    }
  }

  // No confirmation needed, emit the change
  emit('update:toolCount', newSize);
};

const confirmMagazineSizeChange = async () => {
  if (pendingMagazineSize.value === null) return;

  const newSize = pendingMagazineSize.value;

  // Unassign tools with toolNumber > newSize (1-indexed)
  const affectedTools = tools.value.filter(t => t.toolNumber !== null && t.toolNumber > newSize);

  try {
    for (const tool of affectedTools) {
      const response = await fetch(`${api.baseUrl}/api/tools/${tool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tool,
          toolNumber: null
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to unassign tool ${tool.id}`);
      }
    }

    // Reload tools to reflect changes
    await loadTools();

    // Emit the magazine size change
    emit('update:toolCount', newSize);

    // Close dialog
    showMagazineSizeConfirmDialog.value = false;
    pendingMagazineSize.value = null;
  } catch (error) {
    console.error('Error unassigning tools:', error);
    showDeleteErrorDialog.value = true;
    deleteErrorMessage.value = 'Failed to unassign tools. Please try again.';
  }
};

const cancelMagazineSizeChange = () => {
  showMagazineSizeConfirmDialog.value = false;
  pendingMagazineSize.value = null;
  affectedToolsCount.value = 0;
};

const formatType = (type: string) => {
  const typeMap: Record<string, string> = {
    'flat': 'Flat End Mill',
    'ball': 'Ball End Mill',
    'v-bit': 'V-Bit',
    'drill': 'Drill',
    'chamfer': 'Chamfer',
    'surfacing': 'Surfacing',
    'probe': 'Probe',
    'thread-mill': 'Thread Mill'
  };
  return typeMap[type] || type;
};

const getToolNumberInfo = (num: number) => {
  // If editing a tool and this is the current tool number, don't show any info
  if (editingTool.value?.toolNumber === num) {
    return '';
  }

  // Find if another tool is using this number
  const assignedTool = tools.value.find(t => t.toolNumber === num && t.id !== editingTool.value?.id);

  if (assignedTool) {
    // If editing, show "Swap with", if adding new, show "Already assigned to"
    return editingTool.value
      ? ` (Swap with: ${assignedTool.name})`
      : ` (Already assigned to: ${assignedTool.name})`;
  }

  return '';
};

const getToolNumberInfoForTool = (num: number, tool: Tool) => {
  // If this is the current tool number, don't show any info
  if (tool.toolNumber === num) {
    return '';
  }

  // Find if another tool is using this number
  const assignedTool = tools.value.find(t => t.toolNumber === num && t.id !== tool.id);

  if (assignedTool) {
    return ` (Swap: ${assignedTool.name})`;
  }

  return '';
};

const updateToolNumber = async (tool: Tool, newValue: string | null) => {
  // Convert newValue to number or null
  const newToolNumber = newValue === 'null' || newValue === null ? null : parseInt(newValue as string);
  const oldToolNumber = tool.toolNumber;

  // If the value didn't change, do nothing
  if (newToolNumber === oldToolNumber) {
    return;
  }

  try {
    // Find if another tool is using the target tool number
    const conflictingTool = tools.value.find(t =>
      t.toolNumber === newToolNumber &&
      t.id !== tool.id
    );

    if (conflictingTool && newToolNumber !== null && newToolNumber !== undefined) {
      // Swap operation needed
      console.log('Swapping tools:', { current: tool.id, conflicting: conflictingTool.id });

      // Step 1: Unassign the conflicting tool temporarily
      const unassignResponse = await fetch(`${api.baseUrl}/api/tools/${conflictingTool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...conflictingTool,
          toolNumber: null
        })
      });

      if (!unassignResponse.ok) {
        const error = await unassignResponse.json();
        console.log('Tool unassign error:', JSON.stringify(error));
        saveErrorMessage.value = 'Failed to swap tool numbers';
        showSaveErrorDialog.value = true;
        return;
      }

      // Step 2: Update the current tool with the new number
      const updateResponse = await fetch(`${api.baseUrl}/api/tools/${tool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tool,
          toolNumber: newToolNumber
        })
      });

      if (!updateResponse.ok) {
        const error = await updateResponse.json();
        console.log('Tool update error:', JSON.stringify(error));
        saveErrorMessage.value = 'Failed to update tool number';
        showSaveErrorDialog.value = true;
        return;
      }

      // Step 3: If the original tool had a number, assign it to the conflicting tool (complete the swap)
      if (oldToolNumber !== null && oldToolNumber !== undefined) {
        const swapResponse = await fetch(`${api.baseUrl}/api/tools/${conflictingTool.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...conflictingTool,
            toolNumber: oldToolNumber
          })
        });

        if (!swapResponse.ok) {
          console.log('Warning: Failed to complete swap by assigning old number to conflicting tool');
          // Don't fail the whole operation if this step fails
        }
      }
    } else {
      // No swap needed, just update normally
      const response = await fetch(`${api.baseUrl}/api/tools/${tool.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tool,
          toolNumber: newToolNumber
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.log('Tool update error:', JSON.stringify(error));
        saveErrorMessage.value = 'Failed to update tool number';
        showSaveErrorDialog.value = true;
        return;
      }
    }

    // Reload tools to reflect changes
    await loadTools();
  } catch (error) {
    console.error('Error updating tool number:', error);
    saveErrorMessage.value = 'Failed to update tool number';
    showSaveErrorDialog.value = true;
  }
};

const addNewTool = () => {
  editingTool.value = null;
  toolForm.value = defaultToolForm();
  formErrors.value = {};
  showToolForm.value = true;
};

const editTool = (tool: Tool) => {
  editingTool.value = tool;
  const toolCopy = JSON.parse(JSON.stringify(tool));

  // Convert values to display units if in imperial mode
  const units = appStore.unitsPreference.value;
  if (units === 'imperial') {
    toolCopy.diameter = parseFloat((toolCopy.diameter / 25.4).toFixed(4));
    toolCopy.offsets.tlo = parseFloat((toolCopy.offsets.tlo / 25.4).toFixed(4));
    toolCopy.offsets.x = parseFloat(((toolCopy.offsets.x || 0) / 25.4).toFixed(4));
    toolCopy.offsets.y = parseFloat(((toolCopy.offsets.y || 0) / 25.4).toFixed(4));
    toolCopy.offsets.z = parseFloat(((toolCopy.offsets.z || 0) / 25.4).toFixed(4));
  }

  toolForm.value = toolCopy;
  formErrors.value = {};
  showToolForm.value = true;
};

const closeToolForm = () => {
  showToolForm.value = false;
  editingTool.value = null;
  toolForm.value = defaultToolForm();
  formErrors.value = {};
};

const validateToolForm = () => {
  formErrors.value = {};
  let isValid = true;

  if (!toolForm.value.name || toolForm.value.name.trim() === '') {
    formErrors.value.name = 'Tool name is required';
    isValid = false;
  }

  if (!toolForm.value.diameter || toolForm.value.diameter <= 0) {
    formErrors.value.diameter = 'Diameter must be greater than 0';
    isValid = false;
  }

  return isValid;
};

const saveTool = async () => {
  if (!validateToolForm()) {
    return;
  }

  try {
    const toolData = { ...toolForm.value };

    // Convert values back to mm if in imperial mode
    const units = appStore.unitsPreference.value;
    if (units === 'imperial') {
      toolData.diameter = toolData.diameter * 25.4;
      toolData.offsets.tlo = toolData.offsets.tlo * 25.4;
      toolData.offsets.x = (toolData.offsets.x || 0) * 25.4;
      toolData.offsets.y = (toolData.offsets.y || 0) * 25.4;
      toolData.offsets.z = (toolData.offsets.z || 0) * 25.4;
    }

    console.log('Saving tool data:', JSON.stringify(toolData));

    if (editingTool.value) {
      // Check if we're swapping tool numbers
      const newToolNumber = toolData.toolNumber;
      const oldToolNumber = editingTool.value.toolNumber;

      // Find if another tool is using the target tool number
      const conflictingTool = tools.value.find(t =>
        t.toolNumber === newToolNumber &&
        t.id !== editingTool.value.id
      );

      if (conflictingTool && newToolNumber !== null && newToolNumber !== undefined) {
        // Swap operation needed
        console.log('Swapping tools:', { current: editingTool.value.id, conflicting: conflictingTool.id });

        // Step 1: Unassign the conflicting tool temporarily
        const unassignResponse = await fetch(`${api.baseUrl}/api/tools/${conflictingTool.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...conflictingTool,
            toolNumber: null
          })
        });

        if (!unassignResponse.ok) {
          const error = await unassignResponse.json();
          console.log('Tool unassign error:', JSON.stringify(error));
          saveErrorMessage.value = 'Failed to unassign conflicting tool';
          showSaveErrorDialog.value = true;
          return;
        }

        // Step 2: Update the current tool with the new number
        const updateResponse = await fetch(`${api.baseUrl}/api/tools/${editingTool.value.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toolData)
        });

        if (!updateResponse.ok) {
          const error = await updateResponse.json();
          console.log('Tool update error:', JSON.stringify(error));
          const errorMsg = error.errors ? JSON.stringify(error.errors) : (error.error || 'Unknown error');
          saveErrorMessage.value = 'Failed to update tool: ' + errorMsg;
          showSaveErrorDialog.value = true;
          return;
        }

        // Step 3: If the original tool had a number, assign it to the conflicting tool (complete the swap)
        if (oldToolNumber !== null && oldToolNumber !== undefined) {
          const swapResponse = await fetch(`${api.baseUrl}/api/tools/${conflictingTool.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...conflictingTool,
              toolNumber: oldToolNumber
            })
          });

          if (!swapResponse.ok) {
            console.log('Warning: Failed to complete swap by assigning old number to conflicting tool');
            // Don't fail the whole operation if this step fails
          }
        }
      } else {
        // No swap needed, just update normally
        const response = await fetch(`${api.baseUrl}/api/tools/${editingTool.value.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toolData)
        });

        if (!response.ok) {
          const error = await response.json();
          console.log('Tool update error:', JSON.stringify(error));
          const errorMsg = error.errors ? JSON.stringify(error.errors) : (error.error || 'Unknown error');
          saveErrorMessage.value = 'Failed to update tool: ' + errorMsg;
          showSaveErrorDialog.value = true;
          return;
        }
      }
    } else {
      // Add new tool
      const response = await fetch(`${api.baseUrl}/api/tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toolData)
      });

      if (!response.ok) {
        const error = await response.json();
        saveErrorMessage.value = 'Failed to add tool: ' + (error.error || 'Unknown error');
        showSaveErrorDialog.value = true;
        return;
      }
    }

    await loadTools();
    closeToolForm();
  } catch (error) {
    console.error('Error saving tool:', error);
    saveErrorMessage.value = 'Failed to save tool';
    showSaveErrorDialog.value = true;
  }
};

const deleteTool = (tool: Tool) => {
  deleteToolRef.value = tool;
  showDeleteConfirmDialog.value = true;
};

const confirmDeleteTool = async () => {
  const tool = deleteToolRef.value;
  if (!tool) return;

  showDeleteConfirmDialog.value = false;

  try {
    const response = await fetch(`${api.baseUrl}/api/tools/${tool.id}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      await loadTools();
    } else {
      const error = await response.json();
      deleteErrorMessage.value = 'Failed to delete tool: ' + (error.error || 'Unknown error');
      showDeleteErrorDialog.value = true;
    }
  } catch (error) {
    console.error('Error deleting tool:', error);
    deleteErrorMessage.value = 'Failed to delete tool';
    showDeleteErrorDialog.value = true;
  } finally {
    deleteToolRef.value = null;
  }
};

const exportTools = () => {
  if (tools.value.length === 0) {
    showExportWarningDialog.value = true;
    return;
  }

  const json = JSON.stringify(tools.value, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tool-library-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const importTools = () => {
  importFileInput.value?.click();
};

const handleImport = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const importedTools = JSON.parse(e.target?.result as string);

      if (!Array.isArray(importedTools)) {
        importErrorMessage.value = 'Invalid file format. Expected an array of tools.';
        showImportErrorDialog.value = true;
        return;
      }

      // Check for conflicts
      const conflicts = importedTools.filter(importTool =>
        tools.value.some(existingTool => existingTool.id === importTool.id)
      );

      if (conflicts.length > 0) {
        const conflictList = conflicts.map(t => `T${t.id}`).join(', ');
        importConflictMessage.value = `The following tool IDs already exist: ${conflictList}\n\nDo you want to replace existing tools and import?`;
        importConflictTools.value = importedTools;
        showImportConflictDialog.value = true;
        return;
      }

      // No conflicts, proceed with import
      await performImport(importedTools);
    } catch (error) {
      importErrorMessage.value = 'Failed to import tools. Invalid JSON file.';
      showImportErrorDialog.value = true;
      console.error('Import error:', error);
    }
  };
  reader.readAsText(file);

  // Reset file input
  target.value = '';
};

const performImport = async (importedTools: Tool[]) => {
  // Merge tools
  const mergedTools = [...tools.value];
  importedTools.forEach(importTool => {
    const existingIndex = mergedTools.findIndex(t => t.id === importTool.id);
    if (existingIndex >= 0) {
      mergedTools[existingIndex] = importTool;
    } else {
      mergedTools.push(importTool);
    }
  });

  // Save via bulk update
  const response = await fetch(`${api.baseUrl}/api/tools`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mergedTools)
  });

  if (response.ok) {
    await loadTools();
    importSuccessMessage.value = `Successfully imported ${importedTools.length} tool(s)`;
    showImportSuccessDialog.value = true;
  } else {
    const error = await response.json();
    importErrorMessage.value = 'Failed to import tools: ' + (error.error || 'Unknown error');
    showImportErrorDialog.value = true;
  }
};

const confirmImportWithConflicts = async () => {
  showImportConflictDialog.value = false;
  await performImport(importConflictTools.value);
  importConflictTools.value = [];
};

// Lifecycle
onMounted(async () => {
  // Load sorting preferences from settings
  const toolLibrarySettings = (settingsStore.data as any)?.toolLibrary;
  if (toolLibrarySettings?.sortBy) {
    sortBy.value = toolLibrarySettings.sortBy;
  }
  if (toolLibrarySettings?.sortOrder) {
    sortOrder.value = toolLibrarySettings.sortOrder;
  }

  await loadTools();
  await loadToolsInfo();

  // Load max tool count from settings
  try {
    const response = await fetch(`${api.baseUrl}/api/settings`);
    if (response.ok) {
      const settings = await response.json();
      maxToolCount.value = settings?.tool?.count || 1;
    }
  } catch (error) {
    console.error('Error loading tool count setting:', error);
  }
});
</script>

<style scoped>
.tools-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-text-primary);
}

.tools-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0;
}

.tools-inner-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.tool-settings {
  display: flex;
  gap: var(--gap-lg);
  align-items: center;
}

.tool-settings .setting-item {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.tool-settings .setting-label {
  font-size: 0.85rem;
  color: var(--color-text-primary);
  white-space: nowrap;
}

.tool-settings .setting-select {
  padding: 6px 12px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
}

.tool-settings .setting-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tools-header {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  padding: var(--gap-md);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.tool-search {
  flex: 1;
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.tool-search:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.tool-search::placeholder {
  color: var(--color-text-secondary);
}

.import-export-button {
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.import-export-button:hover {
  background: var(--color-border);
}

.tools-table-container {
  flex: 1;
  overflow-y: scroll;
  overflow-x: hidden;
  min-height: 0;
  background: var(--color-surface);
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
  padding-bottom: 30px;
}

.tools-table-container::-webkit-scrollbar {
  width: 8px;
  height: 0;
}

.tools-table-container::-webkit-scrollbar-track {
  background: transparent;
}

.tools-table-container::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 4px;
}

.tools-table-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}

.tools-table-container::-webkit-scrollbar-corner {
  background: transparent;
}

.tools-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.tools-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-surface-muted);
}

.tools-table thead::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -2px;
  height: 2px;
  background: var(--color-surface-muted);
  z-index: 11;
}

.tools-table thead::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--color-border);
}

.tools-table th {
  padding: 0;
  text-align: left;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 2px solid var(--color-border);
  background: var(--color-surface-muted);
}

.tools-table th.col-actions {
  text-align: center;
  padding: var(--gap-sm) var(--gap-md);
}

.column-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: var(--gap-sm) var(--gap-md);
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: inherit;
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
}

.column-header:hover {
  background: var(--color-border);
}

.column-header--active {
  color: var(--color-accent);
}

.sort-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.sort-icon--desc {
  transform: rotate(180deg);
}

.tools-table tbody tr:first-child td {
  padding-top: var(--gap-md);
}

.tools-table tbody tr:last-child td {
  padding-bottom: var(--gap-md);
}

.tools-table td {
  padding: var(--gap-sm) var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  vertical-align: middle;
}

.tools-table td:first-child {
  padding-left: var(--gap-md);
}

.tools-table td:last-child {
  padding-right: var(--gap-md);
}

.tools-table tbody tr:nth-child(even) {
  background: var(--color-surface-muted);
}

.tools-table tbody tr:hover {
  background: var(--color-border);
}

.col-tool-number {
  width: 12%;
  min-width: 120px;
  text-align: center;
}

.tool-number-badge {
  display: inline-block;
  padding: 6px 16px;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 500;
}

.tool-number-select {
  width: 100%;
  min-width: 100px;
  padding: 6px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tool-number-select:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
}

.tool-number-select:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.tool-number-select-empty {
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}

.tool-number-select-empty:hover {
  border-color: var(--color-text-secondary);
}

.tool-number-select-empty:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.col-description {
  width: 32%;
}

.col-type {
  width: 15%;
}

.col-diameter {
  width: 12%;
}

.col-tlo {
  width: 12%;
}

.col-actions {
  width: 21%;
  text-align: center;
}

.tool-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.tools-footer {
  padding: var(--gap-md);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  flex-shrink: 0;
}

.tools-footer-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tools-footer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tools-footer .tool-count {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.tools-footer .settings-note {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  font-style: italic;
  text-align: left;
}

.tools-storage-info {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 4px;
}

.tool-count {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  text-align: center;
}

.btn {
  border: none;
  border-radius: var(--radius-small);
  padding: var(--gap-sm) var(--gap-md);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  transition: background 0.2s ease;
}

.btn:hover {
  opacity: 0.9;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: var(--gap-sm) var(--gap-md);
  color: var(--color-text-primary);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-accent {
  background: var(--color-accent) !important;
  color: white !important;
  border: none !important;
}

.btn-danger {
  background: var(--color-danger, #f87171) !important;
  color: white !important;
  border: none !important;
}

.btn-small {
  padding: 10px 16px;
  font-size: 0.85rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
  flex: 1;
  min-height: 0;
}

.empty-state-text {
  font-size: 1rem;
  margin-bottom: 8px;
}

.empty-state-hint {
  font-size: 0.9rem;
  opacity: 0.7;
}

/* Modal overlay for Add/Edit form */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
}

.modal-content {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.modal-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px;
}

.modal-header {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--color-text-primary);
  padding: 24px 24px 16px;
  flex-shrink: 0;
}

.form-group {
  margin-bottom: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.form-row-3 {
  grid-template-columns: 1fr 1fr 1fr;
}

.form-row .form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}

.form-label.required::after {
  content: ' *';
  color: var(--color-error);
}

.form-input,
.form-select,
.form-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  box-sizing: border-box;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.form-error {
  color: var(--color-error);
  font-size: 0.85rem;
  margin-top: 4px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px 24px;
  border-top: 1px solid var(--color-border);
  flex-shrink: 0;
}
</style>

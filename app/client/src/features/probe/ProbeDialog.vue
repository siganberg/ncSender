<template>
  <Dialog v-if="show" @close="handleClose" size="medium-minus">
    <div class="probe-dialog">
      <div class="probe-dialog__header">
        <p class="probe-dialog__instructions">
          Position the probe needle as shown in the image. Push the probe needle gently to test that it triggers properly (red light should activate). Ensure the probe is positioned correctly for the selected probing axis.
        </p>
      </div>
      <div class="probe-dialog__content">
        <div class="probe-dialog__columns">
          <div class="probe-dialog__column probe-dialog__column--controls">
            <div class="probe-control-row">
              <div class="probe-control-group">
                <label class="probe-label">Probe Type</label>
                <select v-model="probeType" class="probe-select" :disabled="isProbing">
                  <option value="3d-probe">3D Probe</option>
                  <option value="standard-block">Standard Block</option>
                </select>
              </div>

              <div class="probe-control-group">
                <label class="probe-label">Probing Axis</label>
                <select v-model="probingAxis" class="probe-select" :disabled="isProbing">
                  <option value="Z">Z</option>
                  <option value="XYZ">XYZ</option>
                  <option value="XY">XY</option>
                  <option value="X">X</option>
                  <option value="Y">Y</option>
                  <option value="Center - Inner">Center - Inner</option>
                  <option value="Center - Outer">Center - Outer</option>
                </select>
              </div>
            </div>

            <template v-if="probeType === '3d-probe'">
              <div class="probe-control-row">
                <div class="probe-control-group">
                  <label class="probe-label">Diameter</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="ballPointDiameter"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                      :disabled="isProbing"
                      @input="validateBallPointDiameter"
                      @blur="handleBallPointDiameterBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.ballPointDiameter" class="probe-error">{{ errors.ballPointDiameter }}</span>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">Z-Plunge</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="zPlunge"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                      :disabled="isProbing"
                      @input="validateZPlunge"
                      @blur="handleZPlungeBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.zPlunge" class="probe-error">{{ errors.zPlunge }}</span>
                </div>
              </div>

              <div class="probe-control-row">
                <div class="probe-control-group">
                  <label class="probe-label">X Dimension</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="xDimension"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                      :disabled="isProbing"
                      @blur="handleXDimensionBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">Y Dimension</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="yDimension"
                      type="number"
                      step="0.1"
                      min="0.1"
                      class="probe-input"
                      :disabled="isProbing"
                      @blur="handleYDimensionBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                </div>
              </div>

              <div class="probe-control-group">
                <label class="probe-label">Z-Offset</label>
                <div class="probe-input-with-unit">
                  <input
                    v-model.number="zOffset"
                    type="number"
                    step="0.01"
                    class="probe-input"
                    :disabled="isProbing"
                    @input="validateZOffset"
                    @blur="handleZOffsetBlur"
                  />
                  <span class="probe-unit">mm</span>
                </div>
                <span v-if="errors.zOffset" class="probe-error">{{ errors.zOffset }}</span>
              </div>
            </template>

            <!-- Center probing fields (Center - Inner and Center - Outer) -->
            <template v-if="['Center - Inner', 'Center - Outer'].includes(probingAxis)">
              <div class="probe-control-row">
                <div class="probe-control-group">
                  <label class="probe-label">Rapid Movement</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="rapidMovement"
                      type="number"
                      step="100"
                      min="1000"
                      max="5000"
                      class="probe-input"
                      :disabled="isProbing"
                      @blur="handleRapidMovementBlur"
                    />
                    <span class="probe-unit">mm/min</span>
                  </div>
                </div>

                <!-- Probe Z First toggle - only for Center - Outer -->
                <div v-if="probingAxis === 'Center - Outer'" class="probe-control-group probe-control-group--align-right">
                  <label class="probe-label">Probe Z First</label>
                  <label class="switch">
                    <input type="checkbox" v-model="probeZFirst" :disabled="isProbing">
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
            </template>

            <!-- Contextual instruction - shown at bottom of controls -->
            <div v-if="['XYZ', 'XY'].includes(probingAxis)" class="probe-contextual-instruction probe-contextual-instruction--warning">
              Click on a corner to select where to start probing
            </div>
            <div v-else-if="probingAxis === 'X'" class="probe-contextual-instruction probe-contextual-instruction--warning">
              Click on the left or right side to select where to probe
            </div>
            <div v-else-if="probingAxis === 'Y'" class="probe-contextual-instruction probe-contextual-instruction--warning">
              Click on the front or back side to select where to probe
            </div>
            <div v-else-if="['Center - Inner', 'Center - Outer'].includes(probingAxis)" class="probe-contextual-instruction probe-contextual-instruction--warning">
              <strong>Important:</strong> Measure dimension as close as possible to prevent probe damage.
            </div>
          </div>
          <div class="probe-dialog__column probe-dialog__column--viewer">
            <ProbeVisualizer
              :probe-type="probeType"
              :probing-axis="probingAxis"
              :selected-corner="selectedCorner"
              :selected-side="selectedSide"
              :probe-active="probeActive"
              @corner-selected="selectedCorner = $event"
              @side-selected="selectedSide = $event"
            />

            <!-- Jog Controls -->
            <JogControls
              :current-step="jogStep"
              :step-options="[0.1, 1, 10]"
              :disabled="isProbing"
              @update:step="jogStep = $event"
              @center-click="handleClose"
            />
          </div>
        </div>
      </div>
      <div class="probe-dialog__footer">
        <button @click="handleClose" class="probe-dialog__btn probe-dialog__btn--secondary" :disabled="isProbing">Close</button>
        <button @click="handleStartProbe" class="probe-dialog__btn probe-dialog__btn--primary" :disabled="isProbing">Start Probe</button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import Dialog from '../../components/Dialog.vue';
import ProbeVisualizer from './ProbeVisualizer.vue';
import JogControls from '../jog/JogControls.vue';
import { api } from '../../lib/api.js';
import { updateSettings } from '../../lib/settings-store.js';
import { startProbe as startProbeOperation } from './api';

// Props
interface Props {
  show: boolean;
  isProbing: boolean;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  (e: 'close'): void;
}>();

// Probe state
const probeType = ref<'3d-probe' | 'standard-block'>('3d-probe');
const ballPointDiameter = ref(2);
const zPlunge = ref(3);
const zOffset = ref(-0.1);
const probingAxis = ref('Z');
const selectedCorner = ref<string | null>(null);
const selectedSide = ref<string | null>(null);
const xDimension = ref(100);
const yDimension = ref(100);
const rapidMovement = ref(2000);
const probeZFirst = ref(false);
const probeActive = ref(false);
const jogStep = ref(1);

// Validation errors
const errors = ref({
  ballPointDiameter: '',
  zPlunge: '',
  zOffset: ''
});

// Track original values for change detection
const originalValues = ref({
  ballPointDiameter: 2,
  zPlunge: 3,
  zOffset: -0.1,
  xDimension: 100,
  yDimension: 100,
  rapidMovement: 2000
});

// Flag to prevent saving during initial load
let isInitialLoad = true;

// Validation functions
const validateBallPointDiameter = () => {
  if (ballPointDiameter.value <= 0) {
    errors.value.ballPointDiameter = 'Must be a positive number';
  } else {
    errors.value.ballPointDiameter = '';
  }
};

const validateZPlunge = () => {
  if (zPlunge.value <= 0) {
    errors.value.zPlunge = 'Must be a positive number';
  } else {
    errors.value.zPlunge = '';
  }
};

const validateZOffset = () => {
  if (isNaN(zOffset.value)) {
    errors.value.zOffset = 'Must be a valid number';
  } else {
    errors.value.zOffset = '';
  }
};

// Blur handlers for probe input fields
const handleBallPointDiameterBlur = async () => {
  validateBallPointDiameter();
  if (!errors.value.ballPointDiameter && ballPointDiameter.value !== originalValues.value.ballPointDiameter) {
    try {
      await updateSettings({ probe: { '3d-probe': { ballPointDiameter: ballPointDiameter.value } } });
      originalValues.value.ballPointDiameter = ballPointDiameter.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save ball point diameter setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleZPlungeBlur = async () => {
  validateZPlunge();
  if (!errors.value.zPlunge && zPlunge.value !== originalValues.value.zPlunge) {
    try {
      await updateSettings({ probe: { '3d-probe': { zPlunge: zPlunge.value } } });
      originalValues.value.zPlunge = zPlunge.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save Z plunge setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleZOffsetBlur = async () => {
  validateZOffset();
  if (!errors.value.zOffset && zOffset.value !== originalValues.value.zOffset) {
    try {
      await updateSettings({ probe: { '3d-probe': { zOffset: zOffset.value } } });
      originalValues.value.zOffset = zOffset.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save Z offset setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleXDimensionBlur = async () => {
  if (xDimension.value !== originalValues.value.xDimension && xDimension.value > 0) {
    try {
      await updateSettings({ probe: { '3d-probe': { xDimension: xDimension.value } } });
      originalValues.value.xDimension = xDimension.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save X dimension setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleYDimensionBlur = async () => {
  if (yDimension.value !== originalValues.value.yDimension && yDimension.value > 0) {
    try {
      await updateSettings({ probe: { '3d-probe': { yDimension: yDimension.value } } });
      originalValues.value.yDimension = yDimension.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save Y dimension setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleRapidMovementBlur = async () => {
  if (rapidMovement.value !== originalValues.value.rapidMovement && rapidMovement.value >= 1000 && rapidMovement.value <= 5000) {
    try {
      await updateSettings({ probe: { '3d-probe': { rapidMovement: rapidMovement.value } } });
      originalValues.value.rapidMovement = rapidMovement.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save rapid movement setting', JSON.stringify({ error: error.message }));
    }
  }
};

// Watchers for probe settings
watch(() => probeType.value, async (value) => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probe: { type: value } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save probe type setting', JSON.stringify({ error: error.message }));
    }
  }
});

watch(() => probingAxis.value, async (value) => {
  // Reset side selection when switching probing axis
  selectedSide.value = null;

  if (!isInitialLoad) {
    try {
      await updateSettings({ probe: { probingAxis: value } }, { broadcast: false });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save probing axis setting', JSON.stringify({ error: error.message }));
    }
  }
});

watch(() => selectedCorner.value, async (value) => {
  if (!isInitialLoad) {
    // Only save corner selection for XYZ/XY modes (not for X/Y modes which use sides)
    if (value && !['Left', 'Right'].includes(value)) {
      try {
        await updateSettings({ probe: { selectedCorner: value } });
      } catch (error) {
        console.error('[ProbeDialog] Failed to save selected corner setting', JSON.stringify({ error: error.message }));
      }
    }
  }
});

watch(() => probeZFirst.value, async (value) => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probe: { '3d-probe': { probeZFirst: value } } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save probeZFirst setting', JSON.stringify({ error: error.message }));
    }
  }
});

// Load settings when dialog opens
watch(() => props.show, async (isShown) => {
  if (isShown) {
    isInitialLoad = true;

    try {
      const settings = await api.getSettings();
      if (settings) {
        if (settings.probe?.probingAxis) {
          probingAxis.value = settings.probe.probingAxis;
        }
        if (typeof settings.probe?.['3d-probe']?.ballPointDiameter === 'number') {
          ballPointDiameter.value = settings.probe['3d-probe'].ballPointDiameter;
          originalValues.value.ballPointDiameter = settings.probe['3d-probe'].ballPointDiameter;
        }
        if (typeof settings.probe?.['3d-probe']?.zPlunge === 'number') {
          zPlunge.value = settings.probe['3d-probe'].zPlunge;
          originalValues.value.zPlunge = settings.probe['3d-probe'].zPlunge;
        }
        if (typeof settings.probe?.['3d-probe']?.zOffset === 'number') {
          zOffset.value = settings.probe['3d-probe'].zOffset;
          originalValues.value.zOffset = settings.probe['3d-probe'].zOffset;
        }
        if (typeof settings.probe?.['3d-probe']?.xDimension === 'number') {
          xDimension.value = settings.probe['3d-probe'].xDimension;
          originalValues.value.xDimension = settings.probe['3d-probe'].xDimension;
        }
        if (typeof settings.probe?.['3d-probe']?.yDimension === 'number') {
          yDimension.value = settings.probe['3d-probe'].yDimension;
          originalValues.value.yDimension = settings.probe['3d-probe'].yDimension;
        }
        if (typeof settings.probe?.['3d-probe']?.rapidMovement === 'number') {
          rapidMovement.value = settings.probe['3d-probe'].rapidMovement;
          originalValues.value.rapidMovement = settings.probe['3d-probe'].rapidMovement;
        }
        if (typeof settings.probe?.['3d-probe']?.probeZFirst === 'boolean') {
          probeZFirst.value = settings.probe['3d-probe'].probeZFirst;
        }
      }
    } catch (error) {
      console.error('[ProbeDialog] Failed to reload settings', JSON.stringify({ error: error.message }));
    }

    // Allow watchers to save after initial load
    setTimeout(() => {
      isInitialLoad = false;
    }, 100);
  }
});

// Dialog functions
const handleClose = () => {
  emit('close');
};

const handleStartProbe = async () => {
  try {
    const options = {
      probingAxis: probingAxis.value,
      selectedCorner: selectedCorner.value,
      selectedSide: selectedSide.value,
      xDimension: xDimension.value,
      yDimension: yDimension.value,
      rapidMovement: rapidMovement.value,
      probeZFirst: probeZFirst.value,
      toolDiameter: ballPointDiameter.value || 6,
      zOffset: zOffset.value
    };

    console.log('[Probe] Starting probe operation:', options);
    const result = await startProbeOperation(options);
    console.log('[Probe] Probe operation started:', result);
  } catch (error) {
    console.error('[Probe] Error starting probe:', error);
  }
};
</script>

<style scoped>
.probe-dialog {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 80vh;
}

.probe-dialog__header {
  padding: 0 0 1rem 0;
  border-bottom: 1px solid var(--border-color, #3a3a3a);
}

.probe-dialog__instructions {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-secondary, #999);
}

.probe-dialog__content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 0;
}

.probe-dialog__columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  height: 100%;
}

.probe-dialog__column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.probe-dialog__column h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.probe-dialog__column--controls {
  flex-shrink: 0;
}

.probe-dialog__column--viewer {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.probe-control-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.probe-control-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.probe-control-group--align-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.probe-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary, #999);
  margin-bottom: 0.25rem;
}

.probe-select,
.probe-input {
  padding: 0.5rem;
  background: var(--input-bg, #2a2a2a);
  border: 1px solid var(--border-color, #3a3a3a);
  border-radius: 4px;
  color: var(--text-primary, #fff);
  font-size: 0.9rem;
}

.probe-select:focus,
.probe-input:focus {
  outline: none;
  border-color: var(--accent-color, #1abc9c);
}

.probe-input-with-unit {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.probe-input {
  flex: 1;
  width: 100%;
}

.probe-unit {
  font-size: 0.85rem;
  color: var(--text-secondary, #999);
  white-space: nowrap;
}

.probe-error {
  font-size: 0.75rem;
  color: var(--error-color, #e74c3c);
}

.probe-contextual-instruction {
  padding: 0.75rem;
  border-radius: 4px;
  font-size: 0.85rem;
  line-height: 1.4;
  margin-top: 0.5rem;
}

.probe-contextual-instruction--warning {
  background: rgba(241, 196, 15, 0.1);
  border: 1px solid rgba(241, 196, 15, 0.3);
  color: #f1c40f;
}

.probe-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding: 1rem 0 0 0;
  border-top: 1px solid var(--border-color, #3a3a3a);
}

.probe-dialog__btn {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.probe-dialog__btn--secondary {
  background: var(--button-secondary-bg, #3a3a3a);
  color: var(--text-primary, #fff);
}

.probe-dialog__btn--secondary:hover {
  background: var(--button-secondary-hover, #4a4a4a);
}

.probe-dialog__btn--secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.probe-dialog__btn--primary {
  background: var(--accent-color, #1abc9c);
  color: #fff;
}

.probe-dialog__btn--primary:hover {
  background: var(--accent-hover, #16a085);
}

.probe-dialog__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.probe-dialog__btn--primary:disabled:hover {
  background: var(--accent-color, #1abc9c);
}

/* Toggle switch styles */
.switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #3a3a3a;
  transition: 0.3s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--accent-color, #1abc9c);
}

input:checked + .slider:before {
  transform: translateX(26px);
}

input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

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
                  <option v-if="probeType === '3d-probe'" value="Center - Inner">Center - Inner</option>
                  <option v-if="probeType === '3d-probe'" value="Center - Outer">Center - Outer</option>
                </select>
              </div>
            </div>

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

              <div class="probe-control-row">
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

                <div v-if="probingAxis === 'Center - Outer'" class="probe-control-group">
                  <label class="probe-label">Probe Z First</label>
                  <label class="switch">
                    <input type="checkbox" v-model="probeZFirst" :disabled="isProbing" @change="handleProbeZFirstToggle">
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
            </template>

            <template v-if="probeType === 'standard-block'">
              <div class="probe-control-row">
                <div class="probe-control-group">
                  <label class="probe-label">Z Thickness</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="zThickness"
                      type="number"
                      step="0.1"
                      min="1"
                      max="30"
                      class="probe-input"
                      :disabled="isProbing"
                      @input="validateZThickness"
                      @blur="handleZThicknessBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.zThickness" class="probe-error">{{ errors.zThickness }}</span>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">XY Thickness</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="xyThickness"
                      type="number"
                      step="0.1"
                      min="1"
                      max="100"
                      class="probe-input"
                      :disabled="isProbing"
                      @input="validateXYThickness"
                      @blur="handleXYThicknessBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.xyThickness" class="probe-error">{{ errors.xyThickness }}</span>
                </div>
              </div>

              <div class="probe-control-group">
                <label class="probe-label">Z Probe Distance</label>
                <div class="probe-input-with-unit">
                  <input
                    v-model.number="zProbeDistance"
                    type="number"
                    step="0.1"
                    min="1"
                    max="30"
                    class="probe-input"
                    :disabled="isProbing"
                    @input="validateZProbeDistance"
                    @blur="handleZProbeDistanceBlur"
                  />
                  <span class="probe-unit">mm</span>
                </div>
                <span v-if="errors.zProbeDistance" class="probe-error">{{ errors.zProbeDistance }}</span>
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
            <!-- Connection Test Toggle -->
            <div class="probe-connection-test">
              <label class="probe-label">Connection Test</label>
              <label class="switch">
                <input type="checkbox" v-model="requireConnectionTest" @change="handleConnectionTestToggle">
                <span class="slider"></span>
              </label>
            </div>

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
        <button @click="handleStartProbe" class="probe-dialog__btn probe-dialog__btn--primary" :disabled="isProbing || (requireConnectionTest && !connectionTestPassed)">Start Probe</button>
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
const requireConnectionTest = ref(false);
const connectionTestPassed = ref(false);
const zThickness = ref(25);
const xyThickness = ref(50);
const zProbeDistance = ref(3);

// Validation errors
const errors = ref({
  ballPointDiameter: '',
  zPlunge: '',
  zOffset: '',
  zThickness: '',
  xyThickness: '',
  zProbeDistance: ''
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

const validateZThickness = () => {
  if (zThickness.value < 1 || zThickness.value > 30) {
    errors.value.zThickness = 'Must be between 1 and 30mm';
  } else {
    errors.value.zThickness = '';
  }
};

const validateXYThickness = () => {
  if (xyThickness.value < 1 || xyThickness.value > 100) {
    errors.value.xyThickness = 'Must be between 1 and 100mm';
  } else {
    errors.value.xyThickness = '';
  }
};

const validateZProbeDistance = () => {
  if (zProbeDistance.value < 1 || zProbeDistance.value > 30) {
    errors.value.zProbeDistance = 'Must be between 1 and 30mm';
  } else {
    errors.value.zProbeDistance = '';
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

const handleProbeZFirstToggle = async () => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probe: { '3d-probe': { probeZFirst: probeZFirst.value } } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save probe Z first setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleZThicknessBlur = async () => {
  validateZThickness();
  if (!errors.value.zThickness) {
    try {
      await updateSettings({ probe: { 'standard-block': { zThickness: zThickness.value } } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save Z thickness setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleXYThicknessBlur = async () => {
  validateXYThickness();
  if (!errors.value.xyThickness) {
    try {
      await updateSettings({ probe: { 'standard-block': { xyThickness: xyThickness.value } } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save XY thickness setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleZProbeDistanceBlur = async () => {
  validateZProbeDistance();
  if (!errors.value.zProbeDistance) {
    try {
      await updateSettings({ probe: { 'standard-block': { zProbeDistance: zProbeDistance.value } } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save Z probe distance setting', JSON.stringify({ error: error.message }));
    }
  }
};

// Watchers for probe settings
watch(() => probeType.value, async (value) => {
  // Check if current probing axis is available for the new probe type
  if (value === 'standard-block' && ['Center - Inner', 'Center - Outer'].includes(probingAxis.value)) {
    probingAxis.value = 'XYZ';
  }

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
        if (typeof settings.probe?.requireConnectionTest === 'boolean') {
          requireConnectionTest.value = settings.probe.requireConnectionTest;
        }
        if (typeof settings.probe?.['standard-block']?.zThickness === 'number') {
          zThickness.value = settings.probe['standard-block'].zThickness;
        }
        if (typeof settings.probe?.['standard-block']?.xyThickness === 'number') {
          xyThickness.value = settings.probe['standard-block'].xyThickness;
        }
        if (typeof settings.probe?.['standard-block']?.zProbeDistance === 'number') {
          zProbeDistance.value = settings.probe['standard-block'].zProbeDistance;
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

// Watch for probe active state to detect connection test
watch(() => probeActive.value, (isActive) => {
  if (requireConnectionTest.value && isActive && !connectionTestPassed.value) {
    connectionTestPassed.value = true;
  }
});

// Reset connection test when dialog closes
watch(() => props.show, (isShown) => {
  if (!isShown) {
    connectionTestPassed.value = false;
  }
});

// Handler for connection test toggle
const handleConnectionTestToggle = async () => {
  connectionTestPassed.value = false;

  if (!isInitialLoad) {
    try {
      await updateSettings({ probe: { requireConnectionTest: requireConnectionTest.value } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save connection test setting', error);
    }
  }
};

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
  max-width: 750px !important;
  height: 100%;
}

.probe-dialog__header {
  padding: 30px 20px 30px 20px;
}

.probe-dialog__instructions {
  margin: 0;
  font-size: 0.95rem;
  font-style: italic;
  line-height: 1.5;
  color: var(--color-text-secondary);
  text-align: left;
}

.probe-dialog__content {
  padding: 10px 30px 10px 30px;
  color: var(--color-text-primary);
  height: 100%;
}

.probe-dialog__columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  min-height: 400px;
}

.probe-dialog__column {
  display: flex;
  flex-direction: column;
}

.probe-dialog__column h3 {
  margin: 0 0 16px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.probe-dialog__column--controls {
  padding-right: 20px;
  border-right: 1px solid var(--color-border);
}

.probe-dialog__column--viewer {
  padding-left: 20px;
  gap: 10px;
}

.probe-control-group--toggle {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  width: 100%;
}

.probe-control-group--toggle-left {
  justify-content: flex-start;
}

.probe-control-group--toggle .probe-label {
  margin-bottom: 0;
}

.probe-connection-test {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  margin-bottom: 12px;
}

.probe-connection-test .probe-label {
  margin-bottom: 0;
}

.probe-contextual-instruction {
  margin-top: 16px;
  padding: 10px 14px;
  font-size: 0.85rem;
  font-style: italic;
  text-align: center;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
}

.probe-contextual-instruction--warning {
  color: #ff9800;
  background: rgba(255, 152, 0, 0.1);
  border-color: rgba(255, 152, 0, 0.3);
}

.probe-control-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 6px;
}

.probe-control-group {
  margin-bottom: 12px;
}

.probe-control-group .switch {
  margin-top: 4px;
}

.probe-control-group--align-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.probe-control-group--align-right .switch {
  margin-top: auto;
}

.probe-label {
  display: block;
  margin-bottom: 4px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.probe-input,
.probe-select {
  width: 100%;
  padding: 6px 10px;
  font-size: 0.9rem;
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  transition: border-color 0.2s ease;
  text-align: right;
}

.probe-input:focus,
.probe-select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.probe-input[type="number"] {
  -moz-appearance: textfield;
  text-align: right;
}

.probe-input::-webkit-outer-spin-button,
.probe-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.probe-input-with-unit {
  display: flex;
  align-items: center;
  gap: 6px;
}

.probe-unit {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.probe-error {
  display: block;
  margin-top: 4px;
  font-size: 0.85rem;
  color: #ff6b6b;
}

.probe-dialog__footer {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 10px 10px 20px 10px;
}

.probe-dialog__btn {
  padding: 10px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid var(--color-border);
}

.probe-dialog__btn--secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.probe-dialog__btn--secondary:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.probe-dialog__btn--secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.probe-dialog__btn--primary {
  background: var(--gradient-accent);
  color: white;
  border-color: var(--color-accent);
}

.probe-dialog__btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.probe-dialog__btn--primary:disabled {
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  border-color: var(--color-border);
  cursor: not-allowed;
  opacity: 0.5;
}

.probe-dialog__btn--primary:disabled:hover {
  transform: none;
  box-shadow: none;
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
  background-color: var(--color-surface-muted);
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
  background-color: var(--color-accent);
}

input:checked + .slider:before {
  transform: translateX(26px);
}

input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

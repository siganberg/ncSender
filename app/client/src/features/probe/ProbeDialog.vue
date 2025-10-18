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
                  <option value="autozero-touch">AutoZero Touch</option>
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
                  :class="{ 'probe-input--error': errors.rapidMovement }"
                  :disabled="isProbing"
                  @input="validateRapidMovement"
                  @blur="handleRapidMovementBlur"
                />
                <span class="probe-unit">mm/min</span>
              </div>
              <span v-if="errors.rapidMovement" class="probe-error">{{ errors.rapidMovement }}</span>
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
                      :class="{ 'probe-input--error': errors.ballPointDiameter }"
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
                      min="1"
                      max="5"
                      class="probe-input"
                      :class="{ 'probe-input--error': errors.zPlunge }"
                      :disabled="isProbing"
                      @input="validateZPlunge"
                      @blur="handleZPlungeBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.zPlunge" class="probe-error">{{ errors.zPlunge }}</span>
                </div>
              </div>

              <div v-if="['Center - Inner', 'Center - Outer'].includes(probingAxis)" class="probe-control-row">
                <div class="probe-control-group">
                  <label class="probe-label">X Dimension</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="xDimension"
                      type="number"
                      step="0.1"
                      min="10"
                      max="1000"
                      class="probe-input"
                      :class="{ 'probe-input--error': errors.xDimension }"
                      :disabled="isProbing"
                      @input="validateXDimension"
                      @blur="handleXDimensionBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.xDimension" class="probe-error">{{ errors.xDimension }}</span>
                </div>

                <div class="probe-control-group">
                  <label class="probe-label">Y Dimension</label>
                  <div class="probe-input-with-unit">
                    <input
                      v-model.number="yDimension"
                      type="number"
                      step="0.1"
                      min="10"
                      max="1000"
                      class="probe-input"
                      :class="{ 'probe-input--error': errors.yDimension }"
                      :disabled="isProbing"
                      @input="validateYDimension"
                      @blur="handleYDimensionBlur"
                    />
                    <span class="probe-unit">mm</span>
                  </div>
                  <span v-if="errors.yDimension" class="probe-error">{{ errors.yDimension }}</span>
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
                      min="-0.5"
                      max="0.5"
                      class="probe-input"
                      :class="{ 'probe-input--error': errors.zOffset }"
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
                      :class="{ 'probe-input--error': errors.zThickness }"
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
                      :class="{ 'probe-input--error': errors.xyThickness }"
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
                    :class="{ 'probe-input--error': errors.zProbeDistance }"
                    :disabled="isProbing"
                    @input="validateZProbeDistance"
                    @blur="handleZProbeDistanceBlur"
                  />
                  <span class="probe-unit">mm</span>
                </div>
                <span v-if="errors.zProbeDistance" class="probe-error">{{ errors.zProbeDistance }}</span>
              </div>
            </template>

            <template v-if="probeType === 'autozero-touch'">
              <div class="probe-control-group">
                <label class="probe-label">Bit Diameter</label>
                <div class="custom-dropdown" :class="{ 'custom-dropdown--open': dropdownOpen }">
                  <div
                    class="custom-dropdown__trigger"
                    @click="toggleDropdown"
                    :class="{ 'custom-dropdown__trigger--disabled': isProbing }"
                  >
                    <span class="custom-dropdown__value">{{ getDisplayValue() }}</span>
                    <span class="custom-dropdown__arrow">▼</span>
                  </div>

                  <div v-if="dropdownOpen" class="custom-dropdown__menu">
                    <!-- Auto and Tip options (cannot be removed) -->
                    <div
                      class="custom-dropdown__item"
                      :class="{ 'custom-dropdown__item--selected': selectedBitDiameter === 'Auto' }"
                      @click="selectDiameter('Auto')"
                    >
                      <span class="custom-dropdown__item-spacer"></span>
                      <span class="custom-dropdown__item-text">Auto</span>
                    </div>

                    <div
                      class="custom-dropdown__item"
                      :class="{ 'custom-dropdown__item--selected': selectedBitDiameter === 'Tip' }"
                      @click="selectDiameter('Tip')"
                    >
                      <span class="custom-dropdown__item-spacer"></span>
                      <span class="custom-dropdown__item-text">Tip</span>
                    </div>

                    <!-- Divider -->
                    <div v-if="customBitDiameters.length > 0" class="custom-dropdown__divider"></div>

                    <!-- Custom diameters (can be removed) -->
                    <div
                      v-for="diameter in customBitDiameters"
                      :key="diameter"
                      class="custom-dropdown__item"
                      :class="{ 'custom-dropdown__item--selected': selectedBitDiameter === diameter.toString() }"
                      @click="selectDiameter(diameter.toString())"
                    >
                      <button
                        class="custom-dropdown__remove"
                        @click.stop="removeCustomDiameter(diameter)"
                        title="Remove"
                      >
                        ×
                      </button>
                      <span class="custom-dropdown__item-text">{{ diameter }}mm</span>
                    </div>

                    <!-- Divider before custom input -->
                    <div class="custom-dropdown__divider"></div>

                    <!-- Custom diameter input -->
                    <div class="custom-dropdown__item custom-dropdown__item--input" @click.stop>
                      <input
                        v-model.number="newCustomDiameter"
                        type="number"
                        step="0.001"
                        min="0.1"
                        max="50"
                        class="custom-dropdown__input"
                        placeholder="Custom diameter (mm)"
                        @click.stop
                        @keyup.enter="addCustomDiameter"
                      />
                      <button
                        @click.stop="addCustomDiameter"
                        class="custom-dropdown__add-btn"
                        :disabled="!newCustomDiameter || newCustomDiameter <= 0"
                      >
                        +Add
                      </button>
                    </div>
                  </div>
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
            <!-- Connection Test Toggle -->
            <div class="probe-connection-test">
              <label class="probe-label">Connection Test</label>
              <label class="switch">
                <input type="checkbox" v-model="requireConnectionTest" @change="handleConnectionTestToggle">
                <span class="slider"></span>
              </label>
            </div>

            <ProbeVisualizer
              v-if="settingsLoaded"
              :probe-type="probeType"
              :probing-axis="probingAxis"
              :selected-corner="selectedCorner"
              :selected-side="selectedSide"
              :probe-active="props.probeActive"
              @corner-selected="selectedCorner = $event"
              @side-selected="selectedSide = $event"
            />

            <!-- Step Control -->
            <StepControl
              :current-step="jogStep"
              :step-options="stepOptions"
              :current-feed-rate="jogFeedRate"
              @update:step="jogStep = $event"
              @update:feedRate="jogFeedRate = $event"
            />

            <!-- Jog Controls -->
            <JogControls
              :current-step="jogStep"
              :feed-rate="jogFeedRate"
              :disabled="isProbing"
              @center-click="handleCenterClick"
            />
          </div>
        </div>
      </div>
      <div class="probe-dialog__footer">
        <button @click="handleClose" class="probe-dialog__btn probe-dialog__btn--secondary" :disabled="isProbing">Close</button>
        <button @click="handleStartProbe" class="probe-dialog__btn probe-dialog__btn--primary" :disabled="isPrimaryActionDisabled">{{ primaryButtonLabel }}</button>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import Dialog from '../../components/Dialog.vue';
import ProbeVisualizer from './ProbeVisualizer.vue';
import StepControl from '../jog/StepControl.vue';
import JogControls from '../jog/JogControls.vue';
import { api } from '../../lib/api.js';
import { updateSettings } from '../../lib/settings-store.js';
import { startProbe as startProbeOperation, stopProbe } from './api';
import { useAppStore } from '../../composables/use-app-store';

// Props
interface Props {
  show: boolean;
  isProbing: boolean;
  probeActive: boolean;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  (e: 'close'): void;
}>();

// Probe state
const probeType = ref<'3d-probe' | 'standard-block' | 'autozero-touch'>('autozero-touch');
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
const jogStep = ref(1); // Will be adjusted by watcher if needed
const jogFeedRate = ref(3000);
const requireConnectionTest = ref(false);
const connectionTestPassed = ref(false);
const zThickness = ref(25);
const xyThickness = ref(50);
const zProbeDistance = ref(3);

// AutoZero Touch probe state
const selectedBitDiameter = ref<string>('Auto');
const customBitDiameters = ref<number[]>([2, 3.175, 6.35, 9.525, 12]);
const newCustomDiameter = ref<number | null>(null);
const dropdownOpen = ref(false);

// Validation errors
const errors = ref({
  ballPointDiameter: '',
  zPlunge: '',
  zOffset: '',
  zThickness: '',
  xyThickness: '',
  zProbeDistance: '',
  rapidMovement: '',
  xDimension: '',
  yDimension: ''
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

// Flag to track when settings are loaded (prevents race condition on initial render)
const settingsLoaded = ref(false);

// App store state
const appStore = useAppStore();
const normalizedSenderStatus = computed(() => (appStore.senderStatus.value || '').toLowerCase());
const isAlarmState = computed(() => normalizedSenderStatus.value === 'alarm');

// Step options - always in mm (StepControl handles display conversion)
const stepOptions = computed(() => {
  return [0.1, 1, 10]; // mm - StepControl will convert to imperial for display
});

// Computed property to check if there are any validation errors
const hasValidationErrors = computed(() => {
  return Object.values(errors.value).some(error => error !== '');
});

const primaryButtonLabel = computed(() => (isAlarmState.value ? 'Unlock' : 'Start Probe'));
const isPrimaryActionDisabled = computed(() => {
  if (isAlarmState.value) {
    return false;
  }

  return props.isProbing || hasValidationErrors.value || (requireConnectionTest.value && !connectionTestPassed.value) || (['X', 'Y'].includes(probingAxis.value) && !selectedSide.value);
});

// Validation functions
const validateBallPointDiameter = () => {
  if (ballPointDiameter.value <= 0) {
    errors.value.ballPointDiameter = 'Must be a positive number';
  } else {
    errors.value.ballPointDiameter = '';
  }
};

const validateZPlunge = () => {
  if (zPlunge.value < 1 || zPlunge.value > 5) {
    errors.value.zPlunge = 'Must be between 1 and 5mm';
  } else {
    errors.value.zPlunge = '';
  }
};

const validateZOffset = () => {
  if (isNaN(zOffset.value)) {
    errors.value.zOffset = 'Must be a valid number';
  } else if (zOffset.value < -0.5 || zOffset.value > 0.5) {
    errors.value.zOffset = 'Must be between -0.5 and 0.5mm';
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

const validateRapidMovement = () => {
  if (rapidMovement.value < 1000 || rapidMovement.value > 5000) {
    errors.value.rapidMovement = 'Must be between 1000 and 5000 mm/min';
  } else {
    errors.value.rapidMovement = '';
  }
};

const validateXDimension = () => {
  if (xDimension.value < 10 || xDimension.value > 1000) {
    errors.value.xDimension = 'Must be between 10 and 1000mm';
  } else {
    errors.value.xDimension = '';
  }
};

const validateYDimension = () => {
  if (yDimension.value < 10 || yDimension.value > 1000) {
    errors.value.yDimension = 'Must be between 10 and 1000mm';
  } else {
    errors.value.yDimension = '';
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
  validateXDimension();
  if (!errors.value.xDimension && xDimension.value !== originalValues.value.xDimension) {
    try {
      await updateSettings({ probe: { '3d-probe': { xDimension: xDimension.value } } });
      originalValues.value.xDimension = xDimension.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save X dimension setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleYDimensionBlur = async () => {
  validateYDimension();
  if (!errors.value.yDimension && yDimension.value !== originalValues.value.yDimension) {
    try {
      await updateSettings({ probe: { '3d-probe': { yDimension: yDimension.value } } });
      originalValues.value.yDimension = yDimension.value;
    } catch (error) {
      console.error('[ProbeDialog] Failed to save Y dimension setting', JSON.stringify({ error: error.message }));
    }
  }
};

const handleRapidMovementBlur = async () => {
  validateRapidMovement();
  if (!errors.value.rapidMovement && rapidMovement.value !== originalValues.value.rapidMovement) {
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

const isSideValidForAxis = (axis: string, side: string | null) => {
  if (!side) return false;
  if (axis === 'X') {
    return side === 'Left' || side === 'Right';
  }
  if (axis === 'Y') {
    return side === 'Front' || side === 'Back';
  }
  return false;
};

const applyAutoZeroSideDefault = (axis: string) => {
  const supportsSides = axis === 'X' || axis === 'Y';
  if (!supportsSides) {
    selectedSide.value = null;
    return;
  }

  const shouldDefaultLeftFront = ['autozero-touch', '3d-probe'].includes(probeType.value);
  if (!shouldDefaultLeftFront) {
    selectedSide.value = null;
    return;
  }

  const defaultSide = axis === 'X' ? 'Left' : 'Front';

  if (!selectedSide.value) {
    selectedSide.value = defaultSide;
    return;
  }

  if (!isSideValidForAxis(axis, selectedSide.value)) {
    selectedSide.value = defaultSide;
  }
};

const applyCornerDefault = (axis: string) => {
  if (['XYZ', 'XY'].includes(axis) && !selectedCorner.value) {
    selectedCorner.value = 'BottomLeft';
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
      await updateSettings({ probe: { type: value, typeInitialized: true } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save probe type setting', JSON.stringify({ error: error.message }));
    }
  }

  applyAutoZeroSideDefault(probingAxis.value);
  applyCornerDefault(probingAxis.value);
});

watch(() => probingAxis.value, async (value) => {
  // Reset side selection when switching probing axis
  applyAutoZeroSideDefault(value);
  applyCornerDefault(value);

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

watch(() => selectedBitDiameter.value, async (value) => {
  if (!isInitialLoad) {
    try {
      await updateSettings({ probe: { selectedBitDiameter: value } });
    } catch (error) {
      console.error('[ProbeDialog] Failed to save selected bit diameter setting', JSON.stringify({ error: error.message }));
    }
  }
});

// Load settings when dialog opens
watch(() => props.show, async (isShown) => {
  if (isShown) {
    isInitialLoad = true;
    settingsLoaded.value = false;

    try {
      const settings = await api.getSettings();
      if (settings) {
        if (settings.probe?.type) {
          probeType.value = settings.probe.type;
        }
        if (settings.probe?.probingAxis) {
          probingAxis.value = settings.probe.probingAxis;
        }
        if (settings.probe?.selectedCorner) {
          selectedCorner.value = settings.probe.selectedCorner;
        }
        const shouldDefaultProbeType = settings.probe?.typeInitialized !== true && settings.probe?.type === '3d-probe';
        if (shouldDefaultProbeType) {
          probeType.value = 'autozero-touch';
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
        if (settings.probe?.selectedBitDiameter) {
          selectedBitDiameter.value = settings.probe.selectedBitDiameter;
        }
        if (Array.isArray(settings.probe?.bitDiameters)) {
          customBitDiameters.value = settings.probe.bitDiameters;
        }
      }
    } catch (error) {
      console.error('[ProbeDialog] Failed to reload settings', JSON.stringify({ error: error.message }));
    }

    // Settings are now loaded, allow visualizer to render
    settingsLoaded.value = true;

    applyCornerDefault(probingAxis.value);

    // Allow watchers to save after initial load
    setTimeout(() => {
      isInitialLoad = false;
    }, 100);
  } else {
    // Reset when dialog closes
    settingsLoaded.value = false;
  }
});

// Watch for probe active state to detect connection test
watch(() => props.probeActive, (isActive) => {
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

// Initialize jogStep to match current units on mount
onMounted(() => {
  const currentStepOptions = stepOptions.value;
  if (!currentStepOptions.includes(jogStep.value)) {
    // Default to middle option
    jogStep.value = currentStepOptions[Math.floor(currentStepOptions.length / 2)];
  }
});

// Watch for step changes and update feed rate to default
watch(() => jogStep.value, (newStep) => {
  // Map step to index to get default feed rate
  const stepIndex = stepOptions.value.indexOf(newStep);
  const feedRateDefaults = [500, 3000, 8000]; // Small, Medium, Large

  if (stepIndex >= 0 && stepIndex < feedRateDefaults.length) {
    jogFeedRate.value = feedRateDefaults[stepIndex];
  }
});

// Watch for units preference changes and adjust jog step
watch(() => appStore.unitsPreference.value, (newUnits) => {
  // Adjust jogStep to match the closest value in the new stepOptions
  const currentStepOptions = stepOptions.value;
  if (!currentStepOptions.includes(jogStep.value)) {
    // Default to middle option
    jogStep.value = currentStepOptions[Math.floor(currentStepOptions.length / 2)];
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

const handleCenterClick = async () => {
  if (props.isProbing) {
    try {
      await stopProbe();
    } catch (error) {
      console.error('[ProbeDialog] Failed to stop probe:', error);
    }
  }
};

// AutoZero Touch functions
const toggleDropdown = () => {
  if (!props.isProbing) {
    dropdownOpen.value = !dropdownOpen.value;
  }
};

const selectDiameter = (value: string) => {
  selectedBitDiameter.value = value;
  dropdownOpen.value = false;
};

const getDisplayValue = () => {
  if (selectedBitDiameter.value === 'Auto' || selectedBitDiameter.value === 'Tip') {
    return selectedBitDiameter.value;
  }
  return `${selectedBitDiameter.value}mm`;
};

const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.custom-dropdown')) {
    dropdownOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});

const addCustomDiameter = async () => {
  if (newCustomDiameter.value && newCustomDiameter.value > 0) {
    if (!customBitDiameters.value.includes(newCustomDiameter.value)) {
      customBitDiameters.value.push(newCustomDiameter.value);
      customBitDiameters.value.sort((a, b) => a - b);

      if (!isInitialLoad) {
        try {
          await updateSettings({ probe: { bitDiameters: customBitDiameters.value } });
        } catch (error) {
          console.error('[ProbeDialog] Failed to save bit diameters', JSON.stringify({ error: error.message }));
        }
      }
    }
    newCustomDiameter.value = null;
  }
};

const removeCustomDiameter = async (diameter: number) => {
  const index = customBitDiameters.value.indexOf(diameter);
  if (index > -1) {
    customBitDiameters.value.splice(index, 1);

    if (selectedBitDiameter.value === diameter.toString()) {
      selectedBitDiameter.value = 'Auto';
    }

    if (!isInitialLoad) {
      try {
        await updateSettings({
          probe: {
            bitDiameters: customBitDiameters.value,
            selectedBitDiameter: selectedBitDiameter.value
          }
        });
      } catch (error) {
        console.error('[ProbeDialog] Failed to save bit diameters', JSON.stringify({ error: error.message }));
      }
    }
  }
};

const handleStartProbe = async () => {
  if (isAlarmState.value) {
    try {
      // Soft reset followed by unlock clears the alarm state
      await api.sendCommand('\x18', { meta: { sourceId: 'client' } });
      await new Promise(resolve => setTimeout(resolve, 100));
      await api.sendCommand('$X', { meta: { sourceId: 'client' } });
    } catch (error) {
      console.error('[Probe] Failed to unlock machine from probe dialog:', error);
    }
    return;
  }

  try {
    const options = {
      probeType: probeType.value,
      probingAxis: probingAxis.value,
      selectedCorner: selectedCorner.value,
      selectedSide: selectedSide.value,
      xDimension: xDimension.value,
      yDimension: yDimension.value,
      rapidMovement: rapidMovement.value,
      probeZFirst: probeZFirst.value,
      toolDiameter: ballPointDiameter.value || 6,
      zOffset: zOffset.value,
      selectedBitDiameter: selectedBitDiameter.value
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
  padding: 30px 20px 15px 20px;
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

.probe-coming-soon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
}

.probe-coming-soon h2 {
  font-size: 24px;
  font-weight: 500;
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

.probe-input--error {
  border-color: #ff6b6b !important;
}

.probe-input--error:focus {
  border-color: #ff6b6b !important;
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
  padding: 20px 10px 20px 10px;
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

/* Custom Dropdown Styles */
.custom-dropdown {
  position: relative;
  width: 100%;
}

.custom-dropdown__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  font-size: 0.9rem;
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: border-color 0.2s ease;
  text-align: right;
}

.custom-dropdown__trigger:hover:not(.custom-dropdown__trigger--disabled) {
  border-color: var(--color-accent);
}

.custom-dropdown__trigger--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.custom-dropdown--open .custom-dropdown__trigger {
  border-color: var(--color-accent);
}

.custom-dropdown__value {
  flex: 1;
  text-align: right;
}

.custom-dropdown__arrow {
  margin-left: 8px;
  font-size: 0.7rem;
  transition: transform 0.2s ease;
}

.custom-dropdown--open .custom-dropdown__arrow {
  transform: rotate(180deg);
}

.custom-dropdown__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 300px;
  overflow-y: auto;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-small);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.custom-dropdown__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.custom-dropdown__item:hover:not(.custom-dropdown__item--input) {
  background: var(--color-surface);
}

.custom-dropdown__item--selected {
  background: var(--color-surface);
  color: var(--color-accent);
  font-weight: 600;
}

.custom-dropdown__item--input {
  cursor: default;
  padding: 10px 12px;
  background: var(--color-surface);
}

.custom-dropdown__item-spacer {
  width: 20px;
  flex-shrink: 0;
}

.custom-dropdown__item-text {
  flex: 1;
  text-align: right;
}

.custom-dropdown__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 1.2rem;
  font-weight: bold;
  line-height: 1;
  color: var(--color-accent);
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.custom-dropdown__remove:hover {
  background: var(--color-accent);
  color: white;
}

.custom-dropdown__divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

.custom-dropdown__input {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.9rem;
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  transition: border-color 0.2s ease;
  text-align: left;
}

.custom-dropdown__input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.custom-dropdown__input::placeholder {
  color: var(--color-text-muted);
}

.custom-dropdown__input[type="number"] {
  -moz-appearance: textfield;
}

.custom-dropdown__input::-webkit-outer-spin-button,
.custom-dropdown__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.custom-dropdown__add-btn {
  padding: 6px 12px;
  font-size: 0.9rem;
  font-weight: 600;
  background: var(--color-accent);
  color: white;
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.custom-dropdown__add-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(26, 188, 156, 0.3);
}

.custom-dropdown__add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  border-color: var(--color-border);
}
</style>

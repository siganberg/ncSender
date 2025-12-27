<template>
  <Dialog v-if="show" @close="handleClose" size="small-plus" :close-on-backdrop-click="false">
    <div class="start-from-line-dialog">
      <div class="dialog-header">
        <h2>Start from Line</h2>
      </div>

      <div class="warning-banner">
        <svg class="warning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div class="warning-text">
          <strong>Proceed with caution</strong>
          <p>Starting from a specific line bypasses earlier setup commands. Verify tool, workpiece position, and machine state before proceeding. Review the Resume Sequence below to see what commands will be sent.</p>
        </div>
      </div>

      <div class="dialog-content">
        <div class="input-row">
          <div class="input-group">
            <label class="input-label">Start Line</label>
            <div class="line-input-row">
              <input
                type="number"
                v-model.number="selectedLine"
                :min="1"
                :max="totalLines"
                step="1"
                pattern="[0-9]*"
                class="line-input"
                :disabled="isLoading"
                @change="handleLineChange"
                @keydown="preventDecimal"
              />
              <span class="line-total">of {{ totalLines }}</span>
            </div>
          </div>
          <div class="input-group">
            <label class="input-label">Spindle Delay</label>
            <div class="spindle-delay-row">
              <input
                type="number"
                v-model.number="spindleDelaySec"
                :min="0"
                :max="10"
                step="0.5"
                class="delay-input"
                :disabled="isStarting"
                @change="clampSpindleDelay"
              />
              <span class="input-unit">sec</span>
            </div>
          </div>
        </div>

        <div class="state-container" :class="{ 'state-container--loading': isLoading }">
          <div class="state-summary">
            <h3>Machine State at Line {{ selectedLine }}</h3>
            <div class="state-grid">
              <div class="state-item">
                <span class="state-label">Tool</span>
                <span class="state-value">{{ analyzedState?.tool != null ? `T${analyzedState.tool}` : '---' }}</span>
              </div>
              <div class="state-item">
                <span class="state-label">Position</span>
                <span class="state-value">
                  X{{ formatNumber(analyzedState?.position?.x) }}
                  Y{{ formatNumber(analyzedState?.position?.y) }}
                  Z{{ formatNumber(analyzedState?.position?.z) }}
                </span>
              </div>
              <div class="state-item">
                <span class="state-label">Spindle</span>
                <span class="state-value">{{ spindleDisplay }}</span>
              </div>
              <div class="state-item">
                <span class="state-label">Coolant/Aux</span>
                <span class="state-value">{{ coolantDisplay }}</span>
              </div>
              <div class="state-item">
                <span class="state-label">Feed Rate</span>
                <span class="state-value">F{{ analyzedState?.feedRate || 0 }}</span>
              </div>
              <div class="state-item">
                <span class="state-label">Units</span>
                <span class="state-value">{{ analyzedState?.units === 'G20' ? 'Inch' : 'MM' }}</span>
              </div>
            </div>
          </div>

          <div v-if="resumeSequence.length > 0" class="resume-sequence-section">
            <button
              class="resume-sequence-toggle"
              @click="showResumeSequence = !showResumeSequence"
              type="button"
            >
              <svg
                class="toggle-icon"
                :class="{ 'toggle-icon--open': showResumeSequence }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
              <span>Resume Sequence ({{ resumeSequence.length }} commands)</span>
            </button>
            <div v-if="showResumeSequence" class="resume-sequence-editor">
              <CodeEditor
                :value="resumeSequenceContent"
                language="gcode"
                :theme="monacoTheme"
                :options="resumeSequenceEditorOptions"
                :height="resumeEditorHeight"
              />
              <div class="sequence-note">
                These commands will be sent before starting at line {{ selectedLine }}
              </div>
            </div>
          </div>

          <div v-if="toolMismatch" class="tool-mismatch-warning">
            <div class="mismatch-header">
              <svg class="mismatch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Tool Mismatch Detected</span>
            </div>
            <p class="mismatch-text">
              Program expects <strong>T{{ expectedTool }}</strong>, machine has <strong>T{{ currentTool ?? 'None' }}</strong>
            </p>
            <div class="mismatch-actions">
              <button class="btn btn-secondary" @click="handleChangeTool" :disabled="isStarting">
                Change Tool
              </button>
              <button class="btn btn-warning" @click="handleProceedAnyway" :disabled="isStarting">
                Proceed Anyway
              </button>
            </div>
          </div>
        </div>

        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn btn-secondary" @click="handleClose" :disabled="isStarting">
          Cancel
        </button>
        <button
          class="btn btn-primary"
          @click="handleConfirm"
          :disabled="!canStart || isStarting"
        >
          <span v-if="isStarting" class="loading-spinner loading-spinner--small"></span>
          {{ isStarting ? 'Starting...' : `Start from Line ${selectedLine}` }}
        </button>
      </div>
    </div>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import Dialog from '@/components/Dialog.vue';
import { CodeEditor } from 'monaco-editor-vue3';
import { api } from '@/lib/api';

const props = defineProps({
  show: {
    type: Boolean,
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  totalLines: {
    type: Number,
    required: true
  },
  initialLine: {
    type: Number,
    default: 1,
    validator: (value) => Number.isInteger(value) && value >= 1
  }
});

const emit = defineEmits(['close', 'started']);

const selectedLine = ref(props.initialLine);
const spindleDelaySec = ref(0);
const isLoading = ref(false);
const isStarting = ref(false);
const errorMessage = ref('');
const skipToolCheck = ref(false);

const analyzedState = ref(null);
const toolMismatch = ref(false);
const expectedTool = ref(null);
const currentTool = ref(null);
const resumeSequence = ref([]);
const showResumeSequence = ref(false);

// Theme detection for Monaco
const isLightTheme = ref(document.body.classList.contains('theme-light'));
const monacoTheme = computed(() => isLightTheme.value ? 'gcode-light' : 'gcode-dark');

let themeObserver = null;

// Monaco editor options for resume sequence preview
const resumeSequenceEditorOptions = {
  readOnly: true,
  minimap: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  automaticLayout: true,
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  renderLineHighlight: 'none',
  selectionHighlight: false,
  occurrencesHighlight: 'off',
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 16,
  lineNumbersMinChars: 2,
  scrollbar: {
    vertical: 'auto',
    horizontal: 'hidden',
    useShadows: false,
    verticalScrollbarSize: 6
  }
};

// Computed content for Monaco editor
const resumeSequenceContent = computed(() => {
  return resumeSequence.value.join('\n');
});

// Dynamic height based on number of commands
const resumeEditorHeight = computed(() => {
  const lineCount = resumeSequence.value.length;
  const lineHeight = 18;
  const minHeight = 60;
  const maxHeight = 180;
  return Math.min(maxHeight, Math.max(minHeight, lineCount * lineHeight + 10)) + 'px';
});

const spindleDisplay = computed(() => {
  if (!analyzedState.value) return 'Off';
  const state = analyzedState.value;
  if (state.spindleState === 'M3') return `CW @ ${state.spindleSpeed} RPM`;
  if (state.spindleState === 'M4') return `CCW @ ${state.spindleSpeed} RPM`;
  return 'Off';
});

const coolantDisplay = computed(() => {
  if (!analyzedState.value) return 'Off';
  const state = analyzedState.value;
  const parts = [];
  if (state.coolantFlood) parts.push('Flood');
  if (state.coolantMist) parts.push('Mist');
  // Add auxiliary outputs (M64)
  if (state.auxOutputs) {
    for (const [key, isOn] of Object.entries(state.auxOutputs)) {
      if (isOn && key.startsWith('P')) {
        parts.push(`M64 ${key}`);
      }
    }
  }
  return parts.length > 0 ? parts.join(' + ') : 'Off';
});

const canStart = computed(() => {
  return analyzedState.value &&
         !isLoading.value &&
         !errorMessage.value &&
         selectedLine.value >= 1 &&
         selectedLine.value <= props.totalLines &&
         (!toolMismatch.value || skipToolCheck.value);
});

function formatNumber(val) {
  if (val === null || val === undefined) return '0';
  return Number(val).toFixed(3);
}

async function analyzeState() {
  if (selectedLine.value < 1 || selectedLine.value > props.totalLines) {
    errorMessage.value = 'Invalid line number';
    return;
  }

  isLoading.value = true;
  errorMessage.value = '';
  analyzedState.value = null;
  toolMismatch.value = false;
  skipToolCheck.value = false;

  try {
    const result = await api.analyzeGCodeLine(selectedLine.value);
    analyzedState.value = result.state;
    toolMismatch.value = result.toolMismatch;
    expectedTool.value = result.expectedTool;
    currentTool.value = result.currentTool;
    resumeSequence.value = result.resumeSequence || [];
  } catch (error) {
    errorMessage.value = error.message || 'Failed to analyze G-code';
  } finally {
    isLoading.value = false;
  }
}

function preventDecimal(event) {
  if (event.key === '.' || event.key === ',' || event.key === '-' || event.key === 'e') {
    event.preventDefault();
  }
}

function handleLineChange() {
  // Ensure value is a positive integer within range
  let value = Math.floor(Number(selectedLine.value) || 1);
  value = Math.max(1, Math.min(value, props.totalLines));
  selectedLine.value = value;
  analyzeState();
}

function clampSpindleDelay() {
  let value = Number(spindleDelaySec.value) || 0;
  value = Math.max(0, Math.min(value, 10));
  spindleDelaySec.value = value;
}

function handleChangeTool() {
  emit('close');
  api.triggerToolChange(expectedTool.value);
}

function handleProceedAnyway() {
  skipToolCheck.value = true;
}

async function handleConfirm() {
  if (!canStart.value) return;

  isStarting.value = true;
  errorMessage.value = '';

  try {
    await api.startGCodeJobFromLine(props.filename, selectedLine.value, {
      skipToolCheck: skipToolCheck.value,
      spindleDelaySec: spindleDelaySec.value,
      approachHeight: 10,
      plungeFeedRate: 500
    });

    emit('started', { line: selectedLine.value });
    emit('close');
  } catch (error) {
    if (error.toolMismatch) {
      toolMismatch.value = true;
      expectedTool.value = error.expectedTool;
      currentTool.value = error.currentTool;
    }
    errorMessage.value = error.message || 'Failed to start job';
  } finally {
    isStarting.value = false;
  }
}

function handleClose() {
  if (!isStarting.value) {
    emit('close');
  }
}

watch(() => props.initialLine, (newVal) => {
  selectedLine.value = newVal;
  analyzeState();
});

watch(() => props.show, (newVal) => {
  if (newVal) {
    selectedLine.value = props.initialLine;
    analyzeState();
  }
});

onMounted(() => {
  if (props.show) {
    analyzeState();
  }

  // Watch for theme changes
  themeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class') {
        isLightTheme.value = document.body.classList.contains('theme-light');
      }
    }
  });
  themeObserver.observe(document.body, { attributes: true });
});

onUnmounted(() => {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
});
</script>

<style scoped>
.start-from-line-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-md);
  min-width: 450px;
}

.dialog-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.warning-banner {
  display: flex;
  gap: var(--gap-sm);
  padding: var(--gap-sm);
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.4);
  border-radius: 8px;
  color: var(--color-warning, #fbbf24);
}

.warning-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.warning-text strong {
  display: block;
  margin-bottom: 4px;
}

.warning-text p {
  margin: 0;
  font-size: 0.875rem;
  opacity: 0.9;
}

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.input-row {
  display: flex;
  gap: var(--gap-md);
  align-items: flex-start;
}

.input-row .input-group {
  flex: 1;
}

.state-container {
  min-height: 180px;
  transition: opacity 0.15s ease;
}

.state-container--loading {
  opacity: 0.5;
  pointer-events: none;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
}

.input-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.line-input-row,
.spindle-delay-row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.line-input,
.delay-input {
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 1rem;
  width: 100px;
}

.line-total,
.input-unit {
  color: var(--color-text-secondary);
  font-size: 0.875rem;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-md);
  justify-content: center;
  color: var(--color-text-secondary);
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-spinner--small {
  width: 14px;
  height: 14px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.state-summary {
  background: var(--color-surface-secondary, rgba(255,255,255,0.05));
  border-radius: 8px;
  padding: var(--gap-sm);
}

.state-summary h3 {
  margin: 0 0 var(--gap-sm) 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.state-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--gap-xs) var(--gap-md);
}

.state-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
}

.state-label {
  color: var(--color-text-secondary);
}

.state-value {
  font-family: var(--font-mono);
  color: var(--color-text);
}

.tool-mismatch-warning {
  margin-top: var(--gap-md);
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 8px;
  padding: var(--gap-sm);
}

.mismatch-header {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  color: var(--color-danger, #ef4444);
  font-weight: 600;
  margin-bottom: var(--gap-xs);
}

.mismatch-icon {
  width: 20px;
  height: 20px;
}

.mismatch-text {
  margin: 0 0 var(--gap-sm) 0;
  font-size: 0.875rem;
}

.mismatch-actions {
  display: flex;
  gap: var(--gap-sm);
}

.error-message {
  color: var(--color-danger, #ef4444);
  font-size: 0.875rem;
  padding: var(--gap-sm);
  background: rgba(239, 68, 68, 0.1);
  border-radius: 6px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-sm);
  padding-top: var(--gap-sm);
  border-top: 1px solid var(--color-border);
}

.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  transition: all 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--color-primary, #3b82f6);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-primary-hover, #2563eb);
}

.btn-secondary {
  background: var(--color-surface-secondary, rgba(255,255,255,0.1));
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-surface-hover, rgba(255,255,255,0.15));
}

.btn-warning {
  background: rgba(251, 191, 36, 0.2);
  color: var(--color-warning, #fbbf24);
  border: 1px solid rgba(251, 191, 36, 0.4);
}

.btn-warning:hover:not(:disabled) {
  background: rgba(251, 191, 36, 0.3);
}

.resume-sequence-section {
  margin-top: var(--gap-sm);
}

.resume-sequence-toggle {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  padding: var(--gap-xs) 0;
  transition: color 0.15s ease;
}

.resume-sequence-toggle:hover {
  color: var(--color-text);
}

.toggle-icon {
  width: 16px;
  height: 16px;
  transition: transform 0.15s ease;
}

.toggle-icon--open {
  transform: rotate(90deg);
}

.resume-sequence-editor {
  margin-top: var(--gap-xs);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.sequence-note {
  padding: var(--gap-xs) var(--gap-sm);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-style: italic;
  background: var(--color-surface-secondary, rgba(0,0,0,0.1));
  border-top: 1px solid var(--color-border);
}
</style>

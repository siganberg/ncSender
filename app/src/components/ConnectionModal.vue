<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal">
      <div class="modal__header">
        <h3>Connect to CNC Controller</h3>
        <button class="close-btn" @click="close" aria-label="Close">×</button>
      </div>
      
      <div class="modal__content">
        <div class="connection-status" :class="connectionStatus.status">
          <div class="status-indicator"></div>
          <span>{{ connectionStatus.message || getStatusMessage() }}</span>
        </div>

        <div class="form-group">
          <label for="port-select">Serial Port:</label>
          <select 
            id="port-select" 
            v-model="selectedPort" 
            :disabled="isConnecting || isConnected"
            class="port-select"
          >
            <option value="">Select a port...</option>
            <option 
              v-for="port in availablePorts" 
              :key="port.path" 
              :value="port.path"
            >
              {{ port.path }} {{ port.manufacturer ? `(${port.manufacturer})` : '' }}
            </option>
          </select>
          <button @click="refreshPorts" :disabled="isConnecting" class="refresh-btn">
            🔄 Refresh
          </button>
        </div>

        <div class="form-group">
          <label for="baud-rate">Baud Rate:</label>
          <select 
            id="baud-rate" 
            v-model="baudRate" 
            :disabled="isConnecting || isConnected"
            class="baud-select"
          >
            <option :value="9600">9600</option>
            <option :value="19200">19200</option>
            <option :value="38400">38400</option>
            <option :value="57600">57600</option>
            <option :value="115200">115200</option>
            <option :value="230400">230400</option>
            <option :value="250000">250000</option>
          </select>
        </div>

        <div v-if="connectionStatus.retryAttempts > 0" class="retry-info">
          Retry attempt: {{ connectionStatus.retryAttempts }} / 5
        </div>
      </div>

      <div class="modal__footer">
        <button @click="close" class="btn-secondary">Cancel</button>
        <button 
          v-if="!isConnected" 
          @click="connect" 
          :disabled="!selectedPort || isConnecting"
          class="btn-primary"
        >
          {{ isConnecting ? 'Connecting...' : 'Connect' }}
        </button>
        <button 
          v-else 
          @click="disconnect" 
          class="btn-danger"
        >
          Disconnect
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';

interface SerialPort {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

interface ConnectionStatus {
  isConnected: boolean;
  status: string;
  retryAttempts: number;
  message?: string;
}

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'connected'): void;
}>();

const availablePorts = ref<SerialPort[]>([]);
const selectedPort = ref('');
const baudRate = ref(115200);
const connectionStatus = ref<ConnectionStatus>({
  isConnected: false,
  status: 'disconnected',
  retryAttempts: 0,
  message: ''
});

const isConnecting = computed(() => 
  connectionStatus.value.status === 'connecting' || 
  connectionStatus.value.status === 'retrying'
);

const isConnected = computed(() => connectionStatus.value.isConnected);

const getStatusMessage = () => {
  switch (connectionStatus.value.status) {
    case 'connected': return 'Connected to CNC controller';
    case 'connecting': return 'Connecting to CNC controller...';
    case 'disconnected': return 'Not connected';
    case 'retrying': return 'Retrying connection...';
    case 'error': return 'Connection error';
    case 'failed': return 'Connection failed';
    default: return 'Ready to connect';
  }
};

const refreshPorts = async () => {
  try {
    console.log('🔍 Frontend: refreshPorts() called');
    const response = await fetch('/api/serial-ports');
    const ports = await response.json();
    console.log('🔍 Frontend: Received ports:', ports);
    availablePorts.value = ports;
    console.log('🔍 Frontend: availablePorts.value now contains:', availablePorts.value);
  } catch (error) {
    console.error('❌ Frontend: Failed to list ports:', error);
  }
};

const connect = async () => {
  if (!selectedPort.value) return;

  try {
    const response = await fetch('/api/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        port: selectedPort.value,
        baudRate: baudRate.value
      })
    });
    const result = await response.json();
    if (result.success) {
      emit('connected');
    }
  } catch (error) {
    console.error('Failed to connect:', error);
  }
};



const close = () => {
  emit('close');
};

const disconnect = async () => {
  try {
    await fetch('/api/disconnect', { method: 'POST' });
  } catch (error) {
    console.error('Failed to disconnect:', error);
  }
};

// Set up event listeners for CNC status updates
onMounted(() => {
  const checkNcSender = setInterval(() => {
    if ((window as any).ncSender?.cnc) {
      clearInterval(checkNcSender);
      (window as any).ncSender.cnc.onStatus((data: any) => {
        connectionStatus.value = {
          isConnected: data.status === 'connected',
          status: data.status,
          retryAttempts: 0,
          message: data.message
        };
      });

      // Get initial status
      (window as any).ncSender.cnc.getStatus().then((status: any) => {
        connectionStatus.value = status;
      });

      refreshPorts();
    }
  }, 100);
});

// Watch for modal visibility to refresh ports
watch(() => props.visible, (visible) => {
  if (visible) {
    refreshPorts();
  }
});
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-surface);
  border-radius: var(--radius-large);
  box-shadow: var(--shadow-elevated);
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-lg) var(--gap-lg) 0;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: var(--gap-lg);
}

.modal__header h3 {
  margin: 0;
  color: var(--color-text-primary);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-small);
}

.close-btn:hover {
  background: var(--color-surface-muted);
}

.modal__content {
  padding: 0 var(--gap-lg);
}

.connection-status {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-md);
  border-radius: var(--radius-medium);
  margin-bottom: var(--gap-lg);
  font-weight: 500;
}

.connection-status.connected {
  background: rgba(46, 204, 113, 0.1);
  color: #2ecc71;
  border: 1px solid rgba(46, 204, 113, 0.3);
}

.connection-status.connecting,
.connection-status.retrying {
  background: rgba(255, 193, 7, 0.1);
  color: #ffc107;
  border: 1px solid rgba(255, 193, 7, 0.3);
}

.connection-status.disconnected {
  background: rgba(108, 117, 125, 0.1);
  color: #6c757d;
  border: 1px solid rgba(108, 117, 125, 0.3);
}

.connection-status.error,
.connection-status.failed {
  background: rgba(220, 53, 69, 0.1);
  color: #dc3545;
  border: 1px solid rgba(220, 53, 69, 0.3);
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.form-group {
  margin-bottom: var(--gap-lg);
}

.form-group label {
  display: block;
  margin-bottom: var(--gap-xs);
  font-weight: 500;
  color: var(--color-text-primary);
}

.port-select,
.baud-select {
  width: 100%;
  padding: var(--gap-sm) var(--gap-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.port-select {
  width: calc(100% - 80px);
  margin-right: var(--gap-sm);
}

.refresh-btn {
  padding: var(--gap-sm) var(--gap-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 0.9rem;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--color-surface);
}

.retry-info {
  padding: var(--gap-sm);
  background: rgba(255, 193, 7, 0.1);
  border-radius: var(--radius-small);
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  text-align: center;
  margin-bottom: var(--gap-lg);
}

.modal__footer {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  padding: var(--gap-lg);
  border-top: 1px solid var(--color-border);
  margin-top: var(--gap-lg);
}

.btn-primary,
.btn-secondary,
.btn-danger {
  padding: var(--gap-sm) var(--gap-lg);
  border: none;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-primary {
  background: var(--gradient-accent);
  color: white;
}

.btn-secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.btn-danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8));
  color: white;
}

.btn-primary:disabled,
.btn-secondary:disabled,
.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px rgba(26, 188, 156, 0.5);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--color-surface);
}

.btn-danger:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px rgba(255, 107, 107, 0.5);
}
</style>
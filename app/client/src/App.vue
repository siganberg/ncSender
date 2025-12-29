<template>
  <!-- Mobile View -->
  <MobileView
    v-if="isMobileView"
    :status="{ ...status, connected: isConnected }"
    :jog-config="jogConfig"
    @update:stepSize="jogConfig.stepSize = $event"
    @update:feedRate="jogConfig.feedRate = $event"
  />

  <!-- Desktop View -->
  <AppShell v-else>
    <template #top-toolbar>
      <TopToolbar
        :workspace="workspace"
        :sender-status="currentSenderStatus"
        :last-alarm-code="lastAlarmCode"
        :update-state="updateState"
        @toggle-theme="toggleTheme"
        @unlock="handleUnlock"
        @change-workspace="handleWorkspaceChange"
        @show-update-dialog="openUpdateDialog"
        :on-show-settings="openSettings"
      />
    </template>

    <template #main>
      <GCodeVisualizer
        :view="viewport"
        :theme="theme"
        :sender-status="currentSenderStatus"
        :machine-state="serverState.machineState"
        :job-loaded="serverState.jobLoaded"
        :work-coords="status.workCoords"
        :work-offset="status.wco"
        :grid-size-x="gridSizeX"
        :grid-size-y="gridSizeY"
        :z-max-travel="zMaxTravel"
        :machine-orientation="machineOrientation"
        :spindle-rpm-target="status.spindleRpmTarget"
        :spindle-rpm-actual="status.spindleRpmActual"
        :current-tool="status.tool"
        :tool-length-set="status.toolLengthSet"
        :alarm-message="alarmMessage"
        @change-view="viewport = $event"
      />
      <RightPanel
        :status="{ ...status, connected: isConnected }"
        :console-lines="consoleLines"
        :jog-config="jogConfig"
        :job-loaded="serverState.jobLoaded"
        :grid-size-x="gridSizeX"
        :grid-size-y="gridSizeY"
        :z-max-travel="zMaxTravel"
        :machine-orientation="machineOrientation"
        :sender-status="currentSenderStatus"
        @update:jog-step="jogConfig.stepSize = $event"
        @update:jog-feed-rate="jogConfig.feedRate = $event"
        @clear-console="clearConsole"
      />
    </template>

    <!-- Utility bar hidden for now -->
    <!-- <template #utility-bar>
      <UtilityBar
        :connected="status.connected"
        :theme="theme"
        @toggle-theme="toggleTheme"
      />
    </template> -->
  </AppShell>

  <!-- Dialogs (hidden in mobile view) -->
  <template v-if="!isMobileView">
    <!-- Dialog moved outside AppShell to avoid overflow clipping -->
    <Dialog v-if="showSettings" @close="closeSettings" :show-header="false" size="medium">
    <div class="settings-container">
      <div class="tabs">
        <button
          v-for="tab in settingsTabs"
          :key="tab.id"
          class="tab-button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          <span class="tab-icon" v-html="tab.icon"></span>
          <span class="tab-label">{{ tab.label }}</span>
        </button>
      </div>

      <div class="tab-content">
        <!-- General Tab -->
        <div v-if="activeTab === 'general'" class="tab-panel tab-panel--general">
          <div class="settings-section">
            <h3 class="section-title">Connection Settings</h3>
            <div class="setting-item">
              <label class="setting-label">Connection Type</label>
              <select class="setting-select setting-input--right" v-model="connectionSettings.type" @change="loadMainUsbPorts">
                <option value="USB">USB</option>
                <option value="Ethernet">Ethernet</option>
              </select>
            </div>
            <div class="setting-item" v-if="connectionSettings.type === 'USB'">
              <label class="setting-label">USB Port</label>
              <div class="custom-dropdown">
                <button
                  class="dropdown-trigger setting-input--right"
                  :class="{ 'invalid': !mainValidation.usbPort && connectionSettings.type === 'USB' }"
                  @click="mainUsbDropdownOpen = !mainUsbDropdownOpen"
                  type="button"
                >
                  <span>{{ getSelectedMainPortDisplay() }}</span>
                  <span class="dropdown-arrow">▼</span>
                </button>
                <div v-if="mainUsbDropdownOpen" class="dropdown-menu">
                  <div
                    v-if="availableUsbPorts.length === 0"
                    class="dropdown-item disabled"
                  >
                    No USB ports available
                  </div>
                  <div
                    v-for="port in availableUsbPorts"
                    :key="port.path"
                    class="dropdown-item"
                    @click="selectMainUsbPort(port)"
                  >
                    <div class="port-path">{{ port.path }}</div>
                    <div class="port-manufacturer">{{ port.manufacturer || 'Unknown Manufacturer' }}</div>
                  </div>
                </div>
              </div>
            </div>
            <div class="setting-item">
              <label class="setting-label">Baud Rate</label>
              <select class="setting-select setting-input--right" v-model="connectionSettings.baudRate">
                <option value="9600">9600</option>
                <option value="19200">19200</option>
                <option value="38400">38400</option>
                <option value="57600">57600</option>
                <option value="115200">115200</option>
                <option value="230400">230400</option>
                <option value="460800">460800</option>
                <option value="921600">921600</option>
              </select>
            </div>
            <div class="setting-item">
              <label class="setting-label">IP Address</label>
              <input
                type="text"
                class="setting-input setting-input--right"
                v-model="connectionSettings.ipAddress"
                :disabled="connectionSettings.type === 'USB'"
                :class="{ 'invalid': !isValidIP && connectionSettings.type === 'Ethernet' }"
                placeholder="192.168.5.1"
                @blur="validateIP"
              >
            </div>
            <div class="setting-item">
              <label class="setting-label">Port</label>
              <input
                type="number"
                class="setting-input setting-input--right"
                v-model="connectionSettings.port"
                :disabled="connectionSettings.type === 'USB'"
                :class="{ 'invalid': !mainValidation.port && connectionSettings.type === 'Ethernet' }"
                min="1"
                max="65535"
                @blur="validateMainPort"
              >
            </div>
            <div class="setting-item setting-item--with-note">
              <div class="setting-item-content">
                <label class="setting-label">Remote Control Port</label>
                <div class="settings-note">
                  Note: Changes this require restarting the application to take effect.
                </div>
              </div>
              <input
                type="number"
                class="setting-input setting-input--right"
                v-model="connectionSettings.serverPort"
                min="1024"
                max="65535"
              >
            </div>
            <div class="setting-item">
              <label class="setting-label"></label>
              <button class="save-connection-button" @click="saveConnectionSettings">
                Save
              </button>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="section-title">Application Settings</h3>
            <div class="settings-group">
              <div class="setting-item setting-item--with-note">
                <div class="setting-item-content">
                  <label class="setting-label">Use Door as Pause</label>
                  <div class="settings-note">
                    Note: Ensure that the parking parameters ($41, $42, $56, $57, $58, $59) are properly configured as part of your setup.
                  </div>
                </div>
                <ToggleSwitch v-model="useDoorAsPause" />
              </div>
              <div class="setting-item setting-item--with-note">
                <div class="setting-item-content">
                  <label class="setting-label">Units</label>
                  <div class="settings-note">
                    Choose between Metric (mm) and Imperial (inches) for coordinates, distances, and feed rates.
                  </div>
                </div>
                <div class="units-toggle">
                  <button :class="['units-button', { active: unitsPreference === 'metric' }]" @click="setUnits('metric')">Metric (mm)</button>
                  <button :class="['units-button', { active: unitsPreference === 'imperial' }]" @click="setUnits('imperial')">Imperial (in)</button>
                </div>
              </div>
              <div class="setting-item setting-item--with-note">
                <div class="setting-item-content">
                  <label class="setting-label">Machine Home Location</label>
                  <div class="settings-note">
                    Specify where your machine's physical home position (0,0) is located on the machine table.
                  </div>
                </div>
                <select class="setting-select" v-model="homeLocation" @change="saveHomeLocation">
                  <option value="back-left">Back-Left (Default)</option>
                  <option value="back-right">Back-Right</option>
                  <option value="front-left">Front-Left</option>
                  <option value="front-right">Front-Right</option>
                </select>
              </div>
              <div class="setting-item setting-item--with-note">
                <div class="setting-item-content">
                  <label class="setting-label">Enable Browser Debug Logging</label>
                  <div class="settings-note">
                    Enables console logging for debugging. Useful for troubleshooting issues.
                  </div>
                </div>
                <ToggleSwitch v-model="consoleSettings.debugLogging" />
              </div>
              <div class="setting-item setting-item--with-note">
                <div class="setting-item-content">
                  <label class="setting-label">Stop Deceleration Delay</label>
                  <div class="settings-note">
                    Time to wait after Feed Hold before Soft Reset when stopping a job. Allows machine to decelerate smoothly.
                  </div>
                </div>
                <select class="setting-select" v-model="pauseBeforeStop" @change="savePauseBeforeStop">
                  <option :value="0">None (Immediate)</option>
                  <option :value="250">Short (250ms)</option>
                  <option :value="500">Medium (500ms)</option>
                  <option :value="1000">Long (1s)</option>
                  <option :value="2000">Extra Long (2s)</option>
                </select>
              </div>
              <div class="setting-item">
                <label class="setting-label">Accent / Gradient Color</label>
                <div class="color-controls">
                  <div class="color-picker-container">
                    <input type="color" class="color-picker" :value="accentColor" @input="updateAccentColor($event.target.value)" @change="saveColors">
                    <input type="color" class="color-picker" :value="gradientColor" @input="updateGradientColor($event.target.value)" @change="saveColors">
                  </div>
                  <button class="reset-colors-button" @click="resetColors">Reset</button>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h3 class="section-title">Auxiliary Outputs</h3>
            <div class="io-switches-table-container">
              <table class="io-switches-table">
                <colgroup>
                  <col class="col-enabled">
                  <col class="col-name">
                  <col class="col-on">
                  <col class="col-off">
                  <col class="col-actions">
                </colgroup>
                <thead>
                  <tr>
                    <th>Enabled</th>
                    <th>Name</th>
                    <th>On</th>
                    <th>Off</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(output, index) in auxOutputs" :key="output.id">
                    <td>
                      <ToggleSwitch v-model="output.enabled" @update:modelValue="saveAuxOutputs" />
                    </td>
                    <template v-if="editingAuxIndex === index">
                      <td>
                        <input type="text" v-model="auxEditState.name" class="aux-inline-input" placeholder="Name" />
                      </td>
                      <td>
                        <select v-model="auxEditState.on" class="aux-inline-select">
                          <option v-for="cmd in availableOnCommands" :key="cmd.value" :value="cmd.value">{{ cmd.label }}</option>
                        </select>
                      </td>
                      <td class="command-cell">{{ getOffCommand(auxEditState.on) }}</td>
                      <td>
                        <div class="aux-actions-cell">
                          <button class="aux-btn-save" @click="saveAuxEdit" title="Save">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                          </button>
                          <button class="aux-btn-cancel" @click="cancelAuxEdit" title="Cancel">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                          <button class="aux-btn-delete" @click="deleteAuxOutput(index)" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </template>
                    <template v-else>
                      <td>{{ output.name }}</td>
                      <td class="command-cell">{{ output.on }}</td>
                      <td class="command-cell">{{ getOffCommand(output.on) }}</td>
                      <td>
                        <button class="switch-edit-btn" @click="startAuxEdit(index)" title="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      </td>
                    </template>
                  </tr>
                </tbody>
              </table>
              <button class="aux-add-btn" @click="addAuxOutput">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add Output
              </button>
            </div>
          </div>

        </div>

        <!-- Tools Tab -->
        <div v-if="activeTab === 'tools'" class="tab-panel tab-panel--tools">
          <ToolsTab
            :max-tool-count="toolCount"
            :tool-count="toolCount"
            :show-manual-button="showManualButton"
            :show-tls-button="showTLSButton"
            :show-probe-button="showProbeButton"
            :tool-count-disabled="toolCountDisabled"
            :tool-source-name="toolSourceName"
            @update:tool-count="handleToolCountUpdate"
            @update:show-manual-button="handleShowManualButtonUpdate"
            @update:show-tls-button="handleShowTLSButtonUpdate"
            @update:show-probe-button="handleShowProbeButtonUpdate"
          />
        </div>

        <!-- Controls Tab -->
        <div v-if="activeTab === 'keyboard'" class="tab-panel tab-panel--keyboard">
          <ControlsTab />
        </div>

        <!-- Plugins Tab -->
        <div v-if="activeTab === 'plugins'" class="tab-panel tab-panel--plugins">
          <PluginsTab />
        </div>

        <!-- Logs Tab -->
        <div v-if="activeTab === 'logs'" class="tab-panel tab-panel--logs">
          <LogsTab />
        </div>

        <!-- Firmware Tab -->
        <div v-if="activeTab === 'firmware'" class="tab-panel tab-panel--firmware">
          <!-- Loading State -->
          <div v-if="isFirmwareLoading" class="firmware-loading">
            <div class="loading-spinner"></div>
            <p>Loading firmware settings...</p>
            <p class="loading-hint">Fetching firmware data from controller</p>
          </div>

          <!-- Error State -->
          <div v-else-if="firmwareError" class="firmware-error">
            <p class="error-message">{{ firmwareError }}</p>
            <button @click="loadFirmwareData" class="retry-button">Retry</button>
          </div>

          <!-- No Data State (Not Connected) -->
          <div v-else-if="!firmwareData && !status.connected" class="firmware-empty">
            <p>Connect to a CNC controller to query firmware settings</p>
          </div>

          <!-- Firmware Data Display -->
          <div v-else-if="firmwareData" class="firmware-content">
            <!-- Header with search and submit -->
            <div class="firmware-header">
              <input
                type="text"
                v-model="firmwareSearchQuery"
                placeholder="Search Firmware Settings..."
                class="firmware-search-input"
              />
              <button @click="importFirmwareSettings" class="import-export-button">
                Import
              </button>
              <button @click="exportFirmwareSettings" class="import-export-button">
                Export
              </button>
              <button @click="openFirmwareFlasher" class="flash-firmware-button">
                Flash Firmware
              </button>
              <button
                @click="submitFirmwareChanges"
                class="submit-changes-button"
                :disabled="!hasFirmwareChanges"
              >
                Submit{{ hasFirmwareChanges ? ` (${Object.keys(firmwareChanges).length})` : '' }}
              </button>
            </div>

            <!-- Firmware Settings Table -->
            <div class="firmware-table-container">
              <table class="firmware-table">
                <thead>
                  <tr>
                    <th class="col-setting">$ Setting</th>
                    <th class="col-description">Description</th>
                    <th class="col-value">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="setting in filteredFirmwareSettings"
                    :key="setting.id"
                    class="firmware-row"
                  >
                    <td class="col-setting">
                      <div class="setting-id">{{ setting.id }}</div>
                      <div class="setting-group" v-if="setting.group">{{ setting.group.name }}</div>
                    </td>
                    <td class="col-description">
                      <div class="setting-name">
                        {{ setting.name }}
                        <span v-if="setting.halDetails && setting.halDetails[7] === '1'" class="requires-restart-badge" title="Changing this setting requires controller restart">
                          Requires Restart
                        </span>
                      </div>
                      <div
                        class="setting-hal-description"
                        v-if="setting.halDetails && setting.halDetails[4]"
                        v-html="setting.halDetails[4].replace(/\\n/g, '<br>')"
                      ></div>
                      <div class="setting-details" v-if="(setting.unit || setting.min || setting.max) && setting.dataType !== 7">
                        <span v-if="setting.unit">Unit: {{ setting.unit }}</span>
                        <span v-if="setting.min">Min: {{ setting.min }}</span>
                        <span v-if="setting.max">Max: {{ setting.max }}</span>
                      </div>
                    </td>
                    <td class="col-value">
                      <!-- Named bitfield (toggle sliders) -->
                      <div v-if="isNamedBitfield(setting)" class="bitfield-toggles">
                        <template
                          v-for="(bitName, index) in setting.format.split(',')"
                          :key="index"
                        >
                          <template v-if="bitName.trim() !== 'N/A' && bitName.trim() !== ''">
                            <span class="bitfield-name">{{ bitName.trim() }}</span>
                            <label class="toggle-switch">
                              <input
                                type="checkbox"
                                :checked="isBitSet(firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : setting.value, index)"
                                @change="toggleBit(setting, index)"
                              />
                              <span class="toggle-slider"></span>
                            </label>
                          </template>
                        </template>
                      </div>

                      <!-- Axis bitfield (uses standard axis order) -->
                      <div v-else-if="isAxisBitfield(setting)" class="bitfield-toggles">
                        <template
                          v-for="(axisLabel, index) in getAxisBitLabels(setting)"
                          :key="`${setting.id}-${axisLabel}`"
                        >
                          <span class="bitfield-name">{{ axisLabel }}</span>
                          <label class="toggle-switch">
                            <input
                              type="checkbox"
                              :checked="isBitSet(firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : setting.value, index)"
                              @change="toggleBit(setting, index)"
                            />
                            <span class="toggle-slider"></span>
                          </label>
                        </template>
                      </div>

                      <!-- DataType 0-1, 3-5: Integers (int8, uint8, int16, uint16, int32, uint32) -->
                      <div v-else-if="setting.dataType === 0" class="toggle-input-container">
                        <ToggleSwitch
                          :model-value="getBooleanSettingValue(setting)"
                          @update:modelValue="updateBooleanSetting(setting, $event)"
                        />
                      </div>
                      <div v-else-if="isRadioSetting(setting)" class="radio-input-container">
                        <label
                          v-for="option in getRadioOptions(setting)"
                          :key="`${setting.id}-${option.value}`"
                          class="radio-option"
                        >
                          <input
                            type="radio"
                            :name="`firmware-setting-${setting.id}`"
                            :value="option.value"
                            :checked="String(firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : setting.value ?? '') === option.value"
                            @change="updateNumericSetting(setting, option.value)"
                          />
                          <span>{{ option.label }}</span>
                        </label>
                      </div>
                      <div v-else-if="[1, 3, 4, 5].includes(setting.dataType)" class="numeric-input-container">
                        <input
                          type="number"
                          :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value !== undefined ? setting.value : '')"
                          @input="updateNumericSetting(setting, $event.target.value)"
                          @keydown.enter="$event.target.blur()"
                          :min="(setting.halDetails && setting.halDetails[8] === '1') ? undefined : (setting.min || undefined)"
                          :max="setting.max || undefined"
                          step="1"
                          :class="['setting-numeric-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                          :placeholder="setting.format || ''"
                        />
                      </div>

                      <!-- DataType 6: Float -->
                      <div v-else-if="setting.dataType === 6" class="numeric-input-container">
                        <input
                          type="number"
                          :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value !== undefined ? setting.value : '')"
                          @input="updateNumericSetting(setting, $event.target.value)"
                          @keydown.enter="$event.target.blur()"
                          :min="(setting.halDetails && setting.halDetails[8] === '1') ? undefined : (setting.min || undefined)"
                          :max="setting.max || undefined"
                          step="any"
                          :class="['setting-numeric-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                          :placeholder="setting.format || ''"
                        />
                      </div>

                      <!-- DataType 7: Bitfield, MAC address, or G-code string -->
                      <div v-else-if="setting.dataType === 7">
                        <!-- MAC address input (format: x(17)) -->
                        <div v-if="setting.format && setting.format.toLowerCase() === 'x(17)'" class="string-input-container">
                          <input
                            type="text"
                            :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value || '')"
                            @input="updateMacAddress(setting, $event.target.value)"
                            @keydown.enter="$event.target.blur()"
                            :maxlength="setting.max ? parseInt(setting.max) : undefined"
                            :class="['setting-string-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                            placeholder="XX:XX:XX:XX:XX:XX"
                          />
                        </div>
                        <!-- G-code string input (format: x(127) or other x(...) values) -->
                        <div v-else-if="setting.format && setting.format.toLowerCase().startsWith('x(')" class="string-input-container">
                          <input
                            type="text"
                            :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value || '')"
                            @input="updateGcodeString(setting, $event.target.value)"
                            @keydown.enter="$event.target.blur()"
                            :maxlength="setting.max ? parseInt(setting.max) : undefined"
                            :class="['setting-string-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                            placeholder="G-code commands (use | as separator)"
                          />
                        </div>
                        <!-- Bitfield toggles -->
                        <div v-else-if="setting.format" class="bitfield-toggles">
                          <template
                            v-for="(bitName, index) in setting.format.split(',')"
                            :key="index"
                          >
                            <template v-if="bitName.trim() !== 'N/A' && bitName.trim() !== ''">
                              <span class="bitfield-name">{{ bitName.trim() }}</span>
                              <label class="toggle-switch">
                                <input
                                  type="checkbox"
                                  :checked="isBitSet(firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : setting.value, index)"
                                  @change="toggleBit(setting, index)"
                                />
                                <span class="toggle-slider"></span>
                              </label>
                            </template>
                          </template>
                        </div>
                      </div>

                      <!-- DataType 8: String -->
                      <div v-else-if="setting.dataType === 8" class="string-input-container">
                        <input
                          type="text"
                          :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value || '')"
                          @input="updateStringSetting(setting, $event.target.value)"
                          @keydown.enter="$event.target.blur()"
                          :minlength="setting.min ? parseInt(setting.min) : undefined"
                          :maxlength="setting.max ? parseInt(setting.max) : undefined"
                          :class="['setting-string-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                          :placeholder="setting.format || ''"
                        />
                      </div>

                      <!-- DataType 9: IP Address -->
                      <div v-else-if="setting.dataType === 9" class="string-input-container">
                        <input
                          type="text"
                          :value="firmwareChanges[setting.id] !== undefined ? firmwareChanges[setting.id] : (setting.value || '')"
                          @input="updateIpAddress(setting, $event.target.value)"
                          @keydown.enter="$event.target.blur()"
                          maxlength="15"
                          :class="['setting-string-input', { 'has-changes': firmwareChanges[setting.id] !== undefined }]"
                          placeholder="192.168.1.1"
                        />
                      </div>

                      <!-- Default display for other data types -->
                      <div v-else>
                        <span class="setting-value-display">{{ setting.value || '—' }}</span>
                        <span class="setting-unit" v-if="setting.unit && setting.value">{{ setting.unit }}</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="filteredFirmwareSettings.length === 0">
                    <td colspan="3" class="no-results">No settings found matching "{{ firmwareSearchQuery }}"</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Footer info -->
            <div class="firmware-footer">
              <span v-if="importSummary" class="import-summary">Import: {{ importSummary.changed }} setting(s) changed out of {{ importSummary.total }} total. Settings are not saved until submitted.</span>
              <span v-else>Last updated: {{ new Date(firmwareData.timestamp).toLocaleString() }}</span>
              <span>{{ filteredFirmwareSettings.length }} of {{ Object.keys(firmwareData.settings || {}).length }} settings</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer with Close Button -->
      <div class="settings-footer">
        <button class="close-button" @click="closeSettings">
          Close
        </button>
      </div>
    </div>
  </Dialog>

  <!-- Mandatory Setup Dialog (non-dismissible) -->
  <Dialog v-if="showSetupDialog" :show-header="false" size="small-plus">
    <div class="setup-container">
      <div class="setup-header">
        <h2 class="setup-title">CNC Controller Setup</h2>
        <p class="setup-subtitle">Configure your CNC connection to continue</p>
      </div>

      <div class="setup-content">
        <div class="setting-item">
          <label class="setting-label">Connection Type</label>
          <select class="setting-select setting-input--right" v-model="setupSettings.type" @change="loadSetupUsbPorts(); validateSetupForm()">
            <option value="USB">USB</option>
            <option value="Ethernet">Ethernet</option>
          </select>
        </div>
        <div class="setting-item" v-if="setupSettings.type === 'USB'">
          <label class="setting-label">Serial Port (USB)</label>
          <div class="custom-dropdown">
            <button
              class="dropdown-trigger setting-input--right"
              :class="{ 'invalid': !setupValidation.usbPort }"
              @click="setupUsbDropdownOpen = !setupUsbDropdownOpen"
              type="button"
            >
              <span>{{ getSelectedSetupPortDisplay() }}</span>
              <span class="dropdown-arrow">▼</span>
            </button>
            <div v-if="setupUsbDropdownOpen" class="dropdown-menu">
              <div
                v-if="setupUsbPorts.length === 0"
                class="dropdown-item disabled"
              >
                No USB ports available
              </div>
              <div
                v-for="port in setupUsbPorts"
                :key="port.path"
                class="dropdown-item"
                @click="selectSetupUsbPort(port)"
              >
                <div class="port-path">{{ port.path }}</div>
                <div class="port-manufacturer">{{ port.manufacturer || 'Unknown Manufacturer' }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="setting-item">
          <label class="setting-label">Baud Rate</label>
          <select class="setting-select setting-input--right" v-model="setupSettings.baudRate">
            <option value="9600">9600</option>
            <option value="19200">19200</option>
            <option value="38400">38400</option>
            <option value="57600">57600</option>
            <option value="115200">115200</option>
            <option value="230400">230400</option>
            <option value="460800">460800</option>
            <option value="921600">921600</option>
          </select>
        </div>
        <div class="setting-item">
          <label class="setting-label">IP Address</label>
          <input
            type="text"
            class="setting-input setting-input--right"
            v-model="setupSettings.ipAddress"
            :disabled="setupSettings.type === 'USB'"
            :class="{ 'invalid': !setupValidation.ipAddress && setupSettings.type === 'Ethernet' }"
            placeholder="192.168.5.1"
            @blur="validateSetupIP"
          >
        </div>
        <div class="setting-item">
          <label class="setting-label">Port</label>
          <input
            type="number"
            class="setting-input setting-input--right"
            v-model="setupSettings.port"
            :disabled="setupSettings.type === 'USB'"
            :class="{ 'invalid': !setupValidation.port && setupSettings.type === 'Ethernet' }"
            min="1"
            max="65535"
            @blur="validateSetupForm"
          >
        </div>
        <div class="setting-item">
          <label class="setting-label">Machine Home Location</label>
          <select class="setting-select setting-input--right" v-model="setupSettings.homeLocation">
            <option value="back-left">Back-Left (Default)</option>
            <option value="back-right">Back-Right</option>
            <option value="front-left">Front-Left</option>
            <option value="front-right">Front-Right</option>
          </select>
        </div>
      </div>

      <div class="setup-footer">
        <button class="setup-save-button" @click="saveSetupSettings">
          Connect
        </button>
      </div>
    </div>
  </Dialog>

  <!-- Workspace Auto-Switch Dialog -->
  <Dialog v-if="showWorkspaceMismatchDialog" @close="handleWorkspaceMismatchConfirm" :show-header="false" size="small" :z-index="10001">
    <ConfirmPanel
      title="Switch Workspace"
      :message="`The loaded program uses ${detectedWorkspace}. Switching from ${workspace} to ${detectedWorkspace} to ensure accurate bounds checking and prevent out-of-limit movements.`"
      :show-cancel="false"
      confirm-text="Confirm"
      variant="primary"
      @confirm="handleWorkspaceMismatchConfirm"
    />
  </Dialog>

  <!-- Units Change Confirmation Dialog -->
  <Dialog v-if="showUnitsConfirmDialog" @close="showUnitsConfirmDialog = false" :show-header="false" size="small" :z-index="10001">
    <ConfirmPanel
      title="Change Units"
      :message="`You are switching to ${pendingUnitsChange === 'imperial' ? 'Imperial (inches)' : 'Metric (mm)'}. We'll also issue a ${pendingUnitsChange === 'imperial' ? 'G20' : 'G21'} command for your convenience.\n\nThis can still be overridden by your program at runtime or by sending a manual unit-switch command.`"
      :show-cancel="false"
      confirm-text="OK"
      variant="primary"
      @confirm="confirmUnitsChange"
    />
  </Dialog>

  <!-- Application Update Dialog -->
  <UpdateDialog
    v-if="showUpdateDialog && updateState.supported"
    :state="updateState"
    @close="closeUpdateDialog"
    @check="handleManualCheckForUpdates"
    @download-install="handleDownloadAndInstallUpdate"
    @download-only="handleDownloadUpdateOnly"
  />

    <!-- Plugin Dialog -->
    <PluginDialog />

  <!-- Plugin Modal Dialog -->
  <ModalDialog
    :isOpen="showPluginModal"
    :content="pluginModalContent"
    :closable="pluginModalClosable"
    @close="showPluginModal = false"
  />

  <!-- Firmware Flasher Dialog -->
  <Dialog v-if="showFirmwareFlasher" @close="closeFirmwareFlasher" :show-header="true" size="small" height="680px">
    <template #header>
      <h2 class="dialog-title">Flash Firmware</h2>
    </template>
    <div class="firmware-flasher-container">
      <div class="flash-warning-box">
        <strong>Warning</strong>
        <p>This will disconnect your machine and flash new firmware. Make sure you have the correct firmware file for your controller.</p>
      </div>

      <div class="flash-form-group">
        <div class="flash-label-row">
          <label class="flash-label">Device Port</label>
          <button class="flash-refresh-btn" @click="fetchFlashPorts" :disabled="firmwareFlashState.isFlashing" title="Refresh ports">
            ↻
          </button>
        </div>
        <select v-model="firmwareFlashState.selectedPort" class="flash-select" :disabled="firmwareFlashState.isFlashing">
          <option value="">Select a port...</option>
          <optgroup label="USB Serial Ports">
            <option v-for="port in firmwareFlashPorts" :key="port.path" :value="port.path">
              {{ port.path }}{{ port.manufacturer ? ` (${port.manufacturer})` : '' }}
            </option>
          </optgroup>
          <optgroup label="DFU Mode (Alternative)">
            <option value="SLB_DFU">SLB_DFU (DFU Mode Device)</option>
          </optgroup>
        </select>
      </div>

      <div class="flash-form-group">
        <label class="flash-label">Firmware File (.hex)</label>
        <div class="flash-file-wrapper">
          <input
            type="file"
            accept=".hex"
            @change="handleHexFileSelect"
            class="flash-file-input-hidden"
            ref="hexFileInputRef"
            :disabled="firmwareFlashState.isFlashing"
          />
          <button
            type="button"
            class="flash-file-btn"
            @click="($refs.hexFileInputRef as HTMLInputElement)?.click()"
            :disabled="firmwareFlashState.isFlashing"
          >
            Choose File
          </button>
          <span class="flash-file-name">{{ firmwareFlashState.hexFileName || 'No file selected' }}</span>
        </div>
      </div>

      <div class="flash-progress-container">
        <div class="flash-progress-header">
          <span>Progress</span>
          <span
            class="flash-status-badge"
            :class="{
              'flashing': firmwareFlashState.status === 'flashing',
              'success': firmwareFlashState.status === 'success',
              'error': firmwareFlashState.status === 'error'
            }"
          >
            {{ firmwareFlashState.status === 'flashing' ? 'Flashing...' : firmwareFlashState.status === 'success' ? 'Complete' : firmwareFlashState.status === 'error' ? 'Error' : 'Idle' }}
          </span>
        </div>
        <div class="flash-progress-bar">
          <div
            class="flash-progress-fill"
            :class="{ 'success': firmwareFlashState.status === 'success', 'error': firmwareFlashState.status === 'error' }"
            :style="{ width: (firmwareFlashState.total > 0 ? (firmwareFlashState.progress / firmwareFlashState.total * 100) : 0) + '%' }"
          ></div>
        </div>
        <div class="flash-progress-text">
          {{ firmwareFlashState.total > 0 ? Math.round(firmwareFlashState.progress / firmwareFlashState.total * 100) : 0 }}%
        </div>
      </div>

      <div class="flash-form-group">
        <div class="flash-label-row">
          <label class="flash-label">Messages</label>
          <button class="flash-copy-btn" @click="copyFlashMessages" title="Copy messages">
            Copy
          </button>
        </div>
        <div class="flash-messages" ref="flashMessagesRef">
          <div
            v-for="(msg, index) in firmwareFlashState.messages"
            :key="index"
            :class="['flash-message', msg.type]"
          >
            [{{ msg.time }}] {{ msg.text }}
          </div>
        </div>
      </div>

      <div class="flash-button-row">
        <button class="flash-btn-secondary" @click="closeFirmwareFlasher">Cancel</button>
        <button
          class="flash-btn-primary"
          @click="startFirmwareFlash"
          :disabled="firmwareFlashState.isFlashing || !firmwareFlashState.selectedPort || !firmwareFlashState.hexContent"
        >
          {{ firmwareFlashState.isFlashing ? 'Flashing...' : 'Flash Firmware' }}
        </button>
      </div>
    </div>
  </Dialog>
  </template>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, watchEffect, onMounted, onUnmounted, nextTick } from 'vue';
import AppShell from './shell/AppShell.vue';
import TopToolbar from './shell/TopToolbar.vue';
import GCodeVisualizer from './features/toolpath/GCodeVisualizer.vue';
import RightPanel from './shell/RightPanel.vue';
import MobileView from './features/mobile/MobileView.vue';
import UtilityBar from './components/UtilityBar.vue';
import Dialog from './components/Dialog.vue';
import ConfirmPanel from './components/ConfirmPanel.vue';
import PluginDialog from './components/PluginDialog.vue';
import ModalDialog from './components/ModalDialog.vue';
import ToggleSwitch from './components/ToggleSwitch.vue';
import UpdateDialog from './components/UpdateDialog.vue';
import { api } from './lib/api.js';
import { getApiBaseUrl } from './lib/api-base';
import { getSettings } from './lib/settings-store.js';
import { useAppStore } from './composables/use-app-store';
import { useUpdateCenter } from './composables/use-update-center';
import ControlsTab from './features/controls/ControlsTab.vue';
import PluginsTab from './features/plugins/PluginsTab.vue';
import ToolsTab from './features/tools/ToolsTab.vue';
import LogsTab from './features/logs/LogsTab.vue';
import { keyBindingStore } from './features/controls';
import { initDebugLogger, setDebugEnabled } from './lib/debug-logger';

// Get centralized store
const store = useAppStore();

const updateCenter = useUpdateCenter();
const updateState = updateCenter.state;
updateCenter.ensureListeners();

// Detect mobile view from URL query parameter OR screen size
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024);
const windowHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 768);

const isMobileView = computed(() => {
  if (typeof window === 'undefined') return false;

  // Check if mobile=true query parameter is set
  const params = new URLSearchParams(window.location.search);
  if (params.get('mobile') === 'true') return true;

  // Auto-detect mobile based on screen dimensions
  // A device is considered mobile if EITHER dimension is <= 600px
  // This catches phones in both portrait and landscape orientations
  // Portrait: width 375px, height 667px -> width <= 600 ✓
  // Landscape: width 667px, height 375px -> height <= 600 ✓
  const isMobileDevice = windowWidth.value <= 600 || windowHeight.value <= 600;

  return isMobileDevice;
});

// Update window dimensions on resize
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    windowWidth.value = window.innerWidth;
    windowHeight.value = window.innerHeight;
  });
}

// Initialize settings from settings store (loaded in main.ts)
const initialSettings = getSettings();

// Initialize debug logger from settings
initDebugLogger();

// LOCAL UI STATE (not synchronized across clients)
const theme = ref<'light' | 'dark'>(initialSettings?.theme || 'dark');
const workspace = ref(initialSettings?.workspace || 'G54');
const viewport = ref<'top' | 'front' | 'iso'>(initialSettings?.defaultGcodeView || 'top');
const defaultView = ref<'top' | 'front' | 'iso'>(initialSettings?.defaultGcodeView || 'top');
const showSettings = ref(false);
const showSetupDialog = ref(false);
const showWorkspaceMismatchDialog = ref(false);
const detectedWorkspace = ref<string>('');
let isInitialThemeLoad = true;
const showUpdateDialog = ref(false);

// Plugin modal dialog state
const showPluginModal = ref(false);
const pluginModalContent = ref('');
const pluginModalClosable = ref(true);

// Firmware flasher dialog state
const showFirmwareFlasher = ref(false);
const firmwareFlashPorts = ref<Array<{ path: string; manufacturer?: string }>>([]);
const flashMessagesRef = ref<HTMLElement | null>(null);
const firmwareFlashState = ref({
  isFlashing: false,
  progress: 0,
  total: 0,
  status: 'idle', // idle, flashing, success, error
  messages: [] as Array<{ type: string; text: string; time: string }>,
  hexContent: null as string | null,
  hexFileName: '',
  selectedPort: ''
});

const fetchFlashPorts = async () => {
  try {
    const response = await fetch('/api/serial-ports');
    if (response.ok) {
      const data = await response.json();
      // Filter out debug serial ports
      const filtered = (data || []).filter((port: { path: string; manufacturer?: string }) => {
        const pathLower = port.path.toLowerCase();
        const manufacturerLower = (port.manufacturer || '').toLowerCase();
        // Exclude debug ports (common patterns: cu.debug, tty.debug, CMSIS-DAP, etc.)
        return !pathLower.includes('debug') && !manufacturerLower.includes('debug') && !manufacturerLower.includes('cmsis');
      });
      firmwareFlashPorts.value = filtered;

      // Auto-select if only one port available
      if (filtered.length === 1 && !firmwareFlashState.value.selectedPort) {
        firmwareFlashState.value.selectedPort = filtered[0].path;
      }
    }
  } catch (error) {
    console.error('Failed to fetch serial ports:', error);
  }
};

const openFirmwareFlasher = async () => {
  firmwareFlashState.value = {
    isFlashing: false,
    progress: 0,
    total: 0,
    status: 'idle',
    messages: [{ type: 'info', text: 'Ready to flash firmware...', time: new Date().toLocaleTimeString() }],
    hexContent: null,
    hexFileName: '',
    selectedPort: ''
  };
  showFirmwareFlasher.value = true;
  await fetchFlashPorts();
};

const closeFirmwareFlasher = () => {
  if (firmwareFlashState.value.isFlashing) {
    if (!confirm('Flashing is in progress. Are you sure you want to close?')) {
      return;
    }
  }
  showFirmwareFlasher.value = false;
};

const addFlashMessage = (type: string, text: string) => {
  firmwareFlashState.value.messages.push({
    type,
    text,
    time: new Date().toLocaleTimeString()
  });
  // Auto-scroll to bottom
  nextTick(() => {
    if (flashMessagesRef.value) {
      flashMessagesRef.value.scrollTop = flashMessagesRef.value.scrollHeight;
    }
  });
};

const handleHexFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) {
    firmwareFlashState.value.hexContent = null;
    firmwareFlashState.value.hexFileName = '';
    return;
  }

  if (!file.name.endsWith('.hex')) {
    addFlashMessage('error', 'Please select a .hex file');
    target.value = '';
    firmwareFlashState.value.hexFileName = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    firmwareFlashState.value.hexContent = e.target?.result as string;
    firmwareFlashState.value.hexFileName = file.name;
    addFlashMessage('info', `File loaded: ${file.name}`);
  };
  reader.readAsText(file);
};

const startFirmwareFlash = async () => {
  const { selectedPort, hexContent } = firmwareFlashState.value;

  if (!selectedPort) {
    addFlashMessage('error', 'Please select a port');
    return;
  }

  if (!hexContent) {
    addFlashMessage('error', 'Please select a firmware file');
    return;
  }

  firmwareFlashState.value.isFlashing = true;
  firmwareFlashState.value.status = 'flashing';
  addFlashMessage('info', 'Starting firmware flash...');

  try {
    const response = await fetch('/api/firmware/flash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        port: selectedPort,
        hex: hexContent,
        isDFU: selectedPort === 'SLB_DFU'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || error.error || 'Flash failed');
    }

    addFlashMessage('info', 'Flash command sent, waiting for response...');
  } catch (error: any) {
    firmwareFlashState.value.isFlashing = false;
    firmwareFlashState.value.status = 'error';
    addFlashMessage('error', `Flash error: ${error.message}`);
  }
};

const copyFlashMessages = async () => {
  const messages = firmwareFlashState.value.messages
    .map(msg => `[${msg.time}] [${msg.type.toUpperCase()}] ${msg.text}`)
    .join('\n');

  try {
    await navigator.clipboard.writeText(messages);
    addFlashMessage('info', 'Messages copied to clipboard');
  } catch (error) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = messages;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    addFlashMessage('info', 'Messages copied to clipboard');
  }
};

const openUpdateDialog = () => {
  if (!updateState.supported) {
    return;
  }
  updateCenter.clearError();
  showUpdateDialog.value = true;
  if (!updateState.isAvailable && !updateState.isChecking && !updateState.isDownloading) {
    handleManualCheckForUpdates();
  }
};

const closeUpdateDialog = () => {
  showUpdateDialog.value = false;
  updateCenter.clearError();
};

const handleManualCheckForUpdates = async () => {
  try {
    await updateCenter.checkForUpdates();
  } catch (error) {
    console.error('Failed to check for updates:', error);
  }
};

const handleDownloadAndInstallUpdate = async () => {
  try {
    await updateCenter.downloadAndInstall();
  } catch (error) {
    console.error('Failed to download and install update:', error);
  }
};

const handleDownloadUpdateOnly = async () => {
  try {
    await updateCenter.downloadOnly();
  } catch (error) {
    console.error('Failed to download update package:', error);
  }
};

// SHARED STATE FROM STORE (read-only refs from centralized store)
const { serverState, status, consoleLines, websocketConnected, lastAlarmCode, alarmMessage, gridSizeX, gridSizeY, zMaxTravel, machineOrientation, isConnected, senderStatus: senderStatusRef } = store;

const currentSenderStatus = computed(() => senderStatusRef.value ?? serverState.senderStatus ?? 'connecting');

// Jog config (from app store - shared state)
const { jogConfig } = store;

// Fetch alarm description (delegate to store)
const fetchAlarmDescription = store.setLastAlarmCode;

// Handle workspace change from toolbar
const handleWorkspaceChange = async (newWorkspace: string) => {
  try {
    // Optimistically update UI; server will confirm via status update
    workspace.value = newWorkspace;
    await api.sendCommandViaWebSocket({ command: newWorkspace, displayCommand: newWorkspace, meta: { sourceId: 'client' } });
  } catch (error) {
    console.error('Failed to change workspace:', error?.message || error);
  }
};

// Handle workspace auto-switch confirmation
const handleWorkspaceMismatchConfirm = async () => {
  if (detectedWorkspace.value) {
    await handleWorkspaceChange(detectedWorkspace.value);
  }
  showWorkspaceMismatchDialog.value = false;
  detectedWorkspace.value = '';
};

watch(
  () => serverState.machineState?.workspace,
  (newWorkspace) => {
    if (!newWorkspace) return;
    const normalized = String(newWorkspace).toUpperCase();
    if (workspace.value !== normalized) {
      workspace.value = normalized;
    }
  },
  { immediate: true }
);

// Settings tabs configuration
const activeTab = ref('general');
const settingsTabs = [
  { id: 'general', label: 'General', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/></svg>' },
  { id: 'tools', label: 'Tool Library', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8.5 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5M10.329 1.671a.5.5 0 0 1 .707 0l1.414 1.414a.5.5 0 1 1-.707.707L10.329 2.378a.5.5 0 0 1 0-.707M14.5 7a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zM3.5 9a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 0-.5-.5z"/></svg>' },
  { id: 'keyboard', label: 'Controls', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg>' },
  { id: 'firmware', label: 'Firmware', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.496 8a4.5 4.5 0 0 1-1.703 3.526L9.497 8.5l2.959-1.11q.04.3.04.61"/><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-1 0a7 7 0 1 0-13.202 3.249l1.988-1.657a4.5 4.5 0 0 1 7.537-4.623L7.497 6.5l1 2.5 1.333 3.11c-.56.251-1.18.39-1.833.39a4.5 4.5 0 0 1-1.592-.29L4.747 14.2A7 7 0 0 0 15 8m-8.295.139a.25.25 0 0 0-.288-.376l-1.5.5.159.474.808-.27-.595.894a.25.25 0 0 0 .287.376l.808-.27-.595.894a.25.25 0 0 0 .287.376l1.5-.5-.159-.474-.808.27.596-.894a.25.25 0 0 0-.288-.376l-.808.27z"/></svg>' },
  { id: 'plugins', label: 'Plugins', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.545 6.714 4.11 8H3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1.110l.436 1.286A1 1 0 0 0 5.494 13h.557a1 1 0 0 0 .948-.714L7.435 11h1.130l.436 1.286A1 1 0 0 0 9.949 13h.557a1 1 0 0 0 .948-.714L11.89 11H13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1.11l-.436-1.286A1 1 0 0 0 10.506 6h-.557a1 1 0 0 0-.948.714L8.565 8H7.435L7 6.714A1 1 0 0 0 6.052 6h-.557a1 1 0 0 0-.948.714M6.724 9.5 6.27 11h-.48L5.335 9.5h1.389m3.553 0h1.389l-.455 1.5h-.479zm-5 1L4.822 9H3.5v1.5zm9 0V9h-1.323l-.455 1.5z"/></svg>' },
  { id: 'logs', label: 'Logs', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z"/><path d="M4.5 12.5A.5.5 0 0 1 5 12h3a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5m0-2A.5.5 0 0 1 5 10h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5m0-2A.5.5 0 0 1 5 8h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5m0-2A.5.5 0 0 1 5 6h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5m0-2A.5.5 0 0 1 5 4h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5"/></svg>' }
];


// Immediately reflect Default G-Code Preview changes in the live viewport
watch(defaultView, (newView) => {
  viewport.value = newView;
});

watch(
  () => senderStatusRef.value,
  async (newStatus, oldStatus) => {
    if (newStatus === 'setup-required' && !showSetupDialog.value) {
      showSetupDialog.value = true;
      await loadSetupUsbPorts();
    } else if (oldStatus === 'setup-required' && newStatus !== 'setup-required' && showSetupDialog.value) {
      showSetupDialog.value = false;
    }
  }
);

// Color customization (from settings store)
const accentColor = ref(initialSettings?.accentColor || '#1abc9c');
const gradientColor = ref(initialSettings?.gradientColor || '#34d399');

const currentGradient = computed(() => {
  return `linear-gradient(135deg, ${accentColor.value} 0%, ${gradientColor.value} 100%)`;
});

// Tool settings
const toolCount = ref(initialSettings?.tool?.count ?? 0);
const toolSource = ref(initialSettings?.tool?.source ?? null);
const toolCountDisabled = computed(() => toolSource.value !== null);
const showManualButton = ref(initialSettings?.tool?.manual ?? true);
const showTLSButton = ref(initialSettings?.tool?.tls ?? true);
const showProbeButton = ref(initialSettings?.tool?.probe ?? false);
const loadedPlugins = ref<Array<{ id: string; name: string }>>([]);

// Computed property to get the friendly plugin name from toolSource
const toolSourceName = computed(() => {
  if (!toolSource.value) return null;
  const plugin = loadedPlugins.value.find(p => p.id === toolSource.value);
  return plugin?.name || toolSource.value;
});

// Use Door as Pause setting
const useDoorAsPause = ref(initialSettings?.useDoorAsPause ?? false);

// Home Location setting
const homeLocation = ref(initialSettings?.homeLocation ?? 'back-left');

// Units preference setting
const unitsPreference = ref(initialSettings?.unitsPreference ?? 'metric');
const showUnitsConfirmDialog = ref(false);
const pendingUnitsChange = ref<'metric' | 'imperial' | null>(null);

// Connection settings (from settings store)
const initialConnection = initialSettings?.connection;
const initialBaudRate = initialConnection?.baudRate ?? 115200;
const connectionSettings = reactive({
  type: initialConnection?.type === 'ethernet' ? 'Ethernet' : 'USB',
  baudRate: initialBaudRate.toString(),
  ipAddress: initialConnection?.ip || '192.168.5.1',
  port: initialConnection?.port ?? 23,
  serverPort: initialConnection?.serverPort ?? 8090,
  usbPort: initialConnection?.usbPort || ''
});

// Setup dialog connection settings (separate from main settings)
const setupSettings = reactive({
  type: 'USB',
  baudRate: '115200',
  ipAddress: '192.168.5.1',
  port: 23,
  usbPort: '',
  homeLocation: 'back-left'
});

// Console settings
const consoleSettings = reactive({
  autoClearConsole: initialSettings?.autoClearConsole ?? true,
  debugLogging: initialSettings?.debugLogging ?? false
});

// Stop deceleration delay (pause before soft reset)
const pauseBeforeStop = ref(initialSettings?.pauseBeforeStop ?? 500);

// Helper function to compute OFF command based on ON command
const getOffCommand = (onCommand: string): string => {
  if (!onCommand) return '';
  if (onCommand === 'M7' || onCommand === 'M8') return 'M9';
  // M64 P<n> -> M65 P<n>
  const m64Match = onCommand.match(/M64\s+(P\d+)/i);
  if (m64Match) {
    return `M65 ${m64Match[1]}`;
  }
  return '';
};

// Auxiliary Outputs settings (formerly I/O Switches)
// Convert old format to new array format for backward compatibility
const loadAuxOutputs = () => {
  const saved = initialSettings?.auxOutputs;
  if (Array.isArray(saved) && saved.length > 0) {
    return saved.map((item, index) => ({
      id: item.id || `aux-${index}`,
      enabled: item.enabled ?? true,
      name: item.name || `Output ${index + 1}`,
      on: item.on || 'M8'
    }));
  }
  // Migrate from old ioSwitches format
  const oldFormat = initialSettings?.ioSwitches;
  if (oldFormat) {
    const outputs = [];
    if (oldFormat.flood) {
      outputs.push({
        id: 'flood',
        enabled: oldFormat.flood.enabled ?? true,
        name: oldFormat.flood.name || 'Flood',
        on: oldFormat.flood.on || 'M8'
      });
    }
    if (oldFormat.mist) {
      outputs.push({
        id: 'mist',
        enabled: oldFormat.mist.enabled ?? true,
        name: oldFormat.mist.name || 'Mist',
        on: oldFormat.mist.on || 'M7'
      });
    }
    if (outputs.length > 0) return outputs;
  }
  // Default outputs
  return [
    { id: 'flood', enabled: true, name: 'Flood', on: 'M8' },
    { id: 'mist', enabled: true, name: 'Mist', on: 'M7' }
  ];
};

const auxOutputs = reactive(loadAuxOutputs());

// Auxiliary Output inline edit state
const editingAuxIndex = ref<number | null>(null);
const auxEditState = reactive({
  name: '',
  on: ''
});

const availableOnCommands = computed(() => {
  const commands = [
    { value: 'M8', label: 'M8' },
    { value: 'M7', label: 'M7' }
  ];
  const outputPins = store.status.outputPins || 0;
  for (let i = 0; i < outputPins; i++) {
    commands.push({ value: `M64 P${i}`, label: `M64 P${i}` });
  }
  return commands;
});

const startAuxEdit = (index: number) => {
  editingAuxIndex.value = index;
  auxEditState.name = auxOutputs[index].name;
  auxEditState.on = auxOutputs[index].on;
};

const cancelAuxEdit = () => {
  editingAuxIndex.value = null;
};

const saveAuxOutputs = async () => {
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    auxOutputs: auxOutputs.map(o => ({
      id: o.id,
      enabled: o.enabled,
      name: o.name,
      on: o.on
    }))
  });
};

const saveAuxEdit = async () => {
  const index = editingAuxIndex.value;
  if (index === null) return;

  auxOutputs[index].name = auxEditState.name.trim() || `Output ${index + 1}`;
  auxOutputs[index].on = auxEditState.on;

  await saveAuxOutputs();
  editingAuxIndex.value = null;
};

const addAuxOutput = async () => {
  const newId = `aux-${Date.now()}`;
  auxOutputs.push({
    id: newId,
    enabled: true,
    name: `Output ${auxOutputs.length + 1}`,
    on: 'M8'
  });
  await saveAuxOutputs();
  // Start editing the new output
  startAuxEdit(auxOutputs.length - 1);
};

const deleteAuxOutput = async (index: number) => {
  auxOutputs.splice(index, 1);
  await saveAuxOutputs();
};

// Firmware settings
const firmwareData = ref(null);
const isFirmwareLoading = ref(false);
const firmwareError = ref(null);
const firmwareSearchQuery = ref('');
const firmwareChanges = ref({}); // Track pending changes: { settingId: newValue }
const importSummary = ref(null); // { changed: number, total: number }

const AXIS_BIT_LABELS = ['X', 'Y', 'Z', 'A', 'B', 'C', 'U', 'V', 'W'];
const axisCount = computed(() => {
  const settings = firmwareData.value?.settings;
  if (!settings) return 0;

  let detected = 0;
  AXIS_BIT_LABELS.forEach((_, index) => {
    const settingId = (130 + index).toString();
    if (settings[settingId] !== undefined) {
      detected = index + 1;
    }
  });

  return detected;
});

// USB ports
const availableUsbPorts = ref([]);
const setupUsbPorts = ref([]);

// IP validation
const isValidIP = ref(true);
const isValidSetupIP = ref(true);

// Setup validation
const setupValidation = reactive({
  usbPort: true,
  ipAddress: true,
  port: true
});

// Main settings validation
const mainValidation = reactive({
  usbPort: true,
  ipAddress: true,
  port: true
});

// Custom dropdown states
const setupUsbDropdownOpen = ref(false);
const mainUsbDropdownOpen = ref(false);

// Load available USB ports
const loadUsbPorts = async () => {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/usb-ports`);
    if (response.ok) {
      const ports = await response.json();
      return ports;
    }
  } catch (error) {
    console.error('Error loading USB ports:', error);
  }
  return [];
};

const loadMainUsbPorts = async () => {
  availableUsbPorts.value = await loadUsbPorts();

  // Trigger validation when connection type changes
  validateMainForm();
};

const loadSetupUsbPorts = async () => {
  setupUsbPorts.value = await loadUsbPorts();
};

// Custom dropdown functions
const selectSetupUsbPort = (port) => {
  setupSettings.usbPort = port.path;
  setupUsbDropdownOpen.value = false;
  // Trigger validation
  validateSetupForm();
};

const selectMainUsbPort = (port) => {
  connectionSettings.usbPort = port.path;
  mainUsbDropdownOpen.value = false;

  // Validate USB port selection
  if (connectionSettings.type === 'USB') {
    mainValidation.usbPort = !!connectionSettings.usbPort;
  }
};

const getSelectedSetupPortDisplay = () => {
  if (!setupSettings.usbPort) return 'Select USB Port...';
  const port = setupUsbPorts.value.find(p => p.path === setupSettings.usbPort);
  return port ? port.path : setupSettings.usbPort;
};

const getSelectedMainPortDisplay = () => {
  if (!connectionSettings.usbPort) return 'Select USB Port...';
  const port = availableUsbPorts.value.find(p => p.path === connectionSettings.usbPort);
  return port ? port.path : connectionSettings.usbPort;
};

// Close dropdowns when clicking outside
const handleClickOutside = (event) => {
  const target = event.target;
  if (!target.closest('.custom-dropdown')) {
    setupUsbDropdownOpen.value = false;
    mainUsbDropdownOpen.value = false;
  }
};

// Add click outside listener
onMounted(() => {
  document.addEventListener('click', handleClickOutside);

  window.addEventListener('message', (event) => {
    if (event.data.type === 'show-modal') {
      showPluginModal.value = true;
      pluginModalContent.value = event.data.content;
      pluginModalClosable.value = event.data.closable !== false;
    } else if (event.data.type === 'close-modal') {
      showPluginModal.value = false;
    } else if (event.data.type === 'send-command') {
      api.sendCommandViaWebSocket({
        command: event.data.command,
        displayCommand: event.data.displayCommand
      });
    }
  });

  api.on('plugin:show-modal', (data: any) => {
    showPluginModal.value = true;
    pluginModalContent.value = data.content;
    pluginModalClosable.value = data.closable !== false;
  });

  // Listen for $NCSENDER_CLEAR_MSG command result to close modal on all clients
  api.on('cnc-command-result', (data: any) => {
    if (data.command === '$NCSENDER_CLEAR_MSG' && data.status === 'success') {
      showPluginModal.value = false;
    }
  });

  // Listen for firmware flash events
  api.on('flash:progress', (data: { value: number; total: number }) => {
    firmwareFlashState.value.progress = data.value;
    firmwareFlashState.value.total = data.total;
  });

  api.on('flash:message', (data: { type: string; content: string }) => {
    addFlashMessage(data.type?.toLowerCase() || 'info', data.content);
  });

  api.on('flash:end', () => {
    firmwareFlashState.value.isFlashing = false;
    firmwareFlashState.value.status = 'success';
    firmwareFlashState.value.progress = firmwareFlashState.value.total;
    addFlashMessage('success', 'Firmware flash completed! Please reconnect your device.');
  });

  api.on('flash:error', (data: { error: string }) => {
    firmwareFlashState.value.isFlashing = false;
    firmwareFlashState.value.status = 'error';
    addFlashMessage('error', `Flash error: ${data.error || 'Unknown error'}`);
  });

  // Check if there's a persisted modal in settings and restore it
  const settings = getSettings();
  if (settings?.pluginMessage?.modalPayload) {
    showPluginModal.value = true;
    pluginModalContent.value = settings.pluginMessage.modalPayload.content;
    pluginModalClosable.value = settings.pluginMessage.modalPayload.closable !== false;
  }

  window.addEventListener('settings-changed', (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    if (detail?.jog) {
      if (typeof detail.jog.stepSize === 'number') {
        jogConfig.stepSize = detail.jog.stepSize;
      }
      if (typeof detail.jog.feedRate === 'number') {
        jogConfig.feedRate = detail.jog.feedRate;
      }
    }
    // Update debug logging state when settings change
    if (typeof detail?.debugLogging === 'boolean') {
      setDebugEnabled(detail.debugLogging);
    }
    // Update tool settings when changed
    if (detail?.tool) {
      if (typeof detail.tool.count === 'number') {
        toolCount.value = detail.tool.count;
      }
      if (detail.tool.source !== undefined) {
        toolSource.value = detail.tool.source;
      }
    }
  });
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

const openSettings = async () => {
  showSettings.value = true;

  // Reload settings from backend
  try {
    // Refresh the settings store so all components get the latest settings
    const { loadSettings } = await import('./lib/settings-store.js');
    await loadSettings();

    const freshSettings = await api.getSettings();
    if (freshSettings && freshSettings.connection) {
      // Update connection settings with fresh data from nested connection object
      const conn = freshSettings.connection;
      connectionSettings.type = conn.type === 'usb' ? 'USB' : 'Ethernet';
      connectionSettings.baudRate = conn.baudRate?.toString() || '115200';
      connectionSettings.ipAddress = conn.ip || '192.168.5.1';
      connectionSettings.port = conn.port || 23;
      connectionSettings.serverPort = conn.serverPort || 8090;
      connectionSettings.usbPort = conn.usbPort || '';
    }
  } catch (error) {
    console.error('Failed to reload settings:', error);
  }

  // Load USB ports if connection type is USB
  if (connectionSettings.type === 'USB') {
    await loadMainUsbPorts();
  }
};

const closeSettings = () => {
  // Clear any pending firmware changes
  clearFirmwareChanges();
  // Close the dialog
  showSettings.value = false;
};

const loadFirmwareData = async (forceRefresh = false) => {
  try {
    isFirmwareLoading.value = true;
    firmwareError.value = null;

    // GET endpoint now handles everything: checks file, queries controller if needed
    const data = await api.getFirmwareSettings(forceRefresh);
    firmwareData.value = data;
  } catch (error) {
    console.error('Error loading firmware data:', error);
    firmwareError.value = error.message;
  } finally {
    isFirmwareLoading.value = false;
  }
};

// Load firmware data when firmware tab is opened
watch(activeTab, (newTab) => {
  if (newTab === 'firmware' && !firmwareData.value && !isFirmwareLoading.value) {
    loadFirmwareData();
  }

  // Reload keyboard bindings when keyboard tab is opened (to pick up new macros)
  if (newTab === 'keyboard') {
    keyBindingStore.reload();
  }
});

// Check if there are pending firmware changes
const hasFirmwareChanges = computed(() => {
  return Object.keys(firmwareChanges.value).length > 0;
});

// Computed property to filter firmware settings based on search query
const filteredFirmwareSettings = computed(() => {
  if (!firmwareData.value || !firmwareData.value.settings) {
    return [];
  }

  const settings = Object.values(firmwareData.value.settings)
    .map((setting) => ({
      ...setting,
      id: setting.id.toString()
    }))
    .filter((setting) => {
      // Skip settings with dataType 7 (bitfield) that don't have a format
      // These show as raw bitwise values which are not useful
      if (setting.dataType === 7 && !setting.format) {
        return false;
      }

      // Skip bitfield settings where all bits are N/A
      if (setting.format && typeof setting.format === 'string') {
        const bits = setting.format.split(',').map(b => b.trim());
        const allNA = bits.every(bit => bit === 'N/A' || bit === '');
        if (allNA) {
          return false;
        }
      }

      return true;
    });

  if (!firmwareSearchQuery.value) {
    return settings.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  }

  const query = firmwareSearchQuery.value.toLowerCase();
  return settings.filter((setting) => {
    return (
      setting.id.includes(query) ||
      setting.name && setting.name.toLowerCase().includes(query) ||
      setting.group && setting.group.name && setting.group.name.toLowerCase().includes(query)
    );
  }).sort((a, b) => parseInt(a.id) - parseInt(b.id));
});

const getHalDetail = (setting: any, index: number): string | undefined => {
  if (!setting || !Array.isArray(setting.halDetails)) {
    return undefined;
  }

  const value = setting.halDetails[index];
  return typeof value === 'string' ? value : undefined;
};

const isNamedBitfield = (setting: any): boolean => {
  if (!setting || !setting.format) {
    return false;
  }

  const halType = getHalDetail(setting, 2)?.toLowerCase();
  return (halType && halType.includes('bitfield')) || setting.dataType === 2;
};

const isRadioSetting = (setting: any): boolean => {
  if (!setting || setting.dataType !== 3) {
    return false;
  }

  if (typeof setting.format !== 'string') {
    return false;
  }

  const options = setting.format
    .split(',')
    .map(option => option.trim())
    .filter(Boolean);

  return options.length > 0;
};

const getRadioOptions = (setting: any): Array<{ label: string; value: string }> => {
  if (!setting || typeof setting.format !== 'string') {
    return [];
  }

  return setting.format
    .split(',')
    .map(option => option.trim())
    .filter(Boolean)
    .map((label, index) => ({ label, value: index.toString() }));
};

const isAxisBitfield = (setting: any): boolean => {
  if (!setting) {
    return false;
  }

  const halType = getHalDetail(setting, 2)?.toLowerCase();
  const halGroup = getHalDetail(setting, 3)?.toLowerCase();
  const hasFormat = typeof setting.format === 'string' && setting.format.trim().length > 0;

  return halType === 'bitfield' && !hasFormat && (halGroup === 'axes' || halGroup === 'axis');
};

const getAxisBitLabels = (setting: any): string[] => {
  const changeValue = firmwareChanges.value[setting?.id];
  const valuesToInspect = [changeValue, setting?.value, setting?.max];
  let maxValue = 0;

  for (const raw of valuesToInspect) {
    const parsed = typeof raw === 'string' ? parseInt(raw, 10)
      : typeof raw === 'number' ? raw
        : NaN;

    if (!Number.isNaN(parsed) && parsed > maxValue) {
      maxValue = parsed;
    }
  }

  let bitLength = 0;
  while ((maxValue >> bitLength) > 0) {
    bitLength += 1;
  }

  const inferredAxisCount = axisCount.value > 0 ? axisCount.value : 4;
  const finalCount = Math.min(
    AXIS_BIT_LABELS.length,
    Math.max(bitLength, inferredAxisCount)
  );

  return AXIS_BIT_LABELS.slice(0, finalCount);
};

// Helper function to check if a bit is set
const isBitSet = (value: string | number, bitIndex: number): boolean => {
  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;
  return ((numValue >> bitIndex) & 1) === 1;
};

// Function to toggle a bit in a bitfield setting
const toggleBit = (setting: any, bitIndex: number) => {
  // Get current value (either from pending changes or original value)
  const currentValue = firmwareChanges.value[setting.id] !== undefined
    ? firmwareChanges.value[setting.id]
    : (typeof setting.value === 'string' ? parseInt(setting.value, 10) : (setting.value || 0));

  const newValue = currentValue ^ (1 << bitIndex); // XOR to toggle the bit

  // Track the change
  firmwareChanges.value[setting.id] = newValue;
};

const getBooleanSettingValue = (setting: any): boolean => {
  const pendingValue = firmwareChanges.value[setting?.id];
  const source = pendingValue !== undefined
    ? pendingValue
    : setting?.value;

  if (typeof source === 'boolean') {
    return source;
  }

  if (typeof source === 'number') {
    return source !== 0;
  }

  if (typeof source === 'string') {
    return source === '1' || source.toLowerCase() === 'true';
  }

  return false;
};

const updateBooleanSetting = (setting: any, enabled: boolean) => {
  const numericValue = enabled ? 1 : 0;
  const originalNumeric = (() => {
    if (typeof setting?.value === 'number') {
      return setting.value;
    }
    if (typeof setting?.value === 'string') {
      const parsed = parseInt(setting.value, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  })();

  if (numericValue === originalNumeric) {
    delete firmwareChanges.value[setting.id];
    return;
  }

  firmwareChanges.value[setting.id] = numericValue;
};

// Function to track numeric setting changes (dataTypes 1-6: integers and float)
const updateNumericSetting = (setting: any, newValue: string) => {
  // Skip if value hasn't changed from original
  if (newValue === setting.value) {
    // Remove from changes if it matches original
    delete firmwareChanges.value[setting.id];
    return;
  }

  // Parse and validate numeric value
  // DataType 6 = float, others (1,3,4,5) are integers
  const numValue = setting.dataType === 6 ? parseFloat(newValue) : parseInt(newValue, 10);

  if (isNaN(numValue)) {
    console.error('Invalid numeric value');
    return;
  }

  // Validate min/max
  // Check halDetails[8] flag: if '1', allow empty/zero even with min value set
  const allowZero = setting.halDetails && setting.halDetails[8] === '1';

  const min = setting.min ? parseFloat(setting.min) : -Infinity;
  const max = setting.max ? parseFloat(setting.max) : Infinity;

  if (allowZero && numValue === 0) {
    // 0 is valid when halDetails[8] = '1' (typically means disabled/unlimited)
  } else if (numValue < min || numValue > max) {
    console.error(`Value must be between ${min} and ${max}${allowZero ? ' (or 0)' : ''}`);
    return;
  }

  // Track the change
  firmwareChanges.value[setting.id] = numValue;
};

const updateStringSetting = (setting: any, newValue: string) => {
  // Skip if value hasn't changed from original
  if (newValue === setting.value) {
    // Remove from changes if it matches original
    delete firmwareChanges.value[setting.id];
    return;
  }

  // Validate min/max length
  const minLength = setting.min ? parseInt(setting.min) : 0;
  const maxLength = setting.max ? parseInt(setting.max) : Infinity;

  if (newValue.length < minLength || newValue.length > maxLength) {
    console.error(`String length must be between ${minLength} and ${maxLength}`);
    return;
  }

  // Track the change
  firmwareChanges.value[setting.id] = newValue;
};

// Update MAC address setting (dataType 7 with format "x(17)")
const updateMacAddress = (setting: any, newValue: string) => {
  // Skip if value hasn't changed from original
  if (newValue === setting.value) {
    // Remove from changes if it matches original
    delete firmwareChanges.value[setting.id];
    return;
  }

  // Validate max length (max value represents max character length for dataType 7)
  const maxLength = setting.max ? parseInt(setting.max) : 17;
  if (newValue.length > maxLength) {
    console.error(`MAC address length cannot exceed ${maxLength} characters`);
    alert(`MAC address length cannot exceed ${maxLength} characters`);
    return;
  }

  // Validate MAC address format (XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX)
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

  if (!macRegex.test(newValue)) {
    console.error('Invalid MAC address format. Expected XX:XX:XX:XX:XX:XX');
    alert('Invalid MAC address format. Please use format: XX:XX:XX:XX:XX:XX');
    return;
  }

  // Track the change
  firmwareChanges.value[setting.id] = newValue;
};

// Update G-code string setting (dataType 7 with format "x(127)" or similar)
const updateGcodeString = (setting: any, newValue: string) => {
  // Skip if value hasn't changed from original
  if (newValue === setting.value) {
    // Remove from changes if it matches original
    delete firmwareChanges.value[setting.id];
    return;
  }

  // Validate max length (max value represents max character length for dataType 7)
  const maxLength = setting.max ? parseInt(setting.max) : Infinity;
  if (newValue.length > maxLength) {
    console.error(`G-code string length cannot exceed ${maxLength} characters`);
    alert(`G-code string length cannot exceed ${maxLength} characters`);
    return;
  }

  // Basic validation: ensure it contains valid G-code characters
  // Allow: letters, numbers, spaces, pipes (|), dots (.), minus (-), and other common G-code characters
  const validGcodeRegex = /^[A-Za-z0-9\s|.\-;:()$#*+=\[\]]*$/;

  if (!validGcodeRegex.test(newValue)) {
    console.error('Invalid G-code string. Contains invalid characters.');
    alert('Invalid G-code string. Please use valid G-code characters and | as separator for multiple commands.');
    return;
  }

  // Track the change
  firmwareChanges.value[setting.id] = newValue;
};

// Update IP address setting (dataType 9)
const updateIpAddress = (setting: any, newValue: string) => {
  // Skip if value hasn't changed from original
  if (newValue === setting.value) {
    // Remove from changes if it matches original
    delete firmwareChanges.value[setting.id];
    return;
  }

  // Validate IPv4 address format (0-255.0-255.0-255.0-255)
  const ipRegex = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  if (!ipRegex.test(newValue)) {
    console.error('Invalid IP address format. Expected format: XXX.XXX.XXX.XXX (0-255 for each octet)');
    alert('Invalid IP address format. Please use format: XXX.XXX.XXX.XXX (e.g., 192.168.1.1)');
    return;
  }

  // Track the change
  firmwareChanges.value[setting.id] = newValue;
};

// Submit all pending firmware changes
const submitFirmwareChanges = async () => {
  if (!hasFirmwareChanges.value) {
    return;
  }

  try {
    // Send each change as a $<id>=<value> command
    for (const [settingId, newValue] of Object.entries(firmwareChanges.value)) {
      await api.sendCommand(`$${settingId}=${newValue}`, { meta: { sourceId: 'client' } });

      // Update the local value in firmwareData
      if (firmwareData.value.settings[settingId]) {
        firmwareData.value.settings[settingId].value = newValue.toString();
      }
    }

    // Clear changes and import summary after successful submission
    firmwareChanges.value = {};
    importSummary.value = null;

    console.log('Firmware settings updated successfully');
  } catch (error) {
    console.error('Error submitting firmware changes:', error);
    alert('Failed to update firmware settings: ' + error.message);
  }
};

// Clear/abandon pending firmware changes
const clearFirmwareChanges = () => {
  firmwareChanges.value = {};
  importSummary.value = null;
};

// Export firmware settings to GRBL text format
const exportFirmwareSettings = () => {
  if (!firmwareData.value) {
    return;
  }

  // Create text content with $<id>=<value> format, one per line
  const lines = [];
  for (const [id, setting] of Object.entries(firmwareData.value.settings)) {
    lines.push(`$${id}=${setting.value}`);
  }

  const textContent = lines.join('\n');
  const blob = new Blob([textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `firmware-settings-${new Date().toISOString().split('T')[0]}.grbl`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Import firmware settings from JSON or GRBL text format
const importFirmwareSettings = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.grbl,.txt';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let importedSettings = {};

      // Auto-detect format: try JSON first, then fallback to GRBL text format
      try {
        // Try parsing as JSON
        importedSettings = JSON.parse(text);
      } catch (jsonError) {
        // Not JSON, parse as GRBL text format ($<id>=<value>)
        const lines = text.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip empty lines and comments
          if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
            continue;
          }

          // Match $<id>=<value> format
          const match = trimmed.match(/^\$(\d+)\s*=\s*(.+)$/);
          if (match) {
            const id = match[1];
            const value = match[2].trim();
            importedSettings[id] = value;
          }
        }

        // If no valid settings were parsed, throw error
        if (Object.keys(importedSettings).length === 0) {
          throw new Error('No valid settings found in file. Expected format: $1=value or JSON');
        }
      }

      // Track only changes that differ from current values
      let changesCount = 0;
      for (const [id, value] of Object.entries(importedSettings)) {
        if (firmwareData.value.settings[id]) {
          const currentValue = firmwareData.value.settings[id].value;
          // Only track if the value is different
          if (String(value) !== String(currentValue)) {
            firmwareChanges.value[id] = value;
            changesCount++;
          }
        }
      }

      // Show summary in footer
      importSummary.value = {
        changed: changesCount,
        total: Object.keys(importedSettings).length
      };
    } catch (error) {
      console.error('Error importing settings:', error);
      alert('Failed to import settings: ' + error.message);
    }
  };

  input.click();
};

const updateAccentColor = (color: string) => {
  accentColor.value = color;
  applyColors();
};

const updateGradientColor = (color: string) => {
  gradientColor.value = color;
  applyColors();
};

const applyColors = () => {
  const root = document.documentElement;
  root.style.setProperty('--color-accent', accentColor.value);
  root.style.setProperty('--gradient-accent', currentGradient.value);
  // Notify listeners (e.g., 3D viewport) that accent color changed
  try {
    window.dispatchEvent(new CustomEvent('accent-color-change', { detail: { color: accentColor.value } }));
  } catch {}
};

const saveColors = async () => {
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    accentColor: accentColor.value,
    gradientColor: gradientColor.value
  });
};

const resetColors = async () => {
  const defaultAccent = '#1abc9c';
  const defaultGradient = '#34d399';

  accentColor.value = defaultAccent;
  gradientColor.value = defaultGradient;
  applyColors();

  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    accentColor: defaultAccent,
    gradientColor: defaultGradient
  });
};

// Watch toolCount and save changes (server will broadcast to all clients)
// Only allow changes if not controlled by a plugin
watch(toolCount, async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    tool: {
      count: newValue,
      source: null
    }
  });
  // Note: No local update here - wait for server broadcast to ensure all clients update together
});

// Watch showManualButton and save changes
watch(showManualButton, async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    tool: {
      manual: newValue
    }
  });
});

// Watch showTLSButton and save changes
watch(showTLSButton, async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    tool: {
      tls: newValue
    }
  });
});

// Watch showProbeButton and save changes
watch(showProbeButton, async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    tool: {
      probe: newValue
    }
  });
});

// Event handlers for Tools tab controls
const handleToolCountUpdate = async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  toolCount.value = newValue;
};

const handleShowManualButtonUpdate = async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  showManualButton.value = newValue;
};

const handleShowTLSButtonUpdate = async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  showTLSButton.value = newValue;
};

const handleShowProbeButtonUpdate = async (newValue) => {
  if (toolSource.value !== null) {
    return;
  }
  showProbeButton.value = newValue;
};

// Watch useDoorAsPause and save changes
watch(useDoorAsPause, async (newValue) => {
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    useDoorAsPause: newValue
  });
});

// Save home location changes
const saveHomeLocation = async () => {
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    homeLocation: homeLocation.value
  });
};

// Save pause before stop setting
const savePauseBeforeStop = async () => {
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    pauseBeforeStop: Number(pauseBeforeStop.value)
  });
};

// Watch debugLogging and save changes
watch(() => consoleSettings.debugLogging, async (newValue) => {
  const { updateSettings } = await import('./lib/settings-store.js');
  setDebugEnabled(newValue);
  await updateSettings({
    debugLogging: newValue
  });
});

// Set units preference
const setUnits = async (units) => {
  pendingUnitsChange.value = units;
  showUnitsConfirmDialog.value = true;
};

const confirmUnitsChange = async () => {
  const units = pendingUnitsChange.value;
  if (!units) return;

  unitsPreference.value = units;
  const { updateSettings } = await import('./lib/settings-store.js');
  await updateSettings({
    unitsPreference: units
  });

  // Send G20 (imperial) or G21 (metric) command to controller
  const gcode = units === 'imperial' ? 'G20' : 'G21';
  const displayCommand = units === 'imperial' ? 'G20 (Switching to imperial)' : 'G21 (Switching to metric)';
  try {
    await api.sendCommandViaWebSocket({
      command: gcode,
      displayCommand: displayCommand,
      meta: { sourceId: 'client' }
    });
  } catch (error) {
    console.error('Failed to send unit command to controller:', error);
  }

  showUnitsConfirmDialog.value = false;
  pendingUnitsChange.value = null;
};

const validateIP = () => {
  if (connectionSettings.type === 'USB') {
    isValidIP.value = true;
    return;
  }

  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  isValidIP.value = ipRegex.test(connectionSettings.ipAddress);
};

const validateSetupIP = () => {
  if (setupSettings.type === 'USB') {
    isValidSetupIP.value = true;
    setupValidation.ipAddress = true;
    return;
  }

  const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const isValid = ipRegex.test(setupSettings.ipAddress);
  isValidSetupIP.value = isValid;
  setupValidation.ipAddress = isValid;
};

const validateSetupForm = () => {
  let isValid = true;

  // Validate USB port if USB connection
  if (setupSettings.type === 'USB') {
    setupValidation.usbPort = !!setupSettings.usbPort;
    if (!setupValidation.usbPort) isValid = false;

    // Clear Ethernet validation for USB
    setupValidation.ipAddress = true;
    setupValidation.port = true;
  }

  // Validate Ethernet fields if Ethernet connection
  if (setupSettings.type === 'Ethernet') {
    // Clear USB validation for Ethernet
    setupValidation.usbPort = true;

    // Validate IP
    validateSetupIP();
    if (!setupValidation.ipAddress) isValid = false;

    // Validate port
    setupValidation.port = !!(setupSettings.port && setupSettings.port > 0 && setupSettings.port <= 65535);
    if (!setupValidation.port) isValid = false;
  }

  return isValid;
};

const validateMainPort = () => {
  if (connectionSettings.type === 'USB') {
    mainValidation.port = true;
    return;
  }

  mainValidation.port = !!(connectionSettings.port && connectionSettings.port > 0 && connectionSettings.port <= 65535);
};

const validateMainForm = () => {
  let isValid = true;

  // Validate USB port if USB connection
  if (connectionSettings.type === 'USB') {
    mainValidation.usbPort = !!connectionSettings.usbPort;
    if (!mainValidation.usbPort) isValid = false;

    // Clear Ethernet validation for USB
    mainValidation.port = true;
  }

  // Validate Ethernet settings if Ethernet connection
  if (connectionSettings.type === 'Ethernet') {
    mainValidation.usbPort = true;

    // Validate IP (using existing validateIP function and isValidIP)
    validateIP();
    mainValidation.ipAddress = isValidIP.value;
    if (!mainValidation.ipAddress) isValid = false;

    // Validate port
    validateMainPort();
    if (!mainValidation.port) isValid = false;
  }

  return isValid;
};

const isSettingsValid = (settings) => {
  if (!settings) return false;

  const connection = settings.connection;
  const connectionType = typeof connection?.type === 'string'
    ? connection.type.toLowerCase()
    : undefined;
  const baudRateRaw = connection?.baudRate;
  const parsedBaudRate = parseInt(baudRateRaw, 10);

  // Required fields
  if (!connectionType || Number.isNaN(parsedBaudRate) || parsedBaudRate <= 0) {
    return false;
  }

  // USB-specific validation
  if (connectionType === 'usb') {
    if (!connection?.usbPort) return false;
  }

  // Ethernet-specific validation
  if (connectionType === 'ethernet') {
    if (!connection?.ip || connection.port === undefined) return false;

    // Validate IP format
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(connection.ip)) return false;

    // Validate port range
    const port = parseInt(connection.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) return false;
  }

  return true;
};

const saveConnectionSettings = async () => {
  // Validate form before saving
  if (!validateMainForm()) {
    return;
  }

  try {
    // Prepare the complete settings object with all settings
    const settingsToSave = {
      connection: {
        type: connectionSettings.type?.toLowerCase() || 'usb',
        ip: connectionSettings.ipAddress || '192.168.5.1',
        port: parseInt(connectionSettings.port, 10) || 23,
        serverPort: parseInt(connectionSettings.serverPort, 10) || 8090,
        usbPort: connectionSettings.usbPort || '',
        baudRate: parseInt(connectionSettings.baudRate, 10) || 115200
      },
      theme: theme.value,
      workspace: workspace.value,
      defaultGcodeView: defaultView.value,
      accentColor: accentColor.value,
      gradientColor: gradientColor.value,
      autoClearConsole: consoleSettings.autoClearConsole
    };

    const response = await fetch(`${getApiBaseUrl()}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settingsToSave)
    });

    if (response.ok) {
      const result = await response.json();
      showSettings.value = false;
    } else {
      const error = await response.json();
      console.error('Failed to save settings:', error.error);
    }
  } catch (error) {
    console.error('Error saving settings:', error);
  }
};

const saveSetupSettings = async () => {
  try {
    // Validate the entire form
    if (!validateSetupForm()) {
      return;
    }

    // Prepare the setup settings for saving
    const settingsToSave = {
      connection: {
        type: setupSettings.type?.toLowerCase() || 'usb',
        ip: setupSettings.ipAddress || '192.168.5.1',
        port: parseInt(setupSettings.port, 10) || 23,
        serverPort: 8090,
        usbPort: setupSettings.usbPort || '',
        baudRate: parseInt(setupSettings.baudRate, 10) || 115200
      },
      homeLocation: setupSettings.homeLocation || 'back-left'
    };

    // Use settings store to save
    const { saveSettings } = await import('./lib/settings-store.js');
    await saveSettings(settingsToSave);

    // Update local connection settings
    connectionSettings.type = setupSettings.type;
    connectionSettings.baudRate = setupSettings.baudRate;
    connectionSettings.ipAddress = setupSettings.ipAddress;
    connectionSettings.port = setupSettings.port;
    connectionSettings.serverPort = settingsToSave.connection.serverPort;
    connectionSettings.usbPort = setupSettings.usbPort;

    // Close setup dialog
    showSetupDialog.value = false;

    // Load USB ports if USB connection type
    if (connectionSettings.type === 'USB') {
      await loadMainUsbPorts();
    }
  } catch (error) {
    console.error('Error saving setup settings:', error);
  }
};

// Clear console (delegate to store)
const clearConsole = store.clearConsole;

onMounted(async () => {
  updateCenter.ensureListeners();
  // Settings are already loaded in main.ts, just get them from the store
  const { getSettings } = await import('./lib/settings-store.js');
  const initialSettings = getSettings();

  // Check if settings are valid, show setup dialog if not
  if (!isSettingsValid(initialSettings)) {
    showSetupDialog.value = true;
    await loadSetupUsbPorts();
  }

  // Alarm description is now read from machineState in use-app-store.ts
  // No need to fetch separately

  // Apply colors after settings are loaded
  applyColors();

  // Fetch loaded plugins to get friendly names
  try {
    const response = await fetch('/api/plugins/loaded');
    if (response.ok) {
      loadedPlugins.value = await response.json();
    }
  } catch (error) {
    console.error('Failed to fetch loaded plugins:', error);
  }

  // Mark initial theme load complete
  await nextTick();
  isInitialThemeLoad = false;

  // Note: WebSocket event listeners and state management are now
  // centralized in the store (see composables/use-app-store.ts)
  // and initialized in main.ts before the app mounts

  // Listen for gcode-updated events to check workspace mismatch
  api.onGCodeUpdated((data: { filename: string; totalLines?: number; size?: number; detectedWorkspace?: string; timestamp: string }) => {
    if (data.detectedWorkspace && data.detectedWorkspace !== workspace.value) {
      detectedWorkspace.value = data.detectedWorkspace;
      showWorkspaceMismatchDialog.value = true;
    }
  });
});

// Watch for job changes to reset viewport
watch(() => store.currentJobFilename, (newFilename, oldFilename) => {
  if (newFilename && newFilename !== oldFilename) {
    viewport.value = defaultView.value;
  }
});

const applyTheme = (value: 'light' | 'dark') => {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(value === 'dark' ? 'theme-dark' : 'theme-light');
  document.documentElement.style.colorScheme = value;
};

watchEffect(() => applyTheme(theme.value));

// Watch theme changes and save to settings
watch(() => theme.value, async (newTheme) => {
  // Don't save during initial load
  if (!isInitialThemeLoad) {
    try {
      const { updateSettings } = await import('./lib/settings-store.js');
      await updateSettings({ theme: newTheme });
    } catch (error) {
      console.error('Failed to save theme setting', JSON.stringify({ error: error.message }));
    }
  }
});

const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
};

const handleUnlock = async () => {
  try {
    // Send soft-reset first
    await api.sendCommand('\x18', { meta: { sourceId: 'client' } });
    // Wait 500ms for controller to process soft-reset
    await new Promise(resolve => setTimeout(resolve, 500));
    // Then send unlock
    await api.sendCommand('$X', { meta: { sourceId: 'client' } });
  } catch (error) {
    console.error('Failed to send unlock command:', error);
  }
};

const themeLabel = computed(() => (theme.value === 'dark' ? 'Dark' : 'Light'));

</script>

<style scoped>
/* Settings Container */
.settings-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
}

/* Tabs */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  border-radius: var(--radius-medium) var(--radius-medium) 0 0;
  padding: var(--gap-sm) var(--gap-md) 0 var(--gap-md);
  gap: 2px;
}

.tab-button {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
  padding: var(--gap-sm) var(--gap-md);
  background: transparent;
  border: none;
  border-radius: var(--radius-small) var(--radius-small) 0 0;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.95rem;
  font-weight: 500;
  margin-top: var(--gap-xs);
  position: relative;
}

.tab-button:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
  transform: translateY(-1px);
}

.tab-button.active {
  background: var(--color-surface);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-elevated);
  border-bottom: 2px solid var(--color-accent);
}

.tab-button.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--gradient-accent);
  border-radius: 2px 2px 0 0;
}

.tab-icon {
  font-size: 1.1rem;
  padding-top: 2px;
}

.tab-label {
  font-weight: 600;
}

/* Tab Content */
.tab-content {
  flex: 1;
  overflow-y: auto;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  position: relative;
}

.tab-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-lg);
  flex: 1;
}

.tab-panel--general {
  gap: 0;
}

.tab-panel--general .settings-section {
  margin: 15px 20px;
}

/* Settings Sections */
.settings-section {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  padding: var(--gap-md);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.section-title {
  margin: 0 0 var(--gap-md) 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--gap-xs);
}

.settings-note {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
  text-align: left;
  font-style: italic;
  margin-top: 4px;
}

.setting-item--with-note {
  align-items: flex-start;
}

.setting-item-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  margin-right: var(--gap-md);
}

/* Setting Items */
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--gap-sm) 0;
  border-bottom: 1px solid var(--color-border);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  font-weight: 500;
  color: var(--color-text-primary);
  flex: 1;
  margin-right: var(--gap-md);
  white-space: nowrap;
}

/* Form Controls */
.setting-select,
.setting-input {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 12px;
  color: var(--color-text-primary);
  font-size: 0.9rem;
  transition: all 0.2s ease;
  min-width: 120px;
}

.setting-select:focus,
.setting-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.setting-select:hover,
.setting-input:hover {
  border-color: var(--color-accent);
}

.setting-select:disabled,
.setting-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
  border-color: var(--color-border);
}

/* Auxiliary Outputs Table */
.io-switches-table-container {
  overflow: visible;
}

.io-switches-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.io-switches-table thead th {
  text-align: left;
  padding: var(--gap-sm) var(--gap-md);
  font-weight: 600;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  border-bottom: 2px solid var(--color-border);
  background: var(--color-surface-muted);
}

.io-switches-table tbody tr {
  border-bottom: 1px solid var(--color-border);
}

.io-switches-table tbody tr:last-child {
  border-bottom: none;
}

.io-switches-table tbody tr:hover {
  background: var(--color-surface-muted);
}

.io-switches-table td,
.io-switches-table th {
  padding: var(--gap-sm) var(--gap-md);
  vertical-align: middle;
}

/* Column widths using colgroup in template */
.io-switches-table .col-enabled { width: 60px; }
.io-switches-table .col-name { width: auto; }
.io-switches-table .col-on { width: 160px; }
.io-switches-table .col-off { width: 160px; }
.io-switches-table .col-actions { width: 180px; }

.io-switches-table th:nth-child(1),
.io-switches-table td:nth-child(1) {
  text-align: center;
}

.io-switches-table td.command-cell {
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.switch-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0.6;
  transition: opacity 0.2s, color 0.2s, background 0.2s;
}

.switch-edit-btn:hover {
  opacity: 1;
  color: var(--color-accent);
  background: var(--color-surface-muted);
}

/* Auxiliary Output Inline Edit */
.aux-inline-input,
.aux-inline-select {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.aux-inline-select {
  font-family: monospace;
  cursor: pointer;
}

.aux-inline-input:hover,
.aux-inline-select:hover {
  border-color: var(--color-accent);
}

.aux-inline-input:focus,
.aux-inline-select:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.aux-actions-cell {
  display: flex;
  gap: 4px;
  white-space: nowrap;
}

.aux-btn-save,
.aux-btn-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  border: none;
  border-radius: var(--radius-small);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.aux-btn-save {
  background: var(--color-accent);
  color: white;
}

.aux-btn-save:hover {
  opacity: 0.9;
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.aux-btn-cancel {
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.aux-btn-cancel:hover {
  border-color: var(--color-accent);
  color: var(--color-text-primary);
}

.aux-btn-delete {
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}

.aux-btn-delete:hover {
  border-color: #dc3545;
  color: #dc3545;
  background: rgba(220, 53, 69, 0.1);
}

.aux-add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--gap-md);
  padding: 8px 16px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-small);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.aux-add-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: rgba(26, 188, 156, 0.05);
}

.setting-value {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.setting-input:disabled {
  background: var(--color-surface);
  color: var(--color-text-secondary);
  opacity: 0.6;
  cursor: not-allowed;
}

.setting-input:disabled:hover {
  border-color: var(--color-border);
}

.setting-input.invalid {
  border-color: #dc3545;
  box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.1);
}

.setting-input.invalid:focus {
  border-color: #dc3545;
  box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.2);
}

.setting-input--right {
  text-align: right;
}

.setting-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--color-accent);
  cursor: pointer;
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 24px;
  cursor: pointer;
}

.toggle-switch input[type="checkbox"] {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 24px;
  transition: all 0.3s ease;
  cursor: pointer;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 2px;
  top: 2px;
  background: white;
  border-radius: 50%;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--gradient-accent);
  border-color: var(--color-accent);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(26px);
}

.toggle-switch:hover .toggle-slider {
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

/* Color Picker */
.color-controls {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
}

.color-picker-container {
  display: flex;
  align-items: center;
  gap: var(--gap-xs);
}

.color-picker {
  width: 40px;
  height: 32px;
  border: none;
  border-radius: var(--radius-small);
  cursor: pointer;
  background: transparent;
  padding: 0;
}

.color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
  border: none;
  border-radius: var(--radius-small);
}

.color-picker::-webkit-color-swatch {
  border: 2px solid var(--color-border);
  border-radius: var(--radius-small);
  transition: all 0.2s ease;
}

.color-picker:hover::-webkit-color-swatch {
  border-color: var(--color-accent);
  transform: scale(1.05);
}

.reset-colors-button {
  padding: 6px 12px;
  font-size: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.reset-colors-button:hover {
  border-color: var(--color-accent);
  background: var(--color-surface-muted);
}

.color-preview {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  box-shadow: var(--shadow-elevated);
}

.gradient-preview {
  border-radius: var(--radius-small);
  width: 32px;
}

.color-value {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  padding: 4px 8px;
  border-radius: var(--radius-small);
  min-width: 70px;
  text-align: center;
}

/* Units Toggle */
.units-toggle {
  display: flex;
  gap: var(--gap-sm);
}

.units-button {
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 16px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.units-button:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-accent);
}

.units-button.active {
  background: var(--gradient-accent);
  color: white;
  border-color: transparent;
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.2);
}

/* Settings Footer */
.settings-footer {
  padding: var(--gap-md);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--gap-md);
  margin-top: auto;
  flex-shrink: 0;
}

.close-button {
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  padding: 12px 32px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.2);
}

.close-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.close-button:active {
  transform: translateY(0);
}

/* Save Button */
.setting-item--action {
  justify-content: flex-end;
  padding-top: var(--gap-md);
  border-bottom: none;
}

.save-connection-button {
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  padding: 12px 32px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.2);
  min-width: 120px;
}

.save-connection-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.save-connection-button:active {
  transform: translateY(0);
}

.save-button {
  background: var(--gradient-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 24px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.2);
}

.save-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.save-button:active {
  transform: translateY(0);
}

/* Responsive Design */
@media (max-width: 768px) {
  .settings-container {
    max-height: 80vh;
  }

  .tabs {
    flex-direction: column;
    gap: 0;
    padding: var(--gap-xs);
  }

  .tab-button {
    margin-top: 0;
    margin-bottom: 2px;
    border-radius: var(--radius-small);
  }

  .tab-button.active::after {
    display: none;
  }

  .tab-button.active {
    border-left: 3px solid var(--color-accent);
    border-bottom: none;
  }

  .setting-item {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--gap-xs);
  }

  .setting-label {
    margin-right: 0;
    margin-bottom: var(--gap-xs);
  }

  .setting-select,
  .setting-input {
    width: 100%;
    min-width: unset;
  }
}

/* Setup Dialog Styles */
.setup-container {
  display: flex;
  flex-direction: column;
  width: auto;
  max-width: 680px; /* Allow a bit more width for setup only */
  min-width: 480px; /* Ensure dialog is comfortably wider */
  min-height: auto;
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-elevated);
}

.setup-header {
  padding: var(--gap-sm) var(--gap-md) var(--gap-xs) var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  border-radius: var(--radius-medium) var(--radius-medium) 0 0;
  text-align: center;
}

.setup-title {
  margin: 0 0 var(--gap-xs) 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.setup-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
}

.setup-content {
  padding: var(--gap-sm) var(--gap-md);
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  flex: 1;
}

.setup-footer {
  padding: var(--gap-xs) var(--gap-md) var(--gap-sm) var(--gap-md);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  border-radius: 0 0 var(--radius-medium) var(--radius-medium);
  display: flex;
  justify-content: center;
}

.setup-save-button {
  padding: var(--gap-sm) var(--gap-lg);
  background: linear-gradient(135deg, var(--color-accent) 0%, #16a085 100%);
  color: white;
  border: none;
  border-radius: var(--radius-medium);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 120px;
  position: relative;
  overflow: hidden;
}

.setup-save-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 188, 156, 0.3);
}

.setup-save-button:active {
  transform: translateY(0);
}

.setup-save-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* Responsive design for setup dialog */
@media (max-width: 768px) {
  .setup-container {
    max-width: 90vw;
    margin: var(--gap-md);
  }

  .setup-header,
  .setup-content,
  .setup-footer {
    padding-left: var(--gap-md);
    padding-right: var(--gap-md);
  }

  .setup-title {
    font-size: 1.3rem;
  }
}

/* Custom USB Port Dropdown Styles */
.custom-dropdown {
  position: relative;
  width: 100%;
  max-width: 280px;
  margin-left: auto;
}

.dropdown-trigger {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-xs) var(--gap-sm);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.dropdown-trigger span:first-child {
  text-align: right;
  flex: 1;
}

.dropdown-trigger:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.dropdown-trigger:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(26, 188, 156, 0.2);
}

.dropdown-trigger.invalid {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.dropdown-trigger.invalid:hover {
  border-color: #dc2626;
  background: rgba(239, 68, 68, 0.15);
}

.dropdown-trigger.invalid:focus {
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

.dropdown-arrow {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  transition: transform 0.2s ease;
}

.dropdown-trigger[aria-expanded="true"] .dropdown-arrow {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  box-shadow: var(--shadow-elevated);
  z-index: 1000;
  max-height: 200px;
  overflow-y: auto;
  margin-top: 2px;
}

.dropdown-item {
  padding: var(--gap-sm);
  cursor: pointer;
  transition: background-color 0.2s ease;
  border-bottom: 1px solid var(--color-border);
}

.dropdown-item:last-child {
  border-bottom: none;
}

.dropdown-item:hover {
  background: var(--color-surface-muted);
}

.dropdown-item.disabled {
  cursor: not-allowed;
  opacity: 0.6;
  background: var(--color-surface-muted);
}

.dropdown-item.disabled:hover {
  background: var(--color-surface-muted);
}

.port-path {
  font-size: 0.9rem;
  color: var(--color-text-primary);
  font-weight: 500;
  line-height: 1.2;
  text-align: right;
}

.port-manufacturer {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  font-style: italic;
  margin-top: 2px;
  line-height: 1.2;
  text-align: right;
}

/* Mobile responsive for custom dropdown */
@media (max-width: 768px) {
  .dropdown-menu {
    max-height: 150px;
  }

  .port-path {
    font-size: 0.85rem;
  }

  .port-manufacturer {
    font-size: 0.7rem;
  }
}

/* Firmware Tab Styles */
.firmware-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  gap: var(--gap-md);
  text-align: center;
  height: 100%;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-hint {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  font-style: italic;
}

.firmware-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  gap: var(--gap-md);
  text-align: center;
}

.error-message {
  color: #dc3545;
  font-weight: 500;
  padding: var(--gap-md);
  background: rgba(220, 53, 69, 0.1);
  border: 1px solid rgba(220, 53, 69, 0.3);
  border-radius: var(--radius-small);
}

.retry-button {
  padding: var(--gap-sm) var(--gap-lg);
  background: var(--color-accent);
  color: white;
  border: none;
  border-radius: var(--radius-small);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-button:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(26, 188, 156, 0.3);
}

.firmware-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  text-align: center;
  color: var(--color-text-secondary);
  font-style: italic;
}

.tab-panel--keyboard,
.tab-panel--plugins,
.tab-panel--firmware,
.tab-panel--tools,
.tab-panel--logs {
  padding: 0;
  gap: 0;
  overflow: hidden;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
}

.firmware-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.firmware-header {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  padding: var(--gap-md);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.firmware-search-input {
  flex: 1;
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.firmware-search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
}

.clear-search-button,
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

.clear-search-button:hover,
.import-export-button:hover {
  background: var(--color-border);
}

.flash-firmware-button {
  padding: var(--gap-sm) var(--gap-md);
  background: linear-gradient(135deg, #e67e22, #d35400);
  border: none;
  border-radius: var(--radius-small);
  color: white;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.flash-firmware-button:hover {
  background: linear-gradient(135deg, #d35400, #c0392b);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(230, 126, 34, 0.3);
}

.submit-changes-button {
  padding: var(--gap-sm) var(--gap-lg);
  background: var(--color-accent);
  color: white !important;
  border: none;
  border-radius: var(--radius-small);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(26, 188, 156, 0.2);
}

.submit-changes-button:hover:not(:disabled) {
  background: #1fa882;
  color: white !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(26, 188, 156, 0.3);
}

.submit-changes-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-button {
  padding: var(--gap-sm) var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-button:hover:not(:disabled) {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
  transform: translateY(-1px);
}

.refresh-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.firmware-table-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.firmware-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.firmware-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-surface-muted);
}

.firmware-table thead::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -2px;
  height: 2px;
  background: var(--color-surface-muted);
  z-index: 11;
}

.firmware-table thead::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--color-border);
}

.firmware-table th {
  padding: var(--gap-sm) var(--gap-md);
  text-align: left;
  font-weight: 600;
  color: var(--color-text-primary);
  border-bottom: 2px solid var(--color-border);
  background: var(--color-surface-muted);
}

.firmware-table th.col-setting {
  text-align: center;
}

.firmware-table th.col-value {
  text-align: right;
}

.firmware-table tbody tr:first-child td {
  padding-top: var(--gap-lg);
}

.firmware-table tbody tr:last-child td {
  padding-bottom: var(--gap-lg);
}

.firmware-table td {
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.firmware-table td:first-child {
  padding-left: var(--gap-md);
}

.firmware-table td:last-child {
  padding-right: var(--gap-md);
}

.firmware-row:nth-child(even) {
  background: var(--color-surface-muted);
}

.firmware-row:hover {
  background: var(--color-border);
}

.col-setting {
  width: 10%;
  min-width: 80px;
  text-align: center;
}

.col-description {
  width: 65%;
}

.col-value {
  width: 25%;
  text-align: right;
}

.setting-id {
  font-weight: 700;
  color: var(--color-text-primary);
  font-size: 1.3rem;
}

.setting-group {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 2px;
  background: var(--color-surface-muted);
  padding: 6px 12px;
  border-radius: 12px;
  border: 1px solid var(--color-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.setting-name {
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.requires-restart-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #ff9800;
  color: #000;
  font-size: 0.7rem;
  font-weight: 600;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-hal-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  line-height: 1.4;
  white-space: pre-line;
}

.setting-details {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  display: flex;
  gap: var(--gap-md);
}

.setting-value-display {
  font-weight: 600;
  color: var(--color-accent);
  font-size: 1rem;
}

.setting-unit {
  margin-left: 4px;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.no-results {
  text-align: center;
  padding: var(--gap-xl);
  color: var(--color-text-secondary);
  font-style: italic;
}

.firmware-footer {
  display: flex;
  justify-content: space-between;
  padding: var(--gap-sm) var(--gap-md);
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.firmware-footer .import-summary {
  color: var(--color-accent);
  font-weight: 600;
}

/* Bitfield Toggle Switches */
.bitfield-toggles {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--gap-sm) var(--gap-md);
  align-items: center;
  width: 100%;
}

.radio-input-container {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-md);
  align-items: center;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.radio-option input[type="radio"] {
  accent-color: var(--color-accent);
}

.bitfield-item {
  display: contents;
}

.bitfield-name {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  text-align: left;
}

.toggle-switch {
  justify-self: center;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
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

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-accent);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

.toggle-switch input:focus + .toggle-slider {
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.2);
}

/* Numeric and String Input */
.toggle-input-container,
.numeric-input-container,
.string-input-container {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.setting-numeric-input,
.setting-string-input {
  width: 60%;
  min-width: 100px;
  max-width: 300px;
  padding: 10px 10px !important;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  text-align: right;
  transition: all 0.2s ease;
}

.setting-numeric-input:focus,
.setting-string-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(26, 188, 156, 0.1);
  background: var(--color-surface);
}

.setting-numeric-input:invalid,
.setting-string-input:invalid {
  border-color: #dc3545;
}

.setting-numeric-input.has-changes,
.setting-string-input.has-changes {
  border-color: var(--color-accent);
  background: rgba(26, 188, 156, 0.05);
  font-weight: 600;
}

.setting-numeric-input::placeholder,
.setting-string-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.5;
}

.firmware-json-details {
  margin-top: var(--gap-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
}

.firmware-json-details summary {
  padding: var(--gap-sm) var(--gap-md);
  cursor: pointer;
  font-weight: 500;
  color: var(--color-text-primary);
  user-select: none;
  transition: background 0.2s ease;
}

.firmware-json-details summary:hover {
  background: var(--color-surface);
}

.firmware-json {
  margin: 0;
  padding: var(--gap-md);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  border-radius: 0 0 var(--radius-small) var(--radius-small);
  font-size: 0.85rem;
  font-family: 'Courier New', monospace;
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
  color: var(--color-text-secondary);
}

/* Firmware Flasher Dialog Styles */
.firmware-flasher-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.flash-warning-box {
  padding: 12px;
  background: rgba(237, 137, 54, 0.1);
  border: 1px solid rgba(237, 137, 54, 0.3);
  border-radius: 6px;
  font-size: 0.85rem;
  color: #ed8936;
}

.flash-warning-box strong {
  display: block;
  margin-bottom: 4px;
}

.flash-warning-box p {
  margin: 0;
}

.flash-form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.flash-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.flash-refresh-btn {
  padding: 4px 8px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-primary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.flash-refresh-btn:hover:not(:disabled) {
  background: var(--color-surface);
}

.flash-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.flash-copy-btn {
  padding: 4px 10px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-primary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.flash-copy-btn:hover {
  background: var(--color-surface);
}

.flash-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.flash-select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.flash-select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.flash-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.flash-file-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface-muted);
}

.flash-file-input-hidden {
  display: none;
}

.flash-file-btn {
  padding: 6px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text-primary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.flash-file-btn:hover:not(:disabled) {
  background: var(--color-surface-hover, #3a3a3a);
  border-color: var(--color-accent);
}

.flash-file-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.flash-file-name {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flash-progress-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.flash-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.flash-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(160, 174, 192, 0.2);
  color: #a0aec0;
}

.flash-status-badge.flashing {
  background: rgba(74, 144, 226, 0.2);
  color: #4a90e2;
}

.flash-status-badge.success {
  background: rgba(56, 161, 105, 0.2);
  color: #38a169;
}

.flash-status-badge.error {
  background: rgba(229, 62, 62, 0.2);
  color: #e53e3e;
}

.flash-progress-bar {
  height: 8px;
  background: var(--color-surface-muted);
  border-radius: 4px;
  overflow: hidden;
}

.flash-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4a90e2, #63b3ed);
  border-radius: 4px;
  transition: width 0.2s ease;
}

.flash-progress-fill.success {
  background: linear-gradient(90deg, #38a169, #68d391);
}

.flash-progress-fill.error {
  background: linear-gradient(90deg, #e53e3e, #fc8181);
}

.flash-progress-text {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-align: center;
}

.flash-messages {
  height: 120px;
  overflow-y: auto;
  padding: 10px;
  background: var(--color-surface-muted);
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  user-select: text;
  cursor: text;
  flex-shrink: 0;
}

.flash-message {
  margin-bottom: 2px;
}

.flash-message.info {
  color: #63b3ed;
}

.flash-message.error {
  color: #fc8181;
}

.flash-message.success {
  color: #68d391;
}

.flash-button-row {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 8px;
}

.flash-btn-primary,
.flash-btn-secondary {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.flash-btn-primary {
  background: linear-gradient(135deg, #4a90e2, #357abd);
  color: white;
}

.flash-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
}

.flash-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.flash-btn-secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.flash-btn-secondary:hover:not(:disabled) {
  background: var(--color-surface);
}
</style>

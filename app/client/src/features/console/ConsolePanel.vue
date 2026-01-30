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
  <section class="card" :class="{ 'card-disabled': !store.isConnected.value }">
    <header class="card__header">
      <div class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-button"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="auto-scroll-toggle" @click="autoScroll = !autoScroll" :class="{ active: autoScroll }" v-if="activeTab === 'terminal'">
        <span class="toggle-label">Auto-Scroll</span>
        <div class="toggle-switch">
          <div class="toggle-handle"></div>
        </div>
      </div>
      <div class="auto-scroll-toggle" @click="autoScrollGcode = !autoScrollGcode" :class="{ active: autoScrollGcode }" v-if="activeTab === 'gcode-preview'">
        <span class="toggle-label">Auto-Scroll</span>
        <div class="toggle-switch">
          <div class="toggle-handle"></div>
        </div>
      </div>
    </header>

    <!-- Terminal Tab -->
    <div v-if="activeTab === 'terminal'" class="tab-content">
      <div class="console-output" role="log" aria-live="polite" ref="consoleOutput">
        <button @click="copyAllTerminalContent" class="terminal-copy-button" :disabled="terminalLines.length === 0" title="Copy all terminal content">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
            <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
          </svg>
        </button>
        <button class="terminal-detach-button" @click="showTerminalModal = true" title="Open in larger view">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/>
          </svg>
        </button>
        <div v-if="terminalLines.length === 0" class="empty-state">
          All clear – give me a command!
        </div>
        <DynamicScroller
          v-else
          class="terminal-scroller"
          :items="terminalLines"
          :min-item-size="terminalRowHeight"
          key-field="id"
          :buffer="200"
          ref="scrollerRef"
        >
          <template #default="{ item, index, active }">
            <DynamicScrollerItem
              :item="item"
              :index="index"
              :active="active"
              :size-dependencies="[item.message, item.timestamp, item.status, item.type]"
            >
              <article
                :class="['console-line', `console-line--${item.level}`, `console-line--${item.type}`]"
              >
                <span class="timestamp">{{ item.timestamp }}{{ item.type === 'command' || item.type === 'response' ? ' - ' : ' ' }}<span v-html="getStatusIcon(item)"></span></span>
                <span class="message" v-html="highlightGcode(item)"></span>
              </article>
            </DynamicScrollerItem>
          </template>
        </DynamicScroller>
      </div>
      <form class="console-input" @submit.prevent="sendCommand">
        <textarea
          class="console-input__textarea"
          :placeholder="connected ? 'Send command(s)' : 'Connect to CNC to send commands'"
          v-model="commandToSend"
          @keydown="handleKeyDown"
          :disabled="!connected"
          rows="1"
        ></textarea>
        <div class="console-input__actions">
          <button type="submit" class="primary" :disabled="!connected">Send</button>
          <button type="button" class="primary" @click="$emit('clear')">Clear</button>
        </div>
      </form>
    </div>

    <!-- Macros Tab -->
    <div v-if="activeTab === 'macros'" class="tab-content" :class="{ 'tab-content--locked': !isSenderIdle }">
      <MacroPanel :connected="connected" />
    </div>

    <!-- Tools Tab -->
    <div v-if="activeTab === 'tools'" class="tab-content tools-tab" :class="{ 'tab-content--locked': !isSenderIdle }">
      <div v-if="loadingTools" class="placeholder-content">
        <p>Loading plugin tools...</p>
      </div>
      <div v-else-if="toolMenuItems.length === 0" class="placeholder-content">
        <p>No plugin tools available. Install plugins to add custom tools.</p>
      </div>
      <div v-else class="tools-list">
        <button
          v-for="item in toolMenuItems"
          :key="`${item.pluginId}-${item.label}`"
          class="tool-button"
          @click="executeToolMenuItem(item)"
          :disabled="executingTool === `${item.pluginId}-${item.label}`"
        >
          <!-- Custom icon if provided, otherwise default gear icon -->
          <span v-if="item.icon && item.icon.startsWith('<')" class="tool-icon" v-html="item.icon"></span>
          <img v-else-if="item.icon" :src="`${api.baseUrl}/api/plugins/${item.pluginId}/icon?file=${encodeURIComponent(item.icon)}`" class="tool-icon-img" />
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
          </svg>
          <span class="tool-label">{{ item.label }}</span>
          <span v-if="executingTool === `${item.pluginId}-${item.label}`" class="tool-spinner"></span>
        </button>
      </div>
    </div>

    <!-- G-Code Preview Tab -->
    <div v-show="activeTab === 'gcode-preview'" class="tab-content">
      <div v-if="!totalLines" class="placeholder-content">
        <p>No G-Code file loaded. Please upload or load it from visualizer.</p>
      </div>
      <div v-else class="gcode-preview">
        <!-- Loading Overlay for G-Code Preview -->
        <div v-if="gcodeLoading" class="gcode-loading-overlay">
          <div class="gcode-loading-content">
            <div class="gcode-loading-header">
              <span class="gcode-loading-message">{{ gcodeLoadingMessage }}</span>
              <div class="gcode-loading-percent">{{ gcodeLoadingProgress }}%</div>
            </div>
            <div class="gcode-loading-bar-container">
              <div class="gcode-loading-bar" :style="{ width: `${gcodeLoadingProgress}%` }"></div>
            </div>
          </div>
        </div>

        <div class="gcode-content" ref="gcodeOutput">
          <button class="gcode-detach-button" @click="showGcodeModal = true" title="Open in larger view">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z"/>
            </svg>
          </button>
          <CodeEditor
            :value="viewableGcode"
            language="gcode"
            :theme="monacoTheme"
            :options="monacoMainViewerOptions"
            @editorDidMount="handleMonacoMainViewerMount"
            class="monaco-editor-container monaco-main-viewer"
          />
        </div>
        <div class="gcode-footer">
          {{ store.gcodeFilename.value || 'Untitled' }} — {{ totalLines }} lines
          <span class="gcode-storage">{{ storageMode }}</span>
        </div>
      </div>
    </div>

    <!-- G-Code Modal Dialog -->
    <div v-if="showGcodeModal" class="modal-overlay" @click.self="closeGcodeModal">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>{{ store.gcodeFilename.value || 'Untitled' }} — {{ totalLines }} lines</h3>
          <button class="modal-close" @click="closeGcodeModal" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
            </svg>
          </button>
        </div>
        <div class="modal-toolbar">
          <!-- Find & Replace -->
          <div class="find-replace-container">
            <div class="find-row">
              <input
                type="text"
                v-model="findQuery"
                placeholder="Find"
                @input="onFindInput"
                @keydown.enter.prevent="goToNextFind"
                @keydown.shift.enter.prevent="goToPreviousFind"
                class="find-input"
              />
              <button
                @click="findCaseSensitive = !findCaseSensitive; onFindInput()"
                :class="['find-option-btn', { active: findCaseSensitive }]"
                title="Match Case (Alt+C)"
              >Aa</button>
              <button
                @click="findWholeWord = !findWholeWord; onFindInput()"
                :class="['find-option-btn', { active: findWholeWord }]"
                title="Match Whole Word (Alt+W)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm12-8a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM4.5 6h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1zm0 3h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1z"/>
                </svg>
              </button>
              <button
                @click="findUseRegex = !findUseRegex; onFindInput()"
                :class="['find-option-btn', { active: findUseRegex }]"
                title="Use Regular Expression (Alt+R)"
              >.*</button>
              <span class="find-results">{{ findResultText }}</span>
              <button @click="goToPreviousFind" :disabled="findMatches.length === 0" class="find-nav-btn" title="Previous Match (Shift+Enter)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                  <path fill-rule="evenodd" d="M8 15a.5.5 0 0 0 .5-.5V2.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L7.5 2.707V14.5a.5.5 0 0 0 .5.5z"/>
                </svg>
              </button>
              <button @click="goToNextFind" :disabled="findMatches.length === 0" class="find-nav-btn" title="Next Match (Enter)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                  <path fill-rule="evenodd" d="M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1z"/>
                </svg>
              </button>
              <button v-if="findQuery" @click="clearFind" class="find-clear-btn" title="Clear">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
                </svg>
              </button>
            </div>
            <div v-if="!isProgramRunning" class="replace-row">
              <input
                type="text"
                v-model="replaceQuery"
                placeholder="Replace"
                @keydown.enter.prevent="replaceNext"
                class="find-input"
              />
              <button @click="replaceNext" :disabled="findMatches.length === 0" class="replace-btn" title="Replace (Enter)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10z"/>
                </svg>
              </button>
              <button @click="replaceAll" :disabled="findMatches.length === 0" class="replace-btn" title="Replace All">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10z"/>
                  <path d="M2 6a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm6 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/>
                </svg>
              </button>
            </div>
          </div>
          <!-- Modal Actions -->
          <div class="modal-actions">
            <div v-if="isProgramRunning" class="auto-scroll-toggle" @click="autoScrollModal = !autoScrollModal" :class="{ active: autoScrollModal }">
              <span class="toggle-label">Auto-Scroll</span>
              <div class="toggle-switch">
                <div class="toggle-handle"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-content">
          <!-- Read-only viewer when job is running -->
          <div v-if="isProgramRunning" class="gcode-modal-viewer" ref="modalGcodeOutput">
            <CodeEditor
              :value="viewableGcode"
              language="gcode"
              :theme="monacoTheme"
              :options="monacoViewerOptions"
              @editorDidMount="handleMonacoViewerMount"
              class="monaco-editor-container"
            />
          </div>
          <!-- Editable editor when job is not running -->
          <div v-else class="gcode-editor-container">
            <CodeEditor
              v-model:value="editableGcode"
              language="gcode"
              :theme="monacoTheme"
              :options="monacoEditorOptions"
              @editorDidMount="handleMonacoEditorMount"
              class="monaco-editor-container"
            />
            <div class="editor-actions">
              <button @click="hasUnsavedChanges ? discardChanges() : closeGcodeModal()" class="cancel-button">{{ hasUnsavedChanges ? 'Discard' : 'Close' }}</button>
              <button @click="commitEdit" class="commit-button" :disabled="!hasUnsavedChanges">Commit Changes</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Terminal Modal Dialog -->
    <div v-if="showTerminalModal" class="modal-overlay" @click.self="showTerminalModal = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>Terminal</h3>
          <div class="modal-header-actions">
            <div class="auto-scroll-toggle" @click="autoScrollTerminalModal = !autoScrollTerminalModal" :class="{ active: autoScrollTerminalModal }">
              <span class="toggle-label">Auto-Scroll</span>
              <div class="toggle-switch">
                <div class="toggle-handle"></div>
              </div>
            </div>
            <button class="modal-close" @click="showTerminalModal = false" title="Close">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="modal-content modal-content--terminal">
          <div class="terminal-left-column">
            <div class="terminal-quick-controls">
            <button @click="clearTerminal" class="quick-control-btn" title="Clear terminal">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
              </svg>
              <span>Clear</span>
            </button>
            <button @click="sendQuickCommand('$H')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Home machine ($H)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z"/>
                <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z"/>
              </svg>
              <span>Home</span>
            </button>
            <button @click="sendQuickCommand('$X')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Unlock machine ($X)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M11 1a2 2 0 0 0-2 2v4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h5V3a3 3 0 0 1 6 0v4a.5.5 0 0 1-1 0V3a2 2 0 0 0-2-2z"/>
              </svg>
              <span>Unlock</span>
            </button>
            <button @click="sendQuickCommand('\x18')" :disabled="!connected || !isSenderIdle" class="quick-control-btn quick-control-btn--danger" title="Soft Reset (Ctrl-X)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
              </svg>
              <span>Reset</span>
            </button>
            <button @click="sendQuickCommand('0x87')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Full status report (0x87)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M6.5 5.5a.5.5 0 0 0-1 0v4a.5.5 0 0 0 1 0v-4zm3 0a.5.5 0 0 0-1 0v4a.5.5 0 0 0 1 0v-4zm1.5 4a.5.5 0 0 0 0-1H5a.5.5 0 0 0 0 1h6z"/>
              </svg>
              <span>Status Report</span>
            </button>
            <button @click="sendQuickCommand('$help')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Show help ($help)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
              </svg>
              <span>Help</span>
            </button>
            <button @click="sendQuickCommand('$I')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Show information ($I)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
              </svg>
              <span>Information</span>
            </button>
            <button @click="sendQuickCommand('$$')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Controller settings ($$)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
              </svg>
              <span>Controller Settings</span>
            </button>
            <button @click="sendQuickCommand('$G')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Modal state ($G)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z"/>
              </svg>
              <span>Modal State</span>
            </button>
            <div class="spindle-control">
              <button @click="sendSpindleCW" :disabled="!connected || !isSenderIdle" class="quick-control-btn spindle-control__btn" title="Spindle CW (M3)">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8z"/>
                  <path d="m10.854 8.146-2-2a.5.5 0 0 0-.708 0l-2 2a.5.5 0 0 0 .708.708L8 7.707l1.146 1.147a.5.5 0 0 0 .708-.708z"/>
                </svg>
                <span>Spindle CW</span>
              </button>
              <select v-model.number="spindleRPM" class="spindle-control__select" :disabled="!connected || !isSenderIdle">
                <option v-for="rpm in Array.from({length: 24}, (_, i) => (i + 1) * 1000)" :key="rpm" :value="rpm">{{ rpm }}</option>
              </select>
            </div>
            <div class="spindle-control">
              <button @click="sendSpindleCCW" :disabled="!connected || !isSenderIdle" class="quick-control-btn spindle-control__btn" title="Spindle CCW (M4)">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8z"/>
                  <path d="M10.854 7.854 9.707 9H11.5a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 1 0v1.793l1.146-1.147a.5.5 0 0 1 .708.708z"/>
                </svg>
                <span>Spindle CCW</span>
              </button>
              <select v-model.number="spindleRPM" class="spindle-control__select" :disabled="!connected || !isSenderIdle">
                <option v-for="rpm in Array.from({length: 24}, (_, i) => (i + 1) * 1000)" :key="rpm" :value="rpm">{{ rpm }}</option>
              </select>
            </div>
            <button @click="sendQuickCommand('M5')" :disabled="!connected || !isSenderIdle" class="quick-control-btn quick-control-btn--danger" title="Stop spindle (M5)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h3A1.5 1.5 0 0 1 11 6.5v3A1.5 1.5 0 0 1 9.5 11h-3A1.5 1.5 0 0 1 5 9.5v-3z"/>
              </svg>
              <span>Stop Spindle</span>
            </button>
            </div>
          </div>
          <div class="terminal-right-column">
            <div class="terminal-modal-viewer">
            <button @click="copyAllTerminalContent" class="terminal-modal-copy-button" :disabled="terminalLines.length === 0" title="Copy all terminal content">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
              </svg>
            </button>
            <div class="console-output console-output--modal">
            <div v-if="terminalLines.length === 0" class="empty-state">
              All clear – give me a command!
            </div>
            <DynamicScroller
              v-else
              class="terminal-scroller"
              :items="terminalLines"
              :min-item-size="terminalRowHeight"
              key-field="id"
              :buffer="200"
              ref="modalTerminalScrollerRef"
            >
              <template #default="{ item, index, active }">
                <DynamicScrollerItem
                  :item="item"
                  :index="index"
                  :active="active"
                  :size-dependencies="[item.message, item.timestamp, item.status, item.type]"
                >
                  <article
                    :class="['console-line', `console-line--${item.level}`, `console-line--${item.type}`]"
                  >
                    <span class="timestamp">{{ item.timestamp }}{{ item.type === 'command' || item.type === 'response' ? ' - ' : ' ' }}<span v-html="getStatusIcon(item)"></span></span>
                    <span class="message" v-html="highlightGcode(item)"></span>
                  </article>
                </DynamicScrollerItem>
              </template>
            </DynamicScroller>
            </div>
          </div>
          <div class="terminal-modal-controls">
            <div class="control-buttons">
              <!-- Touch-friendly control buttons will go here -->
            </div>
            <form class="console-input console-input--modal" @submit.prevent="sendCommand">
              <textarea
                class="console-input__textarea"
                :placeholder="connected ? 'Send command(s)' : 'Connect to CNC to send commands'"
                v-model="commandToSend"
                @keydown="handleKeyDown"
                :disabled="!connected"
                rows="4"
                ref="modalCommandInput"
              ></textarea>
              <div class="console-input__history-controls">
                <button type="button" class="history-btn" @click="navigateHistory('up')" :disabled="!connected" title="Previous command">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M8 15a.5.5 0 0 0 .5-.5V2.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L7.5 2.707V14.5a.5.5 0 0 0 .5.5z"/>
                  </svg>
                </button>
                <button type="button" class="history-btn" @click="navigateHistory('down')" :disabled="!connected" title="Next command">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                    <path fill-rule="evenodd" d="M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1z"/>
                  </svg>
                </button>
              </div>
              <div class="console-input__actions">
                <button type="submit" class="primary" :disabled="!connected">Send</button>
              </div>
            </form>
          </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Discard Changes Confirmation Dialog -->
    <Dialog v-if="showDiscardDialog" @close="handleDiscardCancel" :show-header="false" size="small" :z-index="10002">
      <ConfirmPanel
        title="Discard Changes"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirm-text="Discard"
        cancel-text="Cancel"
        variant="danger"
        @confirm="handleDiscardConfirm"
        @cancel="handleDiscardCancel"
      />
    </Dialog>

    <!-- Start From Line with Pending Changes Dialog -->
    <Dialog v-if="showStartFromLineConfirm" @close="handleStartFromLineCancel" :show-header="false" size="small" :z-index="10002">
      <div class="confirm-dialog">
        <h3 class="confirm-dialog__title">Unsaved Changes</h3>
        <p class="confirm-dialog__message">You have unsaved changes. What would you like to do before opening Start From Line?</p>
        <div class="confirm-dialog__actions confirm-dialog__actions--three">
          <button @click="handleStartFromLineCancel" class="confirm-dialog__btn confirm-dialog__btn--cancel">Cancel</button>
          <button @click="handleStartFromLineDiscard" class="confirm-dialog__btn confirm-dialog__btn--danger">Discard</button>
          <button @click="handleStartFromLineSaveFirst" class="confirm-dialog__btn confirm-dialog__btn--primary">Save First</button>
        </div>
      </div>
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed, reactive, shallowRef } from 'vue';
import { api } from './api';
import { fetchToolMenuItems, executeToolMenuItem as runToolMenuItem } from '../plugins/api';
import { getLinesRangeFromIDB, isIDBEnabled } from '../../lib/gcode-store.js';
import { isTerminalIDBEnabled } from '../../lib/terminal-store.js';
import { getCommandHistoryFromInit } from '@/lib/init';
import { useConsoleStore } from './store';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import MacroPanel from '../macro/MacroPanel.vue';
import { CodeEditor } from 'monaco-editor-vue3';
import * as monaco from 'monaco-editor';
import type * as Monaco from 'monaco-editor';
import Dialog from '@/components/Dialog.vue';
import ConfirmPanel from '@/components/ConfirmPanel.vue';

const store = useConsoleStore();

const props = withDefaults(defineProps<{
  lines?: Array<{ id: string | number; level: string; message: string; timestamp: string; status?: 'pending' | 'success' | 'error'; type?: 'command' | 'response'; sourceId?: string }>;
  connected?: boolean;
  senderStatus?: string;
}>(), {
  lines: () => [],
  senderStatus: 'idle'
});

const emit = defineEmits<{
  (e: 'clear'): void;
}>();

const commandToSend = ref('');
const autoScroll = ref(true);
const autoScrollGcode = ref(true);
const consoleOutput = ref<HTMLElement | null>(null);
const scrollerRef = ref<any>(null);
const gcodeOutput = ref<HTMLElement | null>(null);
const commandHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const currentInput = ref('');
// Make Terminal the default tab and list it first
const activeTab = ref('terminal');
const tabs = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'gcode-preview', label: 'G-Code Preview' },
  { id: 'macros', label: 'Macros' },
  { id: 'tools', label: 'Plugins' }
];

// G-Code Modal state
const showGcodeModal = ref(false);
const modalGcodeOutput = ref<HTMLElement | null>(null);
const searchQuery = ref('');

// Terminal Modal state
const showTerminalModal = ref(false);
const modalTerminalScrollerRef = ref<any>(null);
const autoScrollTerminalModal = ref(true);
const spindleRPM = ref(10000);
const searchResults = ref<number[]>([]);
const currentSearchIndex = ref(0);
const editableGcode = ref('');
const originalGcode = ref('');
const hasUnsavedChanges = ref(false);
const isRevertingContent = ref(false);
const showDiscardDialog = ref(false);
const discardCallback = ref<(() => void) | null>(null);
const showStartFromLineConfirm = ref(false);
const pendingStartFromLineNumber = ref<number | null>(null);
const autoScrollModal = ref(true);

// Find & Replace state
const findQuery = ref('');
const replaceQuery = ref('');
const findCaseSensitive = ref(false);
const findWholeWord = ref(false);
const findUseRegex = ref(false);
const findMatches = ref<Monaco.editor.FindMatch[]>([]);
const currentFindIndex = ref(0);

// Monaco Editor refs
const monacoViewerRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const monacoMainViewerRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const monacoEditorRef = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const currentLineDecorations = ref<string[]>([]);
const mainViewerLineDecorations = ref<string[]>([]);

// G-Code line selection state for visualizer highlighting
const selectionStart = ref<number | null>(null);
const selectionEnd = ref<number | null>(null);
const isDragging = ref(false);
// Track decorations separately for each editor (Monaco decoration IDs are editor-specific)
const editorDecorationsMap = new WeakMap<Monaco.editor.IStandaloneCodeEditor, string[]>();

// Monaco Editor options for main G-Code preview (smaller view)
const monacoMainViewerOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  minimap: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  automaticLayout: true,
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  renderLineHighlight: 'none',
  selectionHighlight: false,
  occurrencesHighlight: 'off',
  folding: false,
  glyphMargin: true,
  lineDecorationsWidth: 12,
  lineNumbersMinChars: 3,
  largeFileOptimizations: false,
  maxTokenizationLineLength: 5000,
  scrollbar: {
    vertical: 'visible',
    horizontal: 'visible',
    useShadows: false,
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8
  }
};

// Monaco Editor options for modal read-only viewer
const monacoViewerOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  minimap: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  automaticLayout: true,
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  renderLineHighlight: 'none',
  selectionHighlight: false,
  occurrencesHighlight: 'off',
  folding: false,
  glyphMargin: true,
  lineDecorationsWidth: 16,
  lineNumbersMinChars: 3,
  largeFileOptimizations: false,
  maxTokenizationLineLength: 5000,
  scrollbar: {
    vertical: 'visible',
    horizontal: 'visible',
    useShadows: false,
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10
  }
};

// Monaco Editor options for editing
const monacoEditorOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  wordWrap: 'off',
  automaticLayout: true,
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  folding: false,
  glyphMargin: true,
  lineDecorationsWidth: 16,
  lineNumbersMinChars: 3,
  largeFileOptimizations: false,
  maxTokenizationLineLength: 5000,
  scrollbar: {
    vertical: 'visible',
    horizontal: 'visible',
    useShadows: false,
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10
  }
};

// Computed property for viewer gcode content
const viewableGcode = computed(() => {
  return store.gcodeContent.value || '';
});

// Computed property for Monaco theme based on app theme
const isLightTheme = ref(document.body.classList.contains('theme-light'));
const monacoTheme = computed(() => isLightTheme.value ? 'gcode-light' : 'gcode-dark');

// Register G-code language and themes
function registerGcodeLanguage() {
  // Register the G-code language
  monaco.languages.register({ id: 'gcode' });

  // Define G-code syntax highlighting
  monaco.languages.setMonarchTokensProvider('gcode', {
    tokenizer: {
      root: [
        // Comments - parentheses style
        [/\(.*?\)/, 'comment'],
        // Comments - semicolon style
        [/;.*$/, 'comment'],
        // Rapid motion G0/G00
        [/\b[Gg]0*(?=\s|$|[A-Za-z])/, 'gcode-rapid'],
        // Linear/Arc motion G1/G2/G3
        [/\b[Gg][1-3]\b/, 'gcode-cutting'],
        // Other G commands
        [/\b[Gg]\d+\.?\d*/, 'gcode-g'],
        // M commands
        [/\b[Mm]\d+/, 'gcode-m'],
        // Tool number
        [/\b[Tt]\d+/, 'gcode-tool'],
        // Spindle speed
        [/\b[Ss]\d+\.?\d*/, 'gcode-spindle'],
        // Feed rate
        [/\b[Ff]\d+\.?\d*/, 'gcode-feed'],
        // Coordinates X Y Z
        [/\b[Xx]-?\d+\.?\d*/, 'gcode-coord-x'],
        [/\b[Yy]-?\d+\.?\d*/, 'gcode-coord-y'],
        [/\b[Zz]-?\d+\.?\d*/, 'gcode-coord-z'],
        // Other axes A B C I J K
        [/\b[AaBbCcIiJjKk]-?\d+\.?\d*/, 'gcode-coord-other'],
        // Line numbers
        [/\b[Nn]\d+/, 'gcode-line-number'],
        // Numbers
        [/-?\d+\.?\d*/, 'number'],
      ]
    }
  });

  // Define dark theme for G-code
  monaco.editor.defineTheme('gcode-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'gcode-rapid', foreground: 'FF8C00', fontStyle: 'bold' },  // Orange for rapid
      { token: 'gcode-cutting', foreground: '569CD6', fontStyle: 'bold' }, // Blue for cutting
      { token: 'gcode-g', foreground: 'C586C0' },  // Purple for other G codes
      { token: 'gcode-m', foreground: 'DCDCAA' },  // Yellow for M codes
      { token: 'gcode-tool', foreground: '4EC9B0' },  // Teal for tools
      { token: 'gcode-spindle', foreground: 'CE9178' },  // Orange-brown for spindle
      { token: 'gcode-feed', foreground: 'B5CEA8' },  // Light green for feed
      { token: 'gcode-coord-x', foreground: 'F14C4C' },  // Red for X
      { token: 'gcode-coord-y', foreground: '4EC9B0' },  // Teal for Y
      { token: 'gcode-coord-z', foreground: '569CD6' },  // Blue for Z
      { token: 'gcode-coord-other', foreground: '9CDCFE' },  // Light blue for other axes
      { token: 'gcode-line-number', foreground: '858585' },  // Gray for line numbers
      { token: 'number', foreground: 'B5CEA8' },
    ],
    colors: {}
  });

  // Define light theme for G-code
  monaco.editor.defineTheme('gcode-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      { token: 'gcode-rapid', foreground: 'E67E22', fontStyle: 'bold' },  // Orange for rapid
      { token: 'gcode-cutting', foreground: '2E86C1', fontStyle: 'bold' }, // Blue for cutting
      { token: 'gcode-g', foreground: 'AF00DB' },  // Purple for other G codes
      { token: 'gcode-m', foreground: '795E26' },  // Brown for M codes
      { token: 'gcode-tool', foreground: '267F99' },  // Teal for tools
      { token: 'gcode-spindle', foreground: 'A31515' },  // Red-brown for spindle
      { token: 'gcode-feed', foreground: '098658' },  // Green for feed
      { token: 'gcode-coord-x', foreground: 'C72828' },  // Red for X
      { token: 'gcode-coord-y', foreground: '267F99' },  // Teal for Y
      { token: 'gcode-coord-z', foreground: '2E86C1' },  // Blue for Z
      { token: 'gcode-coord-other', foreground: '0070C1' },  // Blue for other axes
      { token: 'gcode-line-number', foreground: '999999' },  // Gray for line numbers
      { token: 'number', foreground: '098658' },
    ],
    colors: {
      'editor.background': '#f8f8f8',
      'editorGutter.background': '#f8f8f8',
    }
  });
}

// Register G-code language immediately
registerGcodeLanguage();

// Expose Monaco globally for plugins to use
(window as unknown as { monaco: typeof monaco }).monaco = monaco;

// Watch for theme changes
const themeObserver = new MutationObserver(() => {
  isLightTheme.value = document.body.classList.contains('theme-light');
});

// Apply theme change to Monaco editor
watch(monacoTheme, (newTheme) => {
  monaco.editor.setTheme(newTheme);
});

onMounted(() => {
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
});

onBeforeUnmount(() => {
  themeObserver.disconnect();
});

// Handle Monaco viewer mount (modal/detached view)
function handleMonacoViewerMount(editor: Monaco.editor.IStandaloneCodeEditor) {
  monacoViewerRef.value = editor;
  updateCurrentLineDecoration();
  setupGutterSelectionHandler(editor);

  // Add Ctrl+G keybinding for "Go to Line" (same as main viewer)
  editor.addAction({
    id: 'go-to-line',
    label: 'Go to Line',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.gotoLine', null);
    }
  });
}

// Handle Monaco editor mount (editable editor in modal)
function handleMonacoEditorMount(editor: Monaco.editor.IStandaloneCodeEditor) {
  monacoEditorRef.value = editor;

  // Track changes by comparing to original content
  editor.onDidChangeModelContent(() => {
    if (!isRevertingContent.value) {
      const currentContent = editor.getValue();
      hasUnsavedChanges.value = currentContent !== originalGcode.value;
    }
  });

  // Add Ctrl+G keybinding for "Go to Line"
  editor.addAction({
    id: 'go-to-line',
    label: 'Go to Line',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.gotoLine', null);
    }
  });

  // Setup gutter selection handler for line highlighting (single-click) and drag selection
  setupGutterSelectionHandler(editor, handleEditorStartFromLine);
}

// Handle Monaco main viewer mount
function handleMonacoMainViewerMount(editor: Monaco.editor.IStandaloneCodeEditor) {
  monacoMainViewerRef.value = editor;
  updateMainViewerDecoration();
  setupGutterSelectionHandler(editor);

  // Add Ctrl+G keybinding for "Go to Line"
  editor.addAction({
    id: 'go-to-line',
    label: 'Go to Line',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG],
    run: (ed) => {
      ed.trigger('keyboard', 'editor.action.gotoLine', null);
    }
  });
}

// Update selection decorations in Monaco editor
function updateSelectionDecorations(editor: Monaco.editor.IStandaloneCodeEditor) {
  const existingDecorations = editorDecorationsMap.get(editor) || [];

  if (!selectionStart.value || !selectionEnd.value) {
    // Clear selection decorations
    const newDecorations = editor.deltaDecorations(existingDecorations, []);
    editorDecorationsMap.set(editor, newDecorations);
    return;
  }

  const start = Math.min(selectionStart.value, selectionEnd.value);
  const end = Math.max(selectionStart.value, selectionEnd.value);

  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];
  for (let line = start; line <= end; line++) {
    decorations.push({
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: 'monaco-selected-gcode-line',
        glyphMarginClassName: 'monaco-selected-gcode-glyph'
      }
    });
  }

  const newDecorations = editor.deltaDecorations(existingDecorations, decorations);
  editorDecorationsMap.set(editor, newDecorations);
}

// Update selection decorations on all active editors
function updateAllSelectionDecorations() {
  if (monacoMainViewerRef.value) {
    updateSelectionDecorations(monacoMainViewerRef.value);
  }
  if (monacoViewerRef.value) {
    updateSelectionDecorations(monacoViewerRef.value);
  }
  if (monacoEditorRef.value) {
    updateSelectionDecorations(monacoEditorRef.value);
  }
}

// Update store with selected lines and sync decorations to all editors
function updateSelectedLinesInStore() {
  if (!selectionStart.value || !selectionEnd.value) {
    store.clearSelectedGCodeLines();
    updateAllSelectionDecorations();
    return;
  }

  const start = Math.min(selectionStart.value, selectionEnd.value);
  const end = Math.max(selectionStart.value, selectionEnd.value);
  const lines = new Set<number>();
  for (let i = start; i <= end; i++) {
    lines.add(i);
  }
  store.setSelectedGCodeLines(lines);
  // Update decorations on all editors (ensures main viewer updates when selection is from modal)
  updateAllSelectionDecorations();
}

// Get line number from Y coordinate
function getLineNumberFromY(editor: Monaco.editor.IStandaloneCodeEditor, clientY: number): number | null {
  const editorDom = editor.getDomNode();
  if (!editorDom) return null;

  const rect = editorDom.getBoundingClientRect();
  const relativeY = clientY - rect.top;

  const scrollTop = editor.getScrollTop();
  const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);

  const lineNumber = Math.floor((relativeY + scrollTop) / lineHeight) + 1;
  const model = editor.getModel();
  if (!model) return null;

  return Math.max(1, Math.min(lineNumber, model.getLineCount()));
}

// Setup gutter selection handler for mouse and touch
function setupGutterSelectionHandler(editor: Monaco.editor.IStandaloneCodeEditor, onDoubleClick?: (lineNumber: number) => void) {
  let currentEditor = editor;
  const handleDoubleClick = onDoubleClick || ((lineNumber: number) => store.requestStartFromLine(lineNumber));

  // Handler for mouse move during drag
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.value) return;

    const lineNumber = getLineNumberFromY(currentEditor, e.clientY);
    if (lineNumber && lineNumber !== selectionEnd.value) {
      selectionEnd.value = lineNumber;
      updateSelectionDecorations(currentEditor);
      updateSelectedLinesInStore();
    }
  };

  // Handler for mouse up
  const handleMouseUp = () => {
    if (isDragging.value) {
      isDragging.value = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  };

  // Mouse down - start selection
  editor.onMouseDown((e: Monaco.editor.IEditorMouseEvent) => {
    // Only handle clicks on line number gutter
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
      // Click elsewhere clears selection
      if (selectionStart.value !== null) {
        selectionStart.value = null;
        selectionEnd.value = null;
        isDragging.value = false;
        updateSelectionDecorations(editor);
        updateSelectedLinesInStore();
      }
      return;
    }

    const lineNumber = e.target.position?.lineNumber;
    if (!lineNumber) return;

    isDragging.value = true;
    selectionStart.value = lineNumber;
    selectionEnd.value = lineNumber;
    updateSelectionDecorations(editor);
    updateSelectedLinesInStore();

    // Add document-level listeners for drag
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });

  // Double-click on gutter to open Start From Line dialog
  editor.onMouseDown((e: Monaco.editor.IEditorMouseEvent) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return;
    if (e.event.detail !== 2) return; // Only handle double-click (detail === 2)

    const lineNumber = e.target.position?.lineNumber;
    if (!lineNumber) return;

    handleDoubleClick(lineNumber);
  });

  // Touch support - add event listeners to gutter element
  const editorDom = editor.getDomNode();
  if (editorDom) {
    const gutterElement = editorDom.querySelector('.margin-view-overlays');
    if (gutterElement) {
      // Double-tap detection state
      let lastTapTime = 0;
      let lastTapLine: number | null = null;
      let multiTouchActive = false;
      const DOUBLE_TAP_DELAY = 300; // ms

      gutterElement.addEventListener('touchstart', (e: Event) => {
        const touchEvent = e as TouchEvent;

        // Multi-touch detected - cancel any double-tap detection and mark as multi-touch
        if (touchEvent.touches.length > 1) {
          multiTouchActive = true;
          lastTapTime = 0;
          lastTapLine = null;
          isDragging.value = false;
          return;
        }

        // If multi-touch was just active, ignore this single touch (finger lifting from pinch/zoom)
        if (multiTouchActive) {
          return;
        }

        const touch = touchEvent.touches[0];
        const lineNumber = getLineNumberFromY(editor, touch.clientY);
        if (!lineNumber) return;

        const now = Date.now();

        // Check for double-tap on same line
        if (now - lastTapTime < DOUBLE_TAP_DELAY && lastTapLine === lineNumber) {
          // Double-tap detected - open Start From Line dialog
          handleDoubleClick(lineNumber);
          lastTapTime = 0;
          lastTapLine = null;
          e.preventDefault();
          return;
        }

        // Record this tap for potential double-tap
        lastTapTime = now;
        lastTapLine = lineNumber;

        isDragging.value = true;
        selectionStart.value = lineNumber;
        selectionEnd.value = lineNumber;
        updateSelectionDecorations(editor);
        updateSelectedLinesInStore();
        e.preventDefault();
      }, { passive: false });

      gutterElement.addEventListener('touchmove', (e: Event) => {
        if (!isDragging.value) return;
        const touchEvent = e as TouchEvent;

        // Multi-touch during move - cancel selection
        if (touchEvent.touches.length > 1) {
          multiTouchActive = true;
          lastTapTime = 0;
          lastTapLine = null;
          isDragging.value = false;
          return;
        }

        // If user moves finger, cancel double-tap detection
        lastTapTime = 0;
        lastTapLine = null;

        const touch = touchEvent.touches[0];
        const lineNumber = getLineNumberFromY(editor, touch.clientY);
        if (lineNumber) {
          selectionEnd.value = lineNumber;
          updateSelectionDecorations(editor);
          updateSelectedLinesInStore();
        }
        e.preventDefault();
      }, { passive: false });

      gutterElement.addEventListener('touchend', (e: Event) => {
        const touchEvent = e as TouchEvent;

        // Reset multi-touch flag when all fingers are lifted
        if (touchEvent.touches.length === 0) {
          multiTouchActive = false;
        }

        isDragging.value = false;
      });
    }
  }
}

// Helper to apply decorations to a Monaco editor
function applyLineDecorations(
  editor: Monaco.editor.IStandaloneCodeEditor,
  existingDecorations: string[],
  currentLine: number
): string[] {
  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];

  // Gray out completed lines (all lines before current)
  if (currentLine > 1) {
    decorations.push({
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: currentLine - 1, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: 'monaco-completed-line'
      }
    });
  }

  // Current line with arrow indicator
  decorations.push({
    range: { startLineNumber: currentLine, startColumn: 1, endLineNumber: currentLine, endColumn: 1 },
    options: {
      isWholeLine: true,
      className: 'monaco-current-line',
      glyphMarginClassName: 'monaco-current-line-glyph',
      linesDecorationsClassName: 'monaco-current-line-arrow'
    }
  });

  return editor.deltaDecorations(existingDecorations, decorations);
}

// Update current line decoration in modal viewer
function updateCurrentLineDecoration() {
  const editor = monacoViewerRef.value;
  if (!editor || !isProgramRunning.value) {
    if (editor && currentLineDecorations.value.length > 0) {
      currentLineDecorations.value = editor.deltaDecorations(currentLineDecorations.value, []);
    }
    return;
  }

  const currentLine = completedUpTo.value;
  if (currentLine > 0) {
    currentLineDecorations.value = applyLineDecorations(editor, currentLineDecorations.value, currentLine);

    // Auto-scroll to current line if enabled
    if (autoScrollModal.value) {
      editor.revealLineInCenter(currentLine);
    }
  }
}

// Update current line decoration in main viewer
function updateMainViewerDecoration() {
  const editor = monacoMainViewerRef.value;
  if (!editor || !isProgramRunning.value) {
    if (editor && mainViewerLineDecorations.value.length > 0) {
      mainViewerLineDecorations.value = editor.deltaDecorations(mainViewerLineDecorations.value, []);
    }
    return;
  }

  const currentLine = completedUpTo.value;
  if (currentLine > 0) {
    mainViewerLineDecorations.value = applyLineDecorations(editor, mainViewerLineDecorations.value, currentLine);

    // Auto-scroll to current line if enabled
    if (autoScrollGcode.value) {
      editor.revealLineInCenter(currentLine);
    }
  }
}

const editorLineCount = computed(() => {
  return editableGcode.value.split('\n').length;
});

const normalizedSenderStatus = computed(() => (props.senderStatus || 'idle').toLowerCase());
const isSenderIdle = computed(() => normalizedSenderStatus.value === 'idle');

// Messages to filter from terminal display
// These are still broadcast to clients but hidden from terminal history
const TERMINAL_FILTERED_MESSAGES = [
  '$NCSENDER_'
];

function shouldFilterFromTerminal(message: string): boolean {
  if (typeof message !== 'string') return false;
  return TERMINAL_FILTERED_MESSAGES.some(filterTerm => message.startsWith(filterTerm));
}

// Filter console lines to hide job-runner chatter but show probing commands
// Also filter out $NCSENDER_ commands from terminal display
const terminalLines = computed(() => (props.lines || []).filter(l => {
  if (l?.sourceId === 'job') return false;
  if (shouldFilterFromTerminal(l?.message)) return false;
  return true;
}));

// Plugin Tools state
const toolMenuItems = ref<Array<{ pluginId: string; label: string; clientOnly?: boolean }>>([]);
const loadingTools = ref(false);

// G-Code loading state
const gcodeLoading = ref(false);
const gcodeLoadingProgress = ref(0);
const gcodeLoadingMessage = ref('');
const executingTool = ref<string | null>(null);

// G-code viewer state
const totalLines = computed(() => {
  const count = store.gcodeLineCount?.value ?? 0;
  if (count > 0) return count;
  // Fallback to in-memory content if IDB failed
  if (store.gcodeContent.value) {
    const arr = store.gcodeContent.value.split('\n');
    while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop();
    return arr.length;
  }
  return 0;
});

const storageMode = computed(() => (isIDBEnabled() ? 'IndexedDB' : 'Memory'));
const completedUpTo = computed(() => {
  // Use currentLine from jobLoaded - this matches what Job Progress displays
  const val = store.jobLoaded.value?.currentLine ?? 0;
  return val;
});
const isProgramRunning = computed(() => (store.jobLoaded.value?.status === 'running'));

// Cache for split lines to avoid repeated splitting
let cachedSplitLines: string[] | null = null;
let cachedContentRef: string | null = null;

const gcodeLines = computed(() => {
  const content = store.gcodeContent.value;
  if (!content) {
    cachedSplitLines = null;
    cachedContentRef = null;
    return null;
  }

  // Return cached split if content hasn't changed
  if (cachedSplitLines && cachedContentRef === content) {
    return cachedSplitLines;
  }

  // Split and cache for subsequent accesses
  const arr = content.split('\n');
  while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop();
  cachedSplitLines = arr;
  cachedContentRef = content;
  return arr;
});

function getGcodeText(index: number) {
  const lines = gcodeLines.value;
  return lines ? lines[index] ?? '' : '';
}

async function scrollToLineCentered(lineNumber: number) {
  // Use Monaco Editor for main viewer
  const editor = monacoMainViewerRef.value;
  if (editor && lineNumber > 0) {
    editor.revealLineInCenter(lineNumber);
    return;
  }
}

// Throttle auto-scroll to reduce flickering from frequent updates
let scrollThrottleTimer: number | null = null;
let pendingScrollLine: number | null = null;

// Throttled completed line state to reduce re-renders
const throttledCompletedUpTo = ref(0);
let completedThrottleTimer: number | null = null;
let pendingCompletedUpTo: number = 0;
let lastValidCompletedUpTo: number = 0;

watch(completedUpTo, (val) => {
  // If currentLine dropped significantly (more than 10 lines), job was restarted
  if (val < lastValidCompletedUpTo - 10) {
    lastValidCompletedUpTo = 0;
    throttledCompletedUpTo.value = 0;
    pendingCompletedUpTo = 0;
  }

  // Gate: Never allow completedUpTo to go backwards (small fluctuations)
  if (val < lastValidCompletedUpTo) {
    return;
  }

  // Update last valid value
  lastValidCompletedUpTo = val;

  // Always store the latest values
  pendingScrollLine = val;
  pendingCompletedUpTo = val;

  // Throttle completed state updates to reduce class recalculations
  if (completedThrottleTimer === null) {
    completedThrottleTimer = window.setTimeout(() => {
      completedThrottleTimer = null;
      // Use the latest pending value, not the stale closure value
      throttledCompletedUpTo.value = pendingCompletedUpTo;
      // Update Monaco decorations for both viewers
      updateCurrentLineDecoration();
      updateMainViewerDecoration();
    }, 200);
  }

  // Throttle scroll updates to every 300ms to reduce bouncing
  if (scrollThrottleTimer !== null) return;

  scrollThrottleTimer = window.setTimeout(() => {
    scrollThrottleTimer = null;
    // Use the latest pending value
    const lineToScroll = pendingScrollLine;
    if (lineToScroll === null) return;

    // Only update main view if modal is NOT open (reduce background work)
    if (!showGcodeModal.value && activeTab.value === 'gcode-preview' && autoScrollGcode.value && isProgramRunning.value) {
      scrollToLineCentered(lineToScroll);
    }
    // Auto-scroll modal if open and auto-scroll enabled (only when running, viewer is shown)
    if (showGcodeModal.value && autoScrollModal.value && isProgramRunning.value) {
      scrollToModalLine(lineToScroll);
    }
  }, 300);
});

watch(isProgramRunning, async (running) => {
  if (running) {
    // If modal is open with unsaved changes when job starts, discard silently
    if (showGcodeModal.value && hasUnsavedChanges.value) {
      editableGcode.value = '';
      hasUnsavedChanges.value = false;
    }

    const sourceId = store.jobLoaded.value?.sourceId;

    // Auto-switch tabs based on job source
    // - probing jobs switch to Terminal tab
    // - job jobs switch to G-Code Preview tab
    if (sourceId === 'probing') {
      if (activeTab.value !== 'terminal') {
        activeTab.value = 'terminal';
      }
    } else if (sourceId === 'job' || !sourceId) {
      if (activeTab.value !== 'gcode-preview') {
        activeTab.value = 'gcode-preview';
      }
    }

    if (autoScrollGcode.value && activeTab.value === 'gcode-preview') {
      scrollToLineCentered(completedUpTo.value);
    }
  } else {
    // Clear Monaco decorations when program stops
    updateCurrentLineDecoration();
    updateMainViewerDecoration();
  }
});

onMounted(() => {
  // Listen for G-code loading events
  api.on('gcode-updated', (data: any) => {
    if (data?.filename && !data?.content) {
      // Metadata received, show loading
      gcodeLoading.value = true;
      gcodeLoadingMessage.value = 'Downloading G-code...';
      gcodeLoadingProgress.value = 0;
    }
  });

  api.on('gcode-download-progress', (progress: { percent: number }) => {
    if (gcodeLoading.value) {
      gcodeLoadingProgress.value = Math.round(progress.percent);
    }
  });

  api.on('gcode-content-ready', () => {
    // Download complete, hide loading
    gcodeLoadingProgress.value = 100;
    setTimeout(() => {
      gcodeLoading.value = false;
    }, 500);
  });

  nextTick(() => {
    if (isProgramRunning.value && autoScrollGcode.value) {
      scrollToLineCentered(completedUpTo.value);
    }
  });
});

watch(totalLines, async (newVal, oldVal) => {
  // Auto-switch to G-Code Preview tab when new file is loaded
  if (newVal > 0 && newVal !== oldVal) {
    activeTab.value = 'gcode-preview';
  }
});

watch(activeTab, async (tab) => {
  if (tab === 'terminal') {
    await nextTick();
    measureTerminalRowHeight();
    if (autoScroll.value && scrollerRef.value) {
      scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
    }
  }
});

// Reset cross-out and scroll to top when user closes Job Progress panel (status changes to null)
watch(() => store.jobLoaded.value?.status, async (val, oldVal) => {
  if (oldVal && (oldVal === 'running' || oldVal === 'paused' || oldVal === 'stopped' || oldVal === 'completed') && val === null) {
    // Reset the completed line gate when job ends
    lastValidCompletedUpTo = 0;
    throttledCompletedUpTo.value = 0;
    pendingCompletedUpTo = 0;

    // Scroll Monaco editor to top
    await nextTick();
    monacoMainViewerRef.value?.revealLine(1);
  }

  // Reset gate when a new job starts
  if (val === 'running' && oldVal !== 'running') {
    lastValidCompletedUpTo = 0;
    throttledCompletedUpTo.value = 0;
    pendingCompletedUpTo = 0;
  }
});

// Watch for selected lines changes from visualizer (segment click)
// and sync the Monaco editor selection + scroll
watch(() => store.selectedGCodeLines.value, (selectedLines) => {
  const editor = monacoMainViewerRef.value;
  if (!editor) return;

  // Check if selection was changed from visualizer (not from gutter click)
  // by checking if the local selectionStart matches the store
  const storeHasSelection = selectedLines.size > 0;
  const localHasSelection = selectionStart.value !== null;

  if (storeHasSelection) {
    const lines = Array.from(selectedLines).sort((a, b) => a - b);
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];

    // Only update local state if it doesn't match (i.e., change came from visualizer)
    if (!localHasSelection || selectionStart.value !== firstLine || selectionEnd.value !== lastLine) {
      // Switch to G-Code Preview tab if not already active
      if (activeTab.value !== 'gcode-preview') {
        activeTab.value = 'gcode-preview';
      }

      selectionStart.value = firstLine;
      selectionEnd.value = lastLine;
      updateSelectionDecorations(editor);

      // Scroll to center the selection
      const middleLine = Math.floor((firstLine + lastLine) / 2);
      editor.revealLineInCenter(middleLine);
    }
  } else if (!storeHasSelection && localHasSelection) {
    // Selection was cleared from visualizer
    selectionStart.value = null;
    selectionEnd.value = null;
    updateSelectionDecorations(editor);
  }
}, { deep: true });

const copyAllTerminalContent = async () => {
  try {
    const allLines = terminalLines.value
      .map(line => line.message)
      .join('\n');

    // Try modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(allLines);
    } else {
      // Fallback for older browsers or Electron
      const textarea = document.createElement('textarea');
      textarea.value = allLines;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  } catch (error) {
    console.error('Failed to copy terminal content:', error);
    alert('Failed to copy terminal content');
  }
};

const clearTerminal = () => {
  emit('clear');
};

const sendCommand = async () => {
  if (!commandToSend.value || !commandToSend.value.trim()) return;

  const commands = commandToSend.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (commands.length === 0) {
    commandToSend.value = '';
    return;
  }

  for (const command of commands) {
    try {
      await store.addToHistory(command);
    } catch (error) {
      console.error('Failed to append command to history:', error);
    }

    try {
      await api.sendCommandViaWebSocket({
        command,
        displayCommand: command,
        meta: {
          sourceId: 'client'
        }
      });
    } catch (error) {
      console.error('Failed to send console command via WebSocket:', error);
    }
  }

  commandToSend.value = '';
  historyIndex.value = -1;
  currentInput.value = '';
};

const sendQuickCommand = async (command: string) => {
  if (!command) return;

  try {
    await store.addToHistory(command);
  } catch (error) {
    console.error('Failed to append command to history:', error);
  }

  try {
    await api.sendCommandViaWebSocket({
      command,
      displayCommand: command,
      meta: {
        sourceId: 'client'
      }
    });
  } catch (error) {
    console.error('Failed to send quick command via WebSocket:', error);
  }
};

const loadCommandHistory = async () => {
  // Use pre-loaded command history if available
  const preloaded = getCommandHistoryFromInit();
  if (preloaded && preloaded.length > 0) {
    commandHistory.value = preloaded;
    return;
  }
  // Fallback to fetching from API
  try {
    commandHistory.value = await api.getCommandHistory();
  } catch (error) {
    console.error('Failed to load command history:', error);
  }
};

const handleKeyDown = (event: KeyboardEvent) => {
  const target = event.target as HTMLTextAreaElement | HTMLInputElement | null;
  if (!target) return;

  if (event.key === 'Enter' && !(event.shiftKey || event.altKey) && !(event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendCommand();
    return;
  }

  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendCommand();
    return;
  }
  if (event.key === 'Enter' && event.shiftKey) {
    // Allow manual newline insertion
    return;
  }

  if (event.key === 'ArrowUp') {
    const caretAtStart = target.selectionStart === 0 && target.selectionEnd === 0;
    if (!caretAtStart || target.value.includes('\n')) {
      return;
    }

    event.preventDefault();
    if (commandHistory.value.length === 0) return;

    if (historyIndex.value === -1) {
      currentInput.value = commandToSend.value;
      historyIndex.value = commandHistory.value.length - 1;
    } else if (historyIndex.value > 0) {
      historyIndex.value--;
    }

    commandToSend.value = commandHistory.value[historyIndex.value];
    nextTick(() => {
      target.selectionStart = target.selectionEnd = target.value.length;
    });
  } else if (event.key === 'ArrowDown') {
    const caretAtEnd = target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
    if (!caretAtEnd || target.value.includes('\n')) {
      return;
    }

    event.preventDefault();
    if (historyIndex.value === -1) return;

    if (historyIndex.value < commandHistory.value.length - 1) {
      historyIndex.value++;
      commandToSend.value = commandHistory.value[historyIndex.value];
    } else {
      historyIndex.value = -1;
      commandToSend.value = currentInput.value;
    }

    nextTick(() => {
      target.selectionStart = target.selectionEnd = target.value.length;
    });
  }
};

const navigateHistory = (direction: 'up' | 'down') => {
  if (direction === 'up') {
    if (commandHistory.value.length === 0) return;

    if (historyIndex.value === -1) {
      currentInput.value = commandToSend.value;
      historyIndex.value = commandHistory.value.length - 1;
    } else if (historyIndex.value > 0) {
      historyIndex.value--;
    }

    commandToSend.value = commandHistory.value[historyIndex.value];
  } else if (direction === 'down') {
    if (historyIndex.value === -1) return;

    if (historyIndex.value < commandHistory.value.length - 1) {
      historyIndex.value++;
      commandToSend.value = commandHistory.value[historyIndex.value];
    } else {
      historyIndex.value = -1;
      commandToSend.value = currentInput.value;
    }
  }
};

const sendSpindleCW = () => {
  sendQuickCommand(`M3 S${spindleRPM.value}`);
};

const sendSpindleCCW = () => {
  sendQuickCommand(`M4 S${spindleRPM.value}`);
};

let unsubscribeHistory;
let unsubscribePluginsChanged;

const appendCommandToHistory = (command) => {
  if (!command) return;
  const last = commandHistory.value[commandHistory.value.length - 1];
  if (last !== command) {
    commandHistory.value.push(command);
    // Mirror server-side cap of 200 entries
    if (commandHistory.value.length > 200) {
      commandHistory.value.splice(0, commandHistory.value.length - 200);
    }
  }
};

// Load command history on component mount and sync when other clients submit commands
onMounted(() => {
  loadCommandHistory();
  unsubscribeHistory = store.onHistoryAppended((event) => {
    if (event?.command) {
      appendCommandToHistory(event.command);
    }
  });

  // Listen for plugin tool changes from WebSocket
  unsubscribePluginsChanged = api.on('plugins:tools-changed', () => {
    // Reload tool menu items when any plugin is enabled/disabled/reloaded
    loadToolMenuItems();
  });
});

onBeforeUnmount(() => {
  if (typeof unsubscribeHistory === 'function') {
    unsubscribeHistory();
    unsubscribeHistory = undefined;
  }
  if (typeof unsubscribePluginsChanged === 'function') {
    unsubscribePluginsChanged();
    unsubscribePluginsChanged = undefined;
  }
});

const getStatusIcon = (line) => {
  if (line.status === 'success') {
    return '<svg class="emoji-icon"><use href="#emoji-success"></use></svg>';
  } else if (line.status === 'error' || line.status === 'blocked') {
    return '<svg class="emoji-icon"><use href="#emoji-error"></use></svg>';
  } else if (line.status === 'pending') {
    return '<span class="spinner"></span>';
  } else if (line.type === 'response') {
    return '<svg class="emoji-icon"><use href="#emoji-info"></use></svg>';
  }
  return '';
};

// Escape HTML to prevent XSS
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;');
};

// Highlight G-code syntax in terminal messages
const highlightGcode = (item: { message: string; type: string }): string => {
  // For response type, only highlight comments (parentheses content)
  if (item.type !== 'command') {
    let text = item.message;
    const comments: string[] = [];
    text = text.replace(/(\([^)]*\))/g, (match) => {
      comments.push(match);
      return `\x00COMMENT${comments.length - 1}\x00`;
    });
    let html = escapeHtml(text);
    html = html.replace(/\x00COMMENT(\d+)\x00/g, (_, idx) => {
      return `<span class="gc-comment">${escapeHtml(comments[parseInt(idx)])}</span>`;
    });
    return html;
  }

  let text = item.message;

  // Extract comments from raw text BEFORE HTML escaping
  // (to avoid matching semicolons in HTML entities like &lt;)
  const comments: string[] = [];
  text = text.replace(/(\([^)]*\))/g, (match) => {
    comments.push(match);
    return `\x00COMMENT${comments.length - 1}\x00`;
  });
  text = text.replace(/(;.*)/g, (match) => {
    comments.push(match);
    return `\x00COMMENT${comments.length - 1}\x00`;
  });

  // Now escape HTML on the non-comment parts
  let html = escapeHtml(text);

  // G0 rapid motion (orange bold)
  html = html.replace(/\b([Gg]0*)(?=\s|$|[A-Za-z])/g, '<span class="gc-rapid">$1</span>');

  // G1/G2/G3 cutting motion (blue bold)
  html = html.replace(/\b([Gg][1-3])\b/g, '<span class="gc-cutting">$1</span>');

  // Other G codes (purple)
  html = html.replace(/\b([Gg]\d+\.?\d*)/g, (match, p1) => {
    // Skip if already wrapped
    if (match.includes('gc-')) return match;
    return `<span class="gc-g">${p1}</span>`;
  });

  // M codes (yellow)
  html = html.replace(/\b([Mm]\d+)/g, '<span class="gc-m">$1</span>');

  // Tool number (teal)
  html = html.replace(/\b([Tt]\d+)/g, '<span class="gc-tool">$1</span>');

  // Spindle speed (orange-brown)
  html = html.replace(/\b([Ss]\d+\.?\d*)/g, '<span class="gc-spindle">$1</span>');

  // Feed rate (light green)
  html = html.replace(/\b([Ff]\d+\.?\d*)/g, '<span class="gc-feed">$1</span>');

  // X coordinate (red)
  html = html.replace(/\b([Xx]-?\d+\.?\d*)/g, '<span class="gc-x">$1</span>');

  // Y coordinate (teal)
  html = html.replace(/\b([Yy]-?\d+\.?\d*)/g, '<span class="gc-y">$1</span>');

  // Z coordinate (blue)
  html = html.replace(/\b([Zz]-?\d+\.?\d*)/g, '<span class="gc-z">$1</span>');

  // Other axes A B C I J K (light blue)
  html = html.replace(/\b([AaBbCcIiJjKk]-?\d+\.?\d*)/g, '<span class="gc-axis">$1</span>');

  // Line numbers N (gray)
  html = html.replace(/\b([Nn]\d+)/g, '<span class="gc-line">$1</span>');

  // Restore comments (with HTML escaping and styling)
  html = html.replace(/\x00COMMENT(\d+)\x00/g, (_, idx) => {
    return `<span class="gc-comment">${escapeHtml(comments[parseInt(idx)])}</span>`;
  });

  return html;
};

watch(autoScroll, (newValue) => {
  if (newValue) {
    nextTick(() => {
      if (scrollerRef.value) {
        scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
      }
    });
  }
});

const terminalRowHeight = ref(24);
function measureTerminalRowHeight() {
  const el = consoleOutput.value;
  if (!el) return;
  const temp = document.createElement('article');
  temp.className = 'console-line';
  temp.style.visibility = 'hidden';
  temp.innerHTML = '<span class="timestamp">00:00 </span><span class="message">Sample</span>';
  el.appendChild(temp);
  const h = temp.getBoundingClientRect().height;
  el.removeChild(temp);
  if (h && h > 0) terminalRowHeight.value = Math.ceil(h);
}

let stopAutoScrollBindings: (() => void) | undefined;

onMounted(async () => {
  await nextTick();
  measureTerminalRowHeight();
  // Auto-scroll to bottom on mount
  if (autoScroll.value && scrollerRef.value) {
    scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
  }
  stopAutoScrollBindings = store.startAutoScrollBindings(async (evt) => {
    // Skip auto-scroll for job events (they're not shown in terminal)
    if (evt?.sourceId === 'job') return;

    if (activeTab.value === 'terminal' && autoScroll.value && scrollerRef.value) {
      await nextTick();
      scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
    }

    // Also auto-scroll modal if open
    if (showTerminalModal.value && autoScrollTerminalModal.value && modalTerminalScrollerRef.value) {
      await nextTick();
      modalTerminalScrollerRef.value.scrollToItem(terminalLines.value.length - 1);
    }
  });
});

onBeforeUnmount(() => {
  if (typeof stopAutoScrollBindings === 'function') {
    try { stopAutoScrollBindings(); } catch {}
    stopAutoScrollBindings = undefined;
  }
});

watch(() => props.lines, async () => {
  if (activeTab.value === 'terminal' && autoScroll.value) {
    await nextTick();
    if (scrollerRef.value) {
      scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
    }
  }
}, { deep: true });

// Load plugin tool menu items
const loadToolMenuItems = async () => {
  loadingTools.value = true;
  try {
    toolMenuItems.value = await fetchToolMenuItems();
  } catch (error) {
    console.error('Failed to load plugin tool menu items:', error);
  } finally {
    loadingTools.value = false;
  }
};

// Execute a tool menu item
const executeToolMenuItem = async (item: { pluginId: string; label: string }) => {
  const key = `${item.pluginId}-${item.label}`;
  executingTool.value = key;

  try {
    await runToolMenuItem(item.pluginId, item.label, { clientId: api.clientId });
  } catch (error: any) {
    console.error('Failed to execute tool menu item:', error);
    alert(error?.message || 'Failed to execute tool');
  } finally {
    executingTool.value = null;
  }
};

// Watch for Tools tab activation to load menu items
watch(activeTab, (newTab) => {
  if (newTab === 'tools' && toolMenuItems.value.length === 0) {
    loadToolMenuItems();
  }
});

// Watch modal open/close to sync main view and load editable content
watch(showGcodeModal, async (isOpen) => {
  if (isOpen) {
    // Modal opened - load editable content if not running
    if (!isProgramRunning.value) {
      let content = '';
      if (gcodeLines.value) {
        content = gcodeLines.value.join('\n');
      } else {
        const lines = await getLinesRangeFromIDB(1, totalLines.value);
        content = lines.join('\n');
      }
      originalGcode.value = content;
      editableGcode.value = content;
      hasUnsavedChanges.value = false;
    }
    // Reset find state
    findQuery.value = '';
    replaceQuery.value = '';
    findMatches.value = [];
    currentFindIndex.value = 0;
  } else {
    // Modal closed - sync main view to current position if program is running
    await nextTick();
    if (activeTab.value === 'gcode-preview' && autoScrollGcode.value && isProgramRunning.value) {
      scrollToLineCentered(completedUpTo.value);
    }
    // Clear editable content
    originalGcode.value = '';
    editableGcode.value = '';
    hasUnsavedChanges.value = false;
    // Sync decorations to main viewer when modal closes (selection persists for visualizer)
    if (monacoMainViewerRef.value && selectionStart.value !== null && selectionEnd.value !== null) {
      updateSelectionDecorations(monacoMainViewerRef.value);
      // Scroll to center of selection
      const middleLine = Math.floor((selectionStart.value + selectionEnd.value) / 2);
      monacoMainViewerRef.value.revealLineInCenter(middleLine);
    }
  }
});

// Watch terminal modal open to auto-scroll to bottom
watch(showTerminalModal, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    if (autoScrollTerminalModal.value && modalTerminalScrollerRef.value) {
      modalTerminalScrollerRef.value.scrollToItem(terminalLines.value.length - 1);
    }
  }
});

// G-Code Modal Functions
const searchResultText = computed(() => {
  if (!searchQuery.value) return '';
  if (searchResults.value.length === 0) return 'No matches';
  return `${currentSearchIndex.value + 1} of ${searchResults.value.length}`;
});

function onSearchInput() {
  if (!searchQuery.value) {
    searchResults.value = [];
    currentSearchIndex.value = 0;
    return;
  }

  const query = searchQuery.value.toLowerCase();
  const results: number[] = [];

  for (let i = 0; i < totalLines.value; i++) {
    const text = getGcodeText(i).toLowerCase();
    if (text.includes(query)) {
      results.push(i);
    }
  }

  searchResults.value = results;
  currentSearchIndex.value = 0;

  if (results.length > 0) {
    scrollToModalLine(results[0]);
  }
}

function scrollToModalLine(lineIndex: number) {
  const editor = monacoViewerRef.value;
  if (editor) {
    // Monaco uses 1-based line numbers
    const lineNumber = lineIndex + 1;
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber, column: 1 });
  }
}

function goToPreviousSearchResult() {
  if (searchResults.value.length === 0) return;
  currentSearchIndex.value = (currentSearchIndex.value - 1 + searchResults.value.length) % searchResults.value.length;
  scrollToModalLine(searchResults.value[currentSearchIndex.value]);
}

function goToNextSearchResult() {
  if (searchResults.value.length === 0) return;
  currentSearchIndex.value = (currentSearchIndex.value + 1) % searchResults.value.length;
  scrollToModalLine(searchResults.value[currentSearchIndex.value]);
}

function clearSearch() {
  searchQuery.value = '';
  searchResults.value = [];
  currentSearchIndex.value = 0;
}

// Find & Replace computed
const findResultText = computed(() => {
  if (!findQuery.value) return '';
  if (findMatches.value.length === 0) return 'No results';
  return `${currentFindIndex.value + 1} of ${findMatches.value.length}`;
});

// Find & Replace functions
function onFindInput() {
  performFind();
}

function performFind() {
  const editor = monacoEditorRef.value || monacoViewerRef.value;
  if (!editor || !findQuery.value) {
    findMatches.value = [];
    currentFindIndex.value = 0;
    return;
  }

  const model = editor.getModel();
  if (!model) return;

  try {
    let searchString = findQuery.value;

    // Build search options
    const matches = model.findMatches(
      searchString,
      true, // searchOnlyEditableRange
      findUseRegex.value, // isRegex
      findCaseSensitive.value, // matchCase
      findWholeWord.value ? 'true' : null, // wordSeparators (null = no whole word matching)
      true // captureMatches
    );

    findMatches.value = matches;
    currentFindIndex.value = 0;

    if (matches.length > 0) {
      highlightCurrentMatch(editor);
    }
  } catch (e) {
    // Invalid regex or other error
    findMatches.value = [];
    currentFindIndex.value = 0;
  }
}

function highlightCurrentMatch(editor: Monaco.editor.IStandaloneCodeEditor) {
  if (findMatches.value.length === 0) return;

  const match = findMatches.value[currentFindIndex.value];
  if (match) {
    editor.setSelection(match.range);
    editor.revealLineInCenter(match.range.startLineNumber);
  }
}

function goToNextFind() {
  const editor = monacoEditorRef.value || monacoViewerRef.value;
  if (!editor || findMatches.value.length === 0) return;

  currentFindIndex.value = (currentFindIndex.value + 1) % findMatches.value.length;
  highlightCurrentMatch(editor);
}

function goToPreviousFind() {
  const editor = monacoEditorRef.value || monacoViewerRef.value;
  if (!editor || findMatches.value.length === 0) return;

  currentFindIndex.value = (currentFindIndex.value - 1 + findMatches.value.length) % findMatches.value.length;
  highlightCurrentMatch(editor);
}

function clearFind() {
  findQuery.value = '';
  replaceQuery.value = '';
  findMatches.value = [];
  currentFindIndex.value = 0;
}

function replaceNext() {
  const editor = monacoEditorRef.value;
  if (!editor || findMatches.value.length === 0) return;

  const match = findMatches.value[currentFindIndex.value];
  if (!match) return;

  // Get replacement text (handle regex capture groups if needed)
  let replacement = replaceQuery.value;

  editor.executeEdits('replace', [{
    range: match.range,
    text: replacement
  }]);

  // Re-run find to update matches
  performFind();
}

function replaceAll() {
  const editor = monacoEditorRef.value;
  if (!editor || findMatches.value.length === 0) return;

  const model = editor.getModel();
  if (!model) return;

  // Replace all matches from end to start to preserve positions
  const edits = [...findMatches.value]
    .reverse()
    .map(match => ({
      range: match.range,
      text: replaceQuery.value
    }));

  editor.executeEdits('replace-all', edits);

  // Clear find state
  findMatches.value = [];
  currentFindIndex.value = 0;
}

function syncLineNumbersScroll() {
  if (editorTextareaRef.value && lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = editorTextareaRef.value.scrollTop;
  }
}

function promptDiscardChanges(onConfirm: () => void) {
  discardCallback.value = onConfirm;
  showDiscardDialog.value = true;
}

function handleDiscardConfirm() {
  showDiscardDialog.value = false;
  if (discardCallback.value) {
    discardCallback.value();
    discardCallback.value = null;
  }
}

function handleDiscardCancel() {
  showDiscardDialog.value = false;
  discardCallback.value = null;
}

function closeGcodeModal() {
  if (hasUnsavedChanges.value) {
    promptDiscardChanges(() => {
      editableGcode.value = '';
      hasUnsavedChanges.value = false;
      showGcodeModal.value = false;
    });
    return;
  }
  editableGcode.value = '';
  hasUnsavedChanges.value = false;
  showGcodeModal.value = false;
}

function discardChanges() {
  if (hasUnsavedChanges.value) {
    promptDiscardChanges(() => {
      // Reload original content (flag prevents change listener from re-setting hasUnsavedChanges)
      isRevertingContent.value = true;
      if (gcodeLines.value) {
        editableGcode.value = gcodeLines.value.join('\n');
      }
      // Reset after Vue updates and Monaco processes the change
      nextTick(() => {
        hasUnsavedChanges.value = false;
        isRevertingContent.value = false;
        // Re-run find if there's an active search query
        if (findQuery.value) {
          performFind();
        }
      });
    });
    return;
  }
}

function handleEditorStartFromLine(lineNumber: number) {
  if (hasUnsavedChanges.value) {
    pendingStartFromLineNumber.value = lineNumber;
    showStartFromLineConfirm.value = true;
  } else {
    showGcodeModal.value = false;
    store.requestStartFromLine(lineNumber);
  }
}

async function handleStartFromLineSaveFirst() {
  showStartFromLineConfirm.value = false;
  try {
    await commitEdit();
    showGcodeModal.value = false;
    if (pendingStartFromLineNumber.value) {
      store.requestStartFromLine(pendingStartFromLineNumber.value);
    }
  } catch {
    // Error already handled in commitEdit
  }
  pendingStartFromLineNumber.value = null;
}

function handleStartFromLineDiscard() {
  showStartFromLineConfirm.value = false;
  isRevertingContent.value = true;
  if (gcodeLines.value) {
    editableGcode.value = gcodeLines.value.join('\n');
  }
  nextTick(() => {
    hasUnsavedChanges.value = false;
    isRevertingContent.value = false;
    showGcodeModal.value = false;
    if (pendingStartFromLineNumber.value) {
      store.requestStartFromLine(pendingStartFromLineNumber.value);
    }
    pendingStartFromLineNumber.value = null;
  });
}

function handleStartFromLineCancel() {
  showStartFromLineConfirm.value = false;
  pendingStartFromLineNumber.value = null;
}

async function commitEdit() {
  try {
    const filename = store.gcodeFilename.value || 'modified.gcode';

    // Save file content directly at its path (supports nested folders)
    await api.saveGCodeFile(filename, editableGcode.value);
    await api.loadGCodeFile(filename);

    hasUnsavedChanges.value = false;
  } catch (error) {
    console.error('Failed to save G-code changes:', error);
    alert('Failed to save G-code changes. Please try again.');
  }
}
</script>

<style scoped>
/* Disable console when not connected. */
.card-disabled .console-output,
.card-disabled .console-input {
  opacity: 0.5;
  pointer-events: none;
}

/* Keep G-Code preview selectable even when disconnected */
.card-disabled .gcode-preview {
  opacity: 0.5;
  pointer-events: auto;
}

.card {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  padding: var(--gap-sm);
  box-shadow: var(--shadow-elevated);
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  min-height: 150px !important;
  height: 100%;
}

.card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-sm);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

/* Compact Tabs */
.tabs {
  display: flex;
  gap: 2px;
  flex: 1;
}

.tab-button {
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius-small) var(--radius-small) 0 0;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.85rem;
  font-weight: 500;
  position: relative;
  margin-bottom: -1px;
  min-width: 80px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tab-button:hover {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.tab-button.active {
  background: transparent;
  color: var(--color-text-primary);
  font-weight: 600;
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
}

.tab-content--locked {
  pointer-events: none;
  opacity: 0.45;
  filter: grayscale(0.2);
  transition: opacity 0.2s ease;
}

.filters {
  display: flex;
  gap: var(--gap-xs);
}

.auto-scroll-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 8px;
}

.toggle-label {
  font-size: 0.9rem;
  color: var(--color-text-secondary);
}

.toggle-switch {
  width: 46px;
  height: 26px;
  background: var(--color-surface-muted);
  border-radius: 999px;
  position: relative;
  transition: background 0.2s ease;
}

.toggle-handle {
  width: 22px;
  height: 22px;
  background: white;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s ease;
}

.auto-scroll-toggle.active .toggle-switch {
  background: var(--color-accent);
}

.auto-scroll-toggle.active .toggle-handle {
  transform: translateX(20px);
}

/* Terminal Copy Button */
.terminal-copy-button {
  position: absolute;
  top: 8px;
  right: 25px;
  z-index: 10;
  padding: 10px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.7;
  backdrop-filter: blur(4px);
}

.terminal-copy-button:hover:not(:disabled) {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
  opacity: 1;
}

.terminal-copy-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.terminal-copy-button svg {
  width: 18px;
  height: 18px;
}

/* Terminal Detach Button */
.terminal-detach-button {
  position: absolute;
  top: 8px;
  right: 70px;
  z-index: 10;
  padding: 10px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.7;
  backdrop-filter: blur(4px);
}

.terminal-detach-button:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
  opacity: 1;
}

.terminal-detach-button svg {
  width: 18px;
  height: 18px;
}

.console-output {
  background: #141414;
  border-radius: var(--radius-small);
  position: relative;
  padding: var(--gap-xs);
  display: flex;
  flex-direction: column;
  gap: var(--gap-xs);
  flex: 1;
  min-height: 0px;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  color: #bdc3c7;
  font-family: 'JetBrains Mono', monospace;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.console-output--virtual {
  display: block; /* prevent flex gap from affecting spacer/items */
  gap: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.terminal-spacer { width: 1px; height: 0; opacity: 0; }
.terminal-items { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }


.console-output * {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.console-output .timestamp,
.console-output .timestamp * {
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
  pointer-events: none !important;
}

.console-line {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  line-height: 1.35;
  padding: 2px 0;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.console-line--response {

}

.timestamp {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  min-width: 115px;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  white-space: nowrap;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

.timestamp * {
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

.timestamp :deep(.emoji-icon) {
  width: 16px;
  height: 16px;
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
  transform: translateY(-2px);
}

.message {
  flex: 1;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

/* G-code syntax highlighting - dark theme (default) */
.message :deep(.gc-comment) { color: #6A9955; font-style: italic; }
.message :deep(.gc-rapid) { color: #FF8C00; font-weight: bold; }
.message :deep(.gc-cutting) { color: #569CD6; font-weight: bold; }
.message :deep(.gc-g) { color: #C586C0; }
.message :deep(.gc-m) { color: #DCDCAA; }
.message :deep(.gc-tool) { color: #4EC9B0; }
.message :deep(.gc-spindle) { color: #CE9178; }
.message :deep(.gc-feed) { color: #B5CEA8; }
.message :deep(.gc-x) { color: #F14C4C; }
.message :deep(.gc-y) { color: #4EC9B0; }
.message :deep(.gc-z) { color: #569CD6; }
.message :deep(.gc-axis) { color: #9CDCFE; }
.message :deep(.gc-line) { color: #858585; }

/* G-code syntax highlighting - light theme */
.light-theme .message :deep(.gc-comment) { color: #008000; font-style: italic; }
.light-theme .message :deep(.gc-rapid) { color: #E67E22; font-weight: bold; }
.light-theme .message :deep(.gc-cutting) { color: #2E86C1; font-weight: bold; }
.light-theme .message :deep(.gc-g) { color: #AF00DB; }
.light-theme .message :deep(.gc-m) { color: #795E26; }
.light-theme .message :deep(.gc-tool) { color: #267F99; }
.light-theme .message :deep(.gc-spindle) { color: #A31515; }
.light-theme .message :deep(.gc-feed) { color: #098658; }
.light-theme .message :deep(.gc-x) { color: #C72828; }
.light-theme .message :deep(.gc-y) { color: #267F99; }
.light-theme .message :deep(.gc-z) { color: #2E86C1; }
.light-theme .message :deep(.gc-axis) { color: #0070C1; }
.light-theme .message :deep(.gc-line) { color: #999999; }

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 0.8rem;
}

.console-input {
  display: flex;
  gap: var(--gap-xs);
  align-items: stretch;
}

.console-input__textarea {
  flex: 1;
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  padding: 12px;
  font-size: 0.9rem;
  background: var(--color-surface);
  color: var(--color-text-primary);
  resize: none;
  height: 44px;
  min-height: 44px;
  max-height: 44px;
  font-family: inherit;
  line-height: 1.4;
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.console-input__textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

.console-input__textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.console-input__actions {
  display: flex;
  flex-direction: row;
  gap: var(--gap-xs);
  align-items: stretch;
}

.console-input .primary {
  border: none;
  border-radius: var(--radius-small);
  padding: 8px 14px;
  cursor: pointer;
  background: var(--gradient-accent);
  color: #fff;
  font-size: 1rem;
  font-weight: 500;
  min-width: 96px;
}

.console-input__actions .primary {
  width: auto;
}

/* Tab Content */
.tab-content {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  flex: 1;
  min-height: 0;
}

.placeholder-content {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-secondary);
  font-style: italic;
  font-size: 0.9rem;
}

/* G-Code Preview */
.gcode-preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: var(--gap-xs);
  position: relative;
}

/* G-Code Loading Overlay */
.gcode-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.gcode-loading-content {
  background: var(--color-surface);
  border-radius: 12px;
  padding: 24px 32px;
  min-width: 400px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.gcode-loading-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.gcode-loading-message {
  font-size: 14px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

.gcode-loading-percent {
  font-size: 32px;
  font-weight: bold;
  color: var(--color-primary);
  min-width: 80px;
  text-align: right;
}

.gcode-loading-bar-container {
  height: 24px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.gcode-loading-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%);
  transition: width 0.3s ease;
  border-radius: 12px;
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.7);
}

.gcode-footer {
  padding-top: 6px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.gcode-storage {
  margin-left: 8px;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.gcode-content {
  background: #141414;
  border-radius: var(--radius-small);
  position: relative;
  flex: 1;
  overflow: hidden;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
  contain: content;
  display: flex;
  flex-direction: column;
}

/* Main G-Code Preview Monaco Editor */
.gcode-content .monaco-main-viewer {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
}

/* Tools Tab */
.tools-tab {
  min-height: 200px;
  overflow-y: auto;
  overflow-x: hidden;
}

.tools-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--gap-sm);
  padding: var(--gap-sm);
}

.tool-button {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
  color: var(--color-text-primary);
  position: relative;
}

.tool-button:hover:not(:disabled) {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}

.tool-button:active:not(:disabled) {
  transform: translateY(0);
}

.tool-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tool-button svg {
  flex-shrink: 0;
  color: var(--color-accent);
  width: 32px;
  height: 32px;
}

.tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
}

.tool-icon :deep(svg) {
  width: 32px;
  height: 32px;
  fill: currentColor;
  color: var(--color-accent);
}

.tool-icon-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.tool-label {
  flex: 1;
  text-align: left;
  font-weight: 500;
}

.tool-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-surface-muted);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* G-Code Detach Button */
.gcode-detach-button {
  position: absolute;
  top: 8px;
  right: 25px;
  z-index: 10;
  padding: 10px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.7;
  backdrop-filter: blur(4px);
}

.gcode-detach-button:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
  opacity: 1;
}

.gcode-detach-button svg {
  width: 18px;
  height: 18px;
}

/* Modal Overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-dialog {
  background: var(--color-surface);
  border-radius: var(--radius-medium);
  box-shadow: var(--shadow-elevated);
  width: 90%;
  max-width: 1400px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
  user-select: text;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
}

.modal-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.modal-header-actions {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
}

.modal-close {
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  border-radius: var(--radius-small);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.modal-toolbar {
  display: flex;
  gap: var(--gap-sm);
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  flex-wrap: wrap;
  align-items: flex-start;
}

/* Find & Replace Container */
.find-replace-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 400px;
}

.find-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.find-input {
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  outline: none;
}

.find-input:focus {
  border-color: var(--color-accent);
}

.find-input::placeholder {
  color: var(--color-text-secondary);
}

.find-option-btn {
  padding: 6px 8px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  min-width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.find-option-btn:hover {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-color: var(--color-text-secondary);
}

.find-option-btn.active {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.find-option-btn svg {
  width: 14px;
  height: 14px;
}

.find-results {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  padding: 0 8px;
  min-width: 70px;
}

.find-nav-btn {
  padding: 6px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  height: 32px;
  width: 32px;
}

.find-nav-btn:hover:not(:disabled) {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.find-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.find-clear-btn {
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.find-clear-btn:hover {
  color: var(--color-text-primary);
}

.replace-btn {
  padding: 6px 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.15s ease;
  height: 32px;
}

.replace-btn:hover:not(:disabled) {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
}

.replace-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.replace-btn svg {
  width: 14px;
  height: 14px;
}

/* Legacy search box - kept for compatibility */
.search-box {
  flex: 1;
  min-width: 300px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
}

.search-box svg:first-child {
  color: var(--color-text-secondary);
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 0.95rem;
  outline: none;
}

.search-input::placeholder {
  color: var(--color-text-secondary);
}

.search-results {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  padding: 0 8px;
}

.search-nav {
  display: flex;
  gap: 4px;
}

.search-nav button {
  padding: 4px 6px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.search-nav button:hover:not(:disabled) {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
}

.search-nav button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.clear-search {
  padding: 4px;
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.clear-search:hover {
  color: var(--color-text-primary);
}

.modal-actions {
  display: flex;
  gap: var(--gap-xs);
  align-items: center;
}

.edit-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--gradient-accent);
  border: none;
  border-radius: var(--radius-small);
  color: white;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.edit-toggle svg {
  width: 16px;
  height: 16px;
}

.edit-toggle:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.modal-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.gcode-modal-viewer {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.gcode-editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.monaco-editor-container {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  overflow: hidden;
}

.gcode-editor-container .monaco-editor-container {
  flex: 1 1 0;
}

/* Monaco separator */
.monaco-editor-container :deep(.monaco-editor .margin-view-overlays) {
  border-right: 1px solid #3a3a3a;
}

body.theme-light .monaco-editor-container :deep(.monaco-editor .margin-view-overlays) {
  border-right: 1px solid #e0e0e0;
}

/* Monaco unified background - light theme */
body.theme-light .monaco-editor-container :deep(.monaco-editor),
body.theme-light .monaco-editor-container :deep(.monaco-editor .margin),
body.theme-light .monaco-editor-container :deep(.monaco-editor .margin-view-overlays),
body.theme-light .monaco-editor-container :deep(.monaco-editor .monaco-editor-background),
body.theme-light .monaco-editor-container :deep(.monaco-editor .inputarea.ime-input),
body.theme-light .monaco-editor-container :deep(.view-overlays),
body.theme-light .monaco-editor-container :deep(.monaco-editor .lines-content),
body.theme-light .monaco-editor-container :deep(.monaco-editor .glyph-margin),
body.theme-light .monaco-editor-container :deep(.monaco-editor .line-numbers) {
  background: #f8f8f8 !important;
}

body.theme-light .monaco-editor-container :deep(.monaco-editor .line-numbers) {
  color: #999 !important;
}

/* Monaco completed lines - grayed out */
.monaco-editor-container :deep(.monaco-completed-line) {
  opacity: 0.4;
}

/* Monaco current line highlight */
.monaco-editor-container :deep(.monaco-current-line) {
  background: rgba(255, 204, 0, 0.15) !important;
}

/* Monaco current line arrow indicator in line decorations */
.monaco-editor-container :deep(.monaco-current-line-arrow) {
  background: #ffcc00;
  width: 3px !important;
  margin-left: 3px;
}

/* Monaco glyph margin arrow */
.monaco-editor-container :deep(.monaco-current-line-glyph) {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23ffcc00' d='M4 2l8 6-8 6V2z'/%3E%3C/svg%3E") center center no-repeat;
  background-size: 12px 12px;
}

/* Light theme adjustments */
body.theme-light .monaco-editor-container :deep(.monaco-current-line-arrow) {
  background: #e6a800;
}

body.theme-light .monaco-editor-container :deep(.monaco-current-line-glyph) {
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23e6a800' d='M4 2l8 6-8 6V2z'/%3E%3C/svg%3E") center center no-repeat;
  background-size: 12px 12px;
}

/* Make line numbers clickable cursor */
.monaco-editor-container :deep(.line-numbers) {
  cursor: pointer;
}

/* Selected G-code line highlighting (for visualizer sync) */
.monaco-editor-container :deep(.monaco-selected-gcode-line) {
  background: rgba(255, 102, 0, 0.25) !important;
}

.monaco-editor-container :deep(.monaco-selected-gcode-glyph) {
  background: #ff6600;
  width: 4px !important;
  margin-left: 2px;
  border-radius: 2px;
}

/* Light theme adjustments for selected lines */
body.theme-light .monaco-editor-container :deep(.monaco-selected-gcode-line) {
  background: rgba(255, 102, 0, 0.2) !important;
}

body.theme-light .monaco-editor-container :deep(.monaco-selected-gcode-glyph) {
  background: #e65100;
}

.editor-actions {
  display: flex;
  gap: 12px;
  padding: 16px;
  justify-content: center;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.cancel-button, .commit-button {
  padding: 10px 20px;
  border: none;
  border-radius: var(--radius-small);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-button {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
}

.cancel-button:hover {
  background: var(--color-surface-elevated);
}

.commit-button {
  background: var(--gradient-accent);
  color: white;
}

.commit-button:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.commit-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.line-content :deep(mark) {
  background: yellow;
  color: black;
  padding: 1px 2px;
  border-radius: 2px;
}

/* Terminal Modal Styles */
.modal-content--terminal {
  display: flex;
  flex-direction: row;
  height: 100%;
  padding: var(--gap-md);
  gap: var(--gap-md);
}

.terminal-left-column {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.terminal-right-column {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  min-width: 0;
}

.terminal-quick-controls {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  padding: var(--gap-sm);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  height: 100%;
  overflow-y: auto;
}

.quick-control-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: var(--gradient-accent);
  border: none;
  border-radius: var(--radius-small);
  color: white;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  justify-content: flex-start;
  width: 100%;
}

.spindle-control {
  display: flex;
  align-items: stretch;
  border-radius: var(--radius-small);
  overflow: hidden;
  border: 1px solid var(--color-accent);
}

.spindle-control__btn {
  flex: 1;
  border-radius: 0;
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.3);
}

.spindle-control__select {
  background: var(--gradient-accent);
  color: white;
  border: none;
  padding: 10px 12px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 90px;
  outline: none;
}

.spindle-control__select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spindle-control__select option {
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.quick-control-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
  opacity: 0.9;
}

.quick-control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.quick-control-btn svg {
  width: 16px;
  height: 16px;
}

.quick-control-btn--danger {
  background: var(--gradient-danger, linear-gradient(135deg, #f87171 0%, #dc2626 100%));
}

.terminal-modal-viewer {
  background: #141414;
  padding: var(--gap-xs);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-small);
  overflow: hidden;
  position: relative;
}

.console-output--modal {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
  background: transparent;
}

.console-output--modal .timestamp,
.console-output--modal .timestamp * {
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
  cursor: default !important;
}

/* Terminal modal viewer text selection is handled by .console-output and global CSS */

.terminal-modal-copy-button {
  position: absolute;
  top: 8px;
  right: 28px;
  z-index: 10;
  padding: 10px;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  opacity: 0.7;
  backdrop-filter: blur(4px);
}

.terminal-modal-copy-button:hover:not(:disabled) {
  background: var(--color-surface);
  border-color: var(--color-accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
  opacity: 1;
}

.terminal-modal-copy-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.terminal-modal-copy-button svg {
  width: 18px;
  height: 18px;
}

.terminal-modal-controls {
  display: flex;
  flex-direction: column;
  padding: var(--gap-sm);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
}

.control-buttons {
  display: flex;
  gap: var(--gap-sm);
  flex-wrap: wrap;
}

.console-input--modal {
  margin: 0;
  align-items: stretch;
}

.console-input--modal .console-input__textarea {
  flex: 1;
  height: auto;
  min-height: 100px;
  max-height: 200px;
  overflow-y: auto;
}

.console-input__history-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-left: var(--gap-xs);
  margin-right: 0;
  align-self: stretch;
}

.history-btn {
  flex: 1;
  padding: 0 20px;
  background: var(--gradient-accent);
  border: none;
  border-radius: var(--radius-small);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  min-width: 50px;
}

.history-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.history-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.console-input--modal .console-input__actions {
  align-items: stretch;
}

/* Start From Line Confirmation Dialog */
.confirm-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-lg);
}

.confirm-dialog__title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.confirm-dialog__message {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.confirm-dialog__actions {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  margin-top: var(--gap-sm);
}

.confirm-dialog__actions--three {
  justify-content: center;
}

.confirm-dialog__btn {
  padding: 10px 24px;
  border-radius: var(--radius-small);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.confirm-dialog__btn--cancel {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.confirm-dialog__btn--cancel:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.confirm-dialog__btn--danger {
  background: linear-gradient(135deg, #ff6b6b, rgba(255, 107, 107, 0.8));
  color: white;
}

.confirm-dialog__btn--danger:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(255, 107, 107, 0.3);
}

.confirm-dialog__btn--primary {
  background: var(--gradient-accent);
  color: #fff;
}

.confirm-dialog__btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(26, 188, 156, 0.25);
}
</style>

<style>
body.theme-light .console-output,
body.theme-light .console-output--modal,
body.theme-light .gcode-content,
body.theme-light .gcode-modal-viewer,
body.theme-light .terminal-modal-viewer,
body.theme-light .gcode-editor {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-primary) !important;
}

body.theme-light .terminal-modal-viewer {
  border: none !important;
}

body.theme-light .console-output--modal {
  background: transparent !important;
}

body.theme-light .editor-wrapper {
  background: var(--color-surface-muted) !important;
  border-color: var(--color-border) !important;
}

body.theme-light .line-numbers {
  background: var(--color-surface) !important;
  color: #888 !important;
  border-color: var(--color-border) !important;
}

body.theme-light .line-content {
  color: var(--color-text-primary) !important;
}

body.theme-light .line-number {
  background: var(--color-surface) !important;
  color: #888 !important;
  border-color: var(--color-border) !important;
}

/* Enable text selection in terminal modal - global override */
.terminal-modal-viewer,
.terminal-modal-viewer *,
.terminal-modal-viewer .vue-recycle-scroller,
.terminal-modal-viewer .vue-recycle-scroller *,
.terminal-modal-viewer .console-line,
.terminal-modal-viewer .message {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
  cursor: text !important;
  pointer-events: auto !important;
}

/* Keep timestamps non-selectable */
.terminal-modal-viewer .timestamp,
.terminal-modal-viewer .timestamp *,
.console-output--modal .timestamp,
.console-output--modal .timestamp *,
.console-output.console-output--modal .timestamp,
.console-output.console-output--modal .timestamp * {
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
  cursor: default !important;
  pointer-events: none !important;
}
</style>

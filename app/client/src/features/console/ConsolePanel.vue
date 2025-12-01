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
                <span class="message">{{ item.message }}</span>
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
          <img v-else-if="item.icon" :src="`${api.baseUrl}/api/plugins/${item.pluginId}/icon`" class="tool-icon-img" />
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
    <div v-if="activeTab === 'gcode-preview'" class="tab-content">
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
          <RecycleScroller
            class="gcode-scroller"
            :items="gcodeItems"
            :item-size="rowHeight"
            key-field="index"
            :buffer="overscan"
            ref="gcodeScrollerRef"
            @scroll="onGcodeScroll"
          >
            <template #default="{ item }">
              <div
                class="gcode-line"
                :class="getGcodeLineClasses(item.index)"
                :style="{ height: rowHeight + 'px' }"
              >
                <span class="line-number">{{ item.index + 1 }}</span>
                <span v-if="isCurrentLine(item.index)" class="current-line-arrow">▶</span>
                <span class="line-content">{{ getGcodeText(item.index) }}</span>
              </div>
            </template>
          </RecycleScroller>
        </div>
        <div class="gcode-footer">
          {{ store.gcodeFilename.value || 'Untitled' }} — {{ totalLines }} lines
          <span class="gcode-storage">{{ storageMode }}</span>
        </div>
      </div>
    </div>

    <!-- G-Code Modal Dialog -->
    <div v-if="showGcodeModal" class="modal-overlay" @click.self="showGcodeModal = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>{{ store.gcodeFilename.value || 'Untitled' }} — {{ totalLines }} lines</h3>
          <button class="modal-close" @click="showGcodeModal = false" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
            </svg>
          </button>
        </div>
        <div class="modal-toolbar">
          <div v-if="!isEditMode" class="search-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            </svg>
            <input
              type="text"
              v-model="searchQuery"
              placeholder="Search G-code..."
              @input="onSearchInput"
              class="search-input"
            />
            <span v-if="searchQuery" class="search-results">{{ searchResultText }}</span>
            <div class="search-nav" v-if="searchResults.length > 0">
              <button @click="goToPreviousSearchResult" title="Previous match" :disabled="searchResults.length === 0">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                  <path fill-rule="evenodd" d="M8 15a.5.5 0 0 0 .5-.5V2.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L7.5 2.707V14.5a.5.5 0 0 0 .5.5z"/>
                </svg>
              </button>
              <button @click="goToNextSearchResult" title="Next match" :disabled="searchResults.length === 0">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                  <path fill-rule="evenodd" d="M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1z"/>
                </svg>
              </button>
            </div>
            <button v-if="searchQuery" @click="clearSearch" class="clear-search" title="Clear search">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
              </svg>
            </button>
          </div>
          <div class="modal-actions">
            <div v-if="!isEditMode && isProgramRunning" class="auto-scroll-toggle" @click="autoScrollModal = !autoScrollModal" :class="{ active: autoScrollModal }">
              <span class="toggle-label">Auto-Scroll</span>
              <div class="toggle-switch">
                <div class="toggle-handle"></div>
              </div>
            </div>
            <button v-if="!isEditMode && !isProgramRunning" @click="toggleEditMode" class="edit-toggle" :class="{ active: isEditMode }">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
              </svg>
              {{ isEditMode ? 'View Mode' : 'Edit Mode' }}
            </button>
          </div>
        </div>
        <div class="modal-content">
          <div v-if="!isEditMode" class="gcode-modal-viewer" ref="modalGcodeOutput">
            <RecycleScroller
              class="gcode-scroller"
              :items="filteredGcodeItems"
              :item-size="rowHeight"
              key-field="index"
              :buffer="overscan"
              ref="modalGcodeScrollerRef"
              @scroll="onModalGcodeScroll"
            >
              <template #default="{ item }">
                <div
                  class="gcode-line"
                  :class="getModalGcodeLineClasses(item.index)"
                  :style="{ height: rowHeight + 'px' }"
                >
                  <span class="line-number">{{ item.index + 1 }}</span>
                  <span v-if="isCurrentLine(item.index)" class="current-line-arrow">▶</span>
                  <span class="line-content" v-html="highlightSearchMatch(getGcodeText(item.index))"></span>
                </div>
              </template>
            </RecycleScroller>
          </div>
          <div v-else class="gcode-editor-container">
            <div class="editor-wrapper">
              <div class="line-numbers" ref="lineNumbersRef">
                <div v-for="n in editorLineCount" :key="n" class="line-num">{{ n }}</div>
              </div>
              <textarea
                v-model="editableGcode"
                class="gcode-editor"
                spellcheck="false"
                @input="onGcodeEdit"
                @scroll="syncLineNumbersScroll"
                ref="editorTextareaRef"
              ></textarea>
            </div>
            <div class="editor-actions">
              <button @click="cancelEdit" class="cancel-button">Cancel</button>
              <button @click="commitEdit" class="commit-button">Commit Changes</button>
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
            <button @click="sendQuickCommand('?')" :disabled="!connected || !isSenderIdle" class="quick-control-btn" title="Get machine status (?)">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
              </svg>
              <span>Status</span>
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
                    <span class="message">{{ item.message }}</span>
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
  </section>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed, reactive } from 'vue';
import { api } from './api';
import { fetchToolMenuItems, executeToolMenuItem as runToolMenuItem } from '../plugins/api';
import { getLinesRangeFromIDB, isIDBEnabled } from '../../lib/gcode-store.js';
import { isTerminalIDBEnabled } from '../../lib/terminal-store.js';
import { useConsoleStore } from './store';
import { RecycleScroller, DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import MacroPanel from '../macro/MacroPanel.vue';

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
const gcodeScrollerRef = ref<any>(null);
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
const modalGcodeScrollerRef = ref<any>(null);
const searchQuery = ref('');

// Terminal Modal state
const showTerminalModal = ref(false);
const modalTerminalScrollerRef = ref<any>(null);
const autoScrollTerminalModal = ref(true);
const spindleRPM = ref(10000);
const searchResults = ref<number[]>([]);
const currentSearchIndex = ref(0);
const isEditMode = ref(false);
const editableGcode = ref('');
const hasUnsavedChanges = ref(false);
const autoScrollModal = ref(true);
const editorTextareaRef = ref<HTMLTextAreaElement | null>(null);
const lineNumbersRef = ref<HTMLDivElement | null>(null);

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

// G-code viewer state (virtualized via RecycleScroller)
const lineHeight = ref(18); // height of a .gcode-line (no gap)
const rowHeight = computed(() => lineHeight.value); // fixed per-row height
const overscan = 50; // Increased buffer to reduce flickering during auto-scroll
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

// Minimal line cache for IDB mode
const gcodeCache = reactive<{ [key: number]: string }>({});
const memLines = computed(() => {
  const content = store.gcodeContent.value;
  if (!content) return null;
  const arr = content.split('\n');
  while (arr.length > 0 && arr[arr.length - 1].trim() === '') arr.pop();
  return arr;
});

const gcodeItems = computed(() => Array.from({ length: totalLines.value }, (_, i) => ({ index: i })));

function getGcodeText(index: number) {
  const mem = memLines.value;
  if (mem) return mem[index] ?? '';
  const cached = gcodeCache[index];
  return cached ?? '';
}

// Classify a G-code line for coloring (rapid vs cutting)
function classifyGcode(line: string): 'rapid' | 'cutting' | null {
  if (!line) return null;
  const upper = line.toUpperCase();
  // Strip comments: ( ... ) and ; ...
  const noParen = upper.replace(/\([^)]*\)/g, '');
  const code = noParen.split(';')[0] || '';
  if (!code.trim()) return null;
  // Detect motion words
  const isG0 = /\bG0+(?:\.0+)?\b/.test(code);
  const isG1 = /\bG1+(?:\.0+)?\b/.test(code);
  const isG2 = /\bG2+(?:\.0+)?\b/.test(code);
  const isG3 = /\bG3+(?:\.0+)?\b/.test(code);
  if (isG0) return 'rapid';
  if (isG1 || isG2 || isG3) return 'cutting';
  // Default to 'cutting' when no explicit motion matches
  return 'cutting';
}

// Memoize classification results to reduce recalculations
const classificationCache = reactive<{ [key: number]: 'rapid' | 'cutting' | null }>({});

function isCurrentLine(index: number) {
  const currentLine = completedUpTo.value;
  return isProgramRunning.value && currentLine > 0 && (index + 1 === currentLine);
}

function getGcodeLineClasses(index: number) {
  // Use throttled completedUpTo to reduce re-renders
  const completed = (index + 1 <= throttledCompletedUpTo.value);
  const base: Record<string, boolean> = { 'gcode-line--completed': completed };

  // Use cached classification if available
  let kind = classificationCache[index];
  if (kind === undefined) {
    const text = getGcodeText(index);
    if (text) {
      kind = classifyGcode(text);
      classificationCache[index] = kind;
    } else {
      kind = null;
    }
  }

  if (kind === 'rapid') base['gcode-line--rapid'] = true;
  if (kind === 'cutting') base['gcode-line--cutting'] = true;
  return base;
}

async function fillGcodeCache(startIndex: number, endIndex: number) {
  if (!isIDBEnabled() || memLines.value) return;
  try {
    const endLine = Math.min(totalLines.value, endIndex);
    if (endLine <= startIndex) return;
    const rows = await getLinesRangeFromIDB(startIndex + 1, endLine);
    rows.forEach((text, i) => { gcodeCache[startIndex + i] = text; });
  } catch {}
}

async function scrollToLineCentered(lineNumber: number) {
  const el = gcodeOutput.value;
  if (!el || !lineNumber || totalLines.value === 0) return;
  const targetIndex = Math.max(0, Math.min(totalLines.value - 1, lineNumber - 1));
  const vh = el.clientHeight || 0;
  const centerOffset = Math.max(0, (vh - rowHeight.value) / 2);
  const desired = targetIndex * rowHeight.value - centerOffset;
  const maxScroll = Math.max(0, totalLines.value * rowHeight.value - vh);
  const clamped = Math.max(0, Math.min(maxScroll, desired));

  // Pre-warm cache before scrolling to reduce flickering
  if (!memLines.value) {
    const visibleCount = Math.ceil(vh / rowHeight.value) + overscan;
    const start = Math.max(0, targetIndex - Math.floor(visibleCount / 2));
    const end = Math.min(totalLines.value, start + visibleCount);
    await fillGcodeCache(start, end);
  }

  if (gcodeScrollerRef.value?.scrollToPosition) {
    gcodeScrollerRef.value.scrollToPosition(clamped);
  } else if (gcodeScrollerRef.value?.scrollToItem) {
    gcodeScrollerRef.value.scrollToItem(targetIndex);
    // Adjust closer to center via direct scrollTop tweak
    const root = gcodeScrollerRef.value?.$el || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root) root.scrollTop = clamped;
  } else {
    const root = gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root) root.scrollTop = clamped;
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
    // Auto-scroll modal if open and auto-scroll enabled
    if (showGcodeModal.value && autoScrollModal.value && isProgramRunning.value && !isEditMode.value) {
      scrollToModalLine(lineToScroll);
    }
  }, 300);
});

watch(isProgramRunning, async (running) => {
  if (running) {
    // Exit edit mode when job starts
    if (isEditMode.value) {
      isEditMode.value = false;
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
        await nextTick();
        measureLineHeight();
      }
    }

    if (autoScrollGcode.value && activeTab.value === 'gcode-preview') {
      scrollToLineCentered(completedUpTo.value);
    }
  }
});

function measureLineHeight() {
  const el = gcodeOutput.value;
  if (!el) return;
  const temp = document.createElement('div');
  temp.className = 'gcode-line';
  temp.style.visibility = 'hidden';
  temp.innerHTML = '<span class="line-number">Line 1:</span><span class="line-content">X0 Y0</span>';
  el.appendChild(temp);
  const h = temp.getBoundingClientRect().height;
  el.removeChild(temp);
  if (h && h > 0) lineHeight.value = Math.round(h); // snap to whole px to avoid drift
}

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
    measureLineHeight();
    // Warm up cache for initial visible window
    const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (!memLines.value) {
      if (root && (root as HTMLElement).clientHeight) {
        onGcodeScroll();
      } else {
        // Prefetch first chunk to avoid empty lines before any scroll
        fillGcodeCache(0, Math.max(overscan, 200));
      }
    }
    if (isProgramRunning.value && autoScrollGcode.value) {
      scrollToLineCentered(completedUpTo.value);
    }
  });
});

watch(totalLines, async (newVal, oldVal) => {
  await nextTick();
  const el = gcodeOutput.value;
  if (el) el.scrollTop = 0;

  // Clear classification cache when new file is loaded
  if (newVal !== oldVal) {
    Object.keys(classificationCache).forEach(key => delete classificationCache[parseInt(key)]);
  }

  if (!memLines.value) {
    const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root && (root as HTMLElement).clientHeight) {
      onGcodeScroll();
    } else {
      fillGcodeCache(0, Math.max(overscan, 200));
    }
  }

  // Auto-switch to G-Code Preview tab when new file is loaded
  if (newVal > 0 && newVal !== oldVal) {
    activeTab.value = 'gcode-preview';
  }
});

watch(activeTab, async (tab) => {
  if (tab === 'gcode-preview') {
    await nextTick();
    measureLineHeight();
    // Warm up cache for initial window
    onGcodeScroll();
  } else if (tab === 'terminal') {
    await nextTick();
    measureTerminalRowHeight();
    if (autoScroll.value && scrollerRef.value) {
      scrollerRef.value.scrollToItem(terminalLines.value.length - 1);
    }
  }
});

// rAF scroll handler to reduce jank
let scrolling = false;
function onGcodeScroll() {
  if (scrolling) return;
  scrolling = true;
  requestAnimationFrame(() => {
    scrolling = false;
    // Prefetch IDB window to keep text cache warm
    if (!memLines.value) {
      const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
      if (!root) return;
      const vh = (root as HTMLElement).clientHeight || 0;
      const scrollTop = (root as HTMLElement).scrollTop || 0;
      const visibleCount = Math.ceil(vh / rowHeight.value) + overscan;
      const start = Math.max(0, Math.floor(scrollTop / rowHeight.value) - Math.floor(overscan / 2));
      const end = Math.min(totalLines.value, start + visibleCount);
      fillGcodeCache(start, end);
    }
  });
}

// Reset cross-out and scroll to top when user closes Job Progress panel (status changes to null)
watch(() => store.jobLoaded.value?.status, async (val, oldVal) => {
  if (oldVal && (oldVal === 'running' || oldVal === 'paused' || oldVal === 'stopped' || oldVal === 'completed') && val === null) {
    // Reset the completed line gate when job ends
    lastValidCompletedUpTo = 0;
    throttledCompletedUpTo.value = 0;
    pendingCompletedUpTo = 0;

    await nextTick();
    if (gcodeScrollerRef.value?.scrollToPosition) {
      gcodeScrollerRef.value.scrollToPosition(0);
    } else {
      const root = (gcodeScrollerRef.value && gcodeScrollerRef.value.$el) || gcodeOutput.value?.querySelector('.vue-recycle-scroller');
      if (root) (root as HTMLElement).scrollTop = 0;
    }
  }

  // Reset gate when a new job starts
  if (val === 'running' && oldVal !== 'running') {
    lastValidCompletedUpTo = 0;
    throttledCompletedUpTo.value = 0;
    pendingCompletedUpTo = 0;
  }
});

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
  } else if (line.status === 'error') {
    return '<svg class="emoji-icon"><use href="#emoji-error"></use></svg>';
  } else if (line.status === 'pending') {
    return '<span class="spinner"></span>';
  } else if (line.type === 'response') {
    return '<svg class="emoji-icon"><use href="#emoji-info"></use></svg>';
  }
  return '';
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

// Watch modal open/close to sync main view
watch(showGcodeModal, async (isOpen) => {
  if (!isOpen) {
    // Modal closed - sync main view to current position if program is running
    await nextTick();
    if (activeTab.value === 'gcode-preview' && autoScrollGcode.value && isProgramRunning.value) {
      scrollToLineCentered(completedUpTo.value);
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
const filteredGcodeItems = computed(() => {
  if (!searchQuery.value) {
    return gcodeItems.value;
  }
  return gcodeItems.value.filter(item => searchResults.value.includes(item.index));
});

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

async function scrollToModalLine(lineIndex: number) {
  const el = modalGcodeOutput.value;
  if (!el || totalLines.value === 0) return;

  const targetIndex = Math.max(0, Math.min(totalLines.value - 1, lineIndex));
  const vh = el.clientHeight || 0;
  const centerOffset = Math.max(0, (vh - rowHeight.value) / 2);
  const desired = targetIndex * rowHeight.value - centerOffset;
  const maxScroll = Math.max(0, totalLines.value * rowHeight.value - vh);
  const clamped = Math.max(0, Math.min(maxScroll, desired));

  // Pre-warm cache before scrolling to reduce flickering
  if (!memLines.value) {
    const visibleCount = Math.ceil(vh / rowHeight.value) + overscan;
    const start = Math.max(0, targetIndex - Math.floor(visibleCount / 2));
    const end = Math.min(totalLines.value, start + visibleCount);
    await fillGcodeCache(start, end);
  }

  if (modalGcodeScrollerRef.value?.scrollToPosition) {
    modalGcodeScrollerRef.value.scrollToPosition(clamped);
  } else if (modalGcodeScrollerRef.value?.scrollToItem) {
    modalGcodeScrollerRef.value.scrollToItem(targetIndex);
    const root = modalGcodeScrollerRef.value?.$el || modalGcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root) root.scrollTop = clamped;
  } else {
    const root = modalGcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (root) root.scrollTop = clamped;
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

function highlightSearchMatch(text: string): string {
  if (!searchQuery.value) return text;
  const query = searchQuery.value;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

function getModalGcodeLineClasses(index: number) {
  // Use throttled completedUpTo to reduce re-renders
  const completed = (index + 1 <= throttledCompletedUpTo.value);
  const base: Record<string, boolean> = { 'gcode-line--completed': completed };

  // Use cached classification if available
  let kind = classificationCache[index];
  if (kind === undefined) {
    const text = getGcodeText(index);
    if (text) {
      kind = classifyGcode(text);
      classificationCache[index] = kind;
    } else {
      kind = null;
    }
  }

  if (kind === 'rapid') base['gcode-line--rapid'] = true;
  if (kind === 'cutting') base['gcode-line--cutting'] = true;

  if (searchResults.value.includes(index)) {
    base['gcode-line--search-match'] = true;
    if (searchResults.value[currentSearchIndex.value] === index) {
      base['gcode-line--current-match'] = true;
    }
  }

  return base;
}

function onModalGcodeScroll() {
  if (!memLines.value) {
    const root = (modalGcodeScrollerRef.value && modalGcodeScrollerRef.value.$el) || modalGcodeOutput.value?.querySelector('.vue-recycle-scroller');
    if (!root) return;
    const vh = (root as HTMLElement).clientHeight || 0;
    const scrollTop = (root as HTMLElement).scrollTop || 0;
    const visibleCount = Math.ceil(vh / rowHeight.value) + overscan;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight.value) - Math.floor(overscan / 2));
    const end = Math.min(totalLines.value, start + visibleCount);
    fillGcodeCache(start, end);
  }
}

async function toggleEditMode() {
  if (!isEditMode.value) {
    // Load full content from memory or IDB
    if (memLines.value) {
      editableGcode.value = memLines.value.join('\n');
    } else {
      // Load from IDB
      const lines = await getLinesRangeFromIDB(1, totalLines.value);
      editableGcode.value = lines.join('\n');
    }
    isEditMode.value = true;
    hasUnsavedChanges.value = false;
  } else {
    if (hasUnsavedChanges.value) {
      if (!confirm('You have unsaved changes. Are you sure you want to discard them?')) {
        return;
      }
    }
    isEditMode.value = false;
    hasUnsavedChanges.value = false;
  }
}

function onGcodeEdit() {
  hasUnsavedChanges.value = true;
}

function syncLineNumbersScroll() {
  if (editorTextareaRef.value && lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = editorTextareaRef.value.scrollTop;
  }
}

function cancelEdit() {
  if (hasUnsavedChanges.value) {
    if (!confirm('You have unsaved changes. Are you sure you want to discard them?')) {
      return;
    }
  }
  isEditMode.value = false;
  hasUnsavedChanges.value = false;
  editableGcode.value = '';
}

async function commitEdit() {
  try {
    const filename = store.gcodeFilename.value || 'modified.gcode';

    const blob = new Blob([editableGcode.value], { type: 'text/plain' });
    const file = new File([blob], filename, { type: 'text/plain' });

    await api.uploadGCodeFile(file);
    await api.loadGCodeFile(filename);

    hasUnsavedChanges.value = false;
    isEditMode.value = false;
    editableGcode.value = '';
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

.console-line--error {
  color: #ff6b6b;
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
  overflow: hidden; /* RecycleScroller handles scroll */
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
  contain: content;
}

.gcode-scroller {
  height: 100%;
  overflow: auto;
}

.gcode-spacer {
  width: 1px;
  height: 0;
  opacity: 0;
}

.gcode-items {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

/* Ensure all descendants remain selectable, except line numbers */
.gcode-content * {
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.gcode-line {
  display: flex;
  gap: var(--gap-sm);
  padding: 0;
  cursor: text;
  position: relative;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.gcode-line--completed .line-content {
  color: #555555 !important; /* Gray out completed lines (comments, empty lines, etc.) */
}

/* Color lines to match visualizer colors */
.gcode-line--rapid .line-content {
  color: #00ff66 !important; /* match visualizer rapid */
}

.gcode-line--cutting .line-content {
  color: #3e85c7 !important; /* same as visualizer cutting */
}

/* Completed lines: gray them like visualizer */
.gcode-line--completed.gcode-line--rapid .line-content {
  color: #333333 !important;
}
.gcode-line--completed.gcode-line--cutting .line-content {
  color: #444444 !important;
}

.line-number {
  color: #666;
  min-width: 60px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 12px;
  margin-right: 12px;
  border-right: 1px solid var(--color-border);
  background: #1a1a1a;
  font-family: 'JetBrains Mono', monospace;
  pointer-events: none;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

.current-line-arrow {
  position: absolute;
  left: 72px;
  color: #ffff00;
  font-size: 14px;
  pointer-events: none;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  user-select: none !important;
}

.line-content {
  color: #bdc3c7;
  flex: 1;
  padding-left: 4px;
  cursor: text;
  white-space: pre;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
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
}

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
  background: #141414;
  padding: var(--gap-xs);
  flex: 1;
  overflow: hidden;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  cursor: text;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  -ms-user-select: text !important;
  user-select: text !important;
}

.gcode-editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.editor-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
  background: #141414;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
}

.line-numbers {
  background: #1a1a1a;
  color: #666;
  padding: 16px 8px 16px 12px;
  text-align: right;
  user-select: none;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  line-height: 1.5;
  overflow-y: hidden;
  border-right: 1px solid var(--color-border);
  min-width: 60px;
}

.line-num {
  line-height: 1.5;
  white-space: pre;
}

.gcode-editor {
  flex: 1;
  width: 100%;
  background: #141414;
  color: #bdc3c7;
  border: none;
  padding: 16px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  line-height: 1.5;
  resize: none;
  outline: none;
  tab-size: 2;
  overflow-y: auto;
}

.gcode-editor:focus {
  outline: none;
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

.commit-button:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Search Match Highlighting */
.gcode-line--search-match {
  background: rgba(255, 255, 0, 0.1);
}

.gcode-line--current-match {
  background: rgba(255, 165, 0, 0.2);
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

body.theme-light .current-line-arrow {
  color: #E67E22 !important;
}

/* Preserve motion coloring in light theme */
body.theme-light .gcode-line--rapid .line-content { color: #E67E22 !important; }
body.theme-light .gcode-line--cutting .line-content { color: #3e85c7 !important; }
body.theme-light .gcode-line--completed.gcode-line--rapid .line-content { color: #333333 !important; }
body.theme-light .gcode-line--completed.gcode-line--cutting .line-content { color: #444444 !important; }

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

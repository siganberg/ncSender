<template>
  <div class="plugins-tab">
    <div v-if="loadError" class="error">
      {{ loadError }}
    </div>

    <!-- Config Panel View -->
    <div v-if="showConfigPanel && selectedPluginForConfig" class="config-panel-view">
      <div class="config-panel-header">
        <div class="config-header-top">
          <button class="btn-back" @click="closeConfigPanel">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path fill-rule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8"/>
            </svg>
            Back to Plugins
          </button>
        </div>
        <h3>{{ selectedPluginForConfig.name }} Configuration</h3>
      </div>
      <div class="config-panel-content">
        <iframe
          ref="configIframe"
          :srcdoc="configUIContent"
          frameborder="0"
          class="config-iframe"
          @load="onConfigIframeLoad"
        ></iframe>
      </div>
    </div>

    <div v-else class="plugins-content">
      <div class="plugins-header">
        <div class="header-info">
          <h3>Installed Plugins</h3>
          <span class="plugin-count">{{ plugins.length }} plugin{{ plugins.length !== 1 ? 's' : '' }}</span>
        </div>
        <button class="btn btn-primary" @click="openInstallDialog">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
          </svg>
          Install Plugin
        </button>
      </div>

      <div class="plugins-scrollable">
        <div v-if="plugins.length === 0 && !loading" class="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
            <path d="M6 10.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5"/>
          </svg>
          <p>No plugins installed</p>
          <p class="empty-hint">Install a plugin to extend ncSender functionality</p>
        </div>

        <div v-else class="plugins-container">
        <!-- Sortable Plugins Section -->
        <div v-if="sortablePlugins.length > 0" class="plugins-section">
          <h4 class="section-header">Event-based Plugins{{ allowPriorityReordering ? ' (Sortable)' : '' }}</h4>
          <div class="plugins-table sortable">
            <div
              v-for="(plugin, index) in sortablePlugins"
              :key="plugin.id"
              class="plugin-row"
              :draggable="allowPriorityReordering"
              v-on="allowPriorityReordering ? {
                dragstart: (e) => handleDragStart(plugin.id, e),
                dragenter: handleDragEnter,
                dragover: handleDragOver,
                drop: (e) => handleDrop(index, e),
                dragend: handleDragEnd
              } : {}"
            >
              <div v-if="allowPriorityReordering" class="drag-handle">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0M7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0m3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
                </svg>
              </div>
              <div v-else class="drag-handle-placeholder"></div>

              <div class="plugin-icon-cell">
                <img
                  v-if="plugin.hasIcon && !brokenIcons[plugin.id]"
                  :src="`${api.baseUrl}/api/plugins/${plugin.id}/icon`"
                  :alt="`${plugin.name} icon`"
                  class="plugin-icon-small"
                  @error="brokenIcons[plugin.id] = true"
                />
                <svg v-else class="plugin-icon-placeholder" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32">
                  <path fill="#662113" d="M3.5555555555555554 9.777777777777777v11c0 1.815111111111111 0.9715555555555555 2.2079999999999997 0.9715555555555555 2.2079999999999997l10.287999999999998 8.088C16.434666666666665 32.346666666666664 16 29.666666666666664 16 29.666666666666664V19.555555555555554L3.5555555555555554 9.777777777777777z"></path>
                  <path fill="#c1694f" d="M28.444444444444443 9.777777777777777v11c0 1.815111111111111 -0.9448888888888888 2.2079999999999997 -0.9448888888888888 2.2079999999999997s-8.681777777777777 6.8151111111111105 -10.300444444444443 8.088C15.578666666666665 32.346666666666664 16 29.666666666666664 16 29.666666666666664V19.555555555555554l12.444444444444443 -9.777777777777777z"></path>
                  <path fill="#d99e82" d="M17.145777777777777 0.4444444444444444c-0.6693333333333333 -0.5422222222222222 -1.767111111111111 -0.5422222222222222 -2.437333333333333 0L4.057777777777778 8.914666666666665c-0.6702222222222222 0.5422222222222222 -0.6702222222222222 1.4284444444444444 0 1.9697777777777778l10.68711111111111 8.574222222222222c0.6702222222222222 0.5413333333333333 1.768 0.5413333333333333 2.438222222222222 0l10.75911111111111 -8.648888888888889c0.6702222222222222 -0.5413333333333333 0.6702222222222222 -1.4275555555555555 0 -1.9697777777777778L17.145777777777777 0.4444444444444444z"></path>
                  <path fill="#d99e82" d="M16 31.777777777777775c-0.4906666666666667 0 -0.8888888888888888 -0.4284444444444444 -0.8888888888888888 -0.9582222222222222V19.328888888888887c0 -0.5297777777777777 0.3982222222222222 -0.9582222222222222 0.8888888888888888 -0.9582222222222222 0.4915555555555556 0 0.8888888888888888 0.4284444444444444 0.8888888888888888 0.9582222222222222v11.490666666666666c0 0.5297777777777777 -0.3973333333333333 0.9582222222222222 -0.8888888888888888 0.9582222222222222z"></path>
                  <path fill="#99aab5" d="M24.888888888888886 16.74311111111111c0 0.9813333333333334 0.09244444444444444 1.463111111111111 -0.8888888888888888 2.1706666666666665l-2.1946666666666665 1.6693333333333331c-0.9813333333333334 0.7084444444444444 -1.3608888888888888 0.10044444444444445 -1.3608888888888888 -0.8817777777777778v-2.6319999999999997c0 -0.17155555555555554 -0.02311111111111111 -0.35555555555555557 -0.24711111111111111 -0.5404444444444444C17.905777777777775 14.639999999999999 9.008 7.572444444444444 7.386666666666667 6.267555555555555l4.111111111111111 -3.269333333333333c1.1253333333333333 0.8231111111111111 9.558222222222222 7.335111111111111 13.08622222222222 10.11288888888889 0.1751111111111111 0.13866666666666666 0.3048888888888889 0.29155555555555557 0.3048888888888889 0.45866666666666667v3.173333333333333z"></path>
                  <path fill="#ccd6dd" d="M24.58311111111111 13.11111111111111C21.055999999999997 10.333333333333332 12.623111111111111 3.8213333333333335 11.497777777777777 2.998222222222222l-1.5297777777777777 1.216 -2.5813333333333333 2.0533333333333332c1.622222222222222 1.3048888888888888 10.51911111111111 8.372444444444444 12.810666666666666 10.261333333333333 0.13422222222222221 0.1111111111111111 0.1928888888888889 0.2222222222222222 0.22044444444444444 0.3297777777777778L24.802666666666664 13.333333333333332c-0.05333333333333333 -0.07733333333333332 -0.12977777777777777 -0.152 -0.21955555555555553 -0.2222222222222222z"></path>
                  <path fill="#ccd6dd" d="M24.888888888888886 16.74311111111111v-3.173333333333333c0 -0.1671111111111111 -0.12977777777777777 -0.31911111111111107 -0.30577777777777776 -0.45866666666666667 -3.527111111111111 -2.7777777777777777 -11.959999999999999 -9.289777777777777 -13.085333333333333 -10.11288888888889l-1.8426666666666665 1.4657777777777776c3.0159999999999996 2.372444444444444 11.094222222222221 8.605333333333332 13.208888888888888 10.28711111111111 0.22755555555555554 0.18133333333333332 0.24711111111111111 0.3688888888888889 0.24711111111111111 0.5404444444444444v4.298666666666667l0.8888888888888888 -0.6764444444444444c0.9813333333333334 -0.7084444444444444 0.8888888888888888 -1.1893333333333334 0.8888888888888888 -2.1706666666666665z"></path>
                  <path fill="#e1e8ed" d="M24.58311111111111 13.11111111111111C21.055999999999997 10.333333333333332 12.623111111111111 3.8213333333333335 11.497777777777777 2.998222222222222l-1.8426666666666665 1.4657777777777776c3.0159999999999996 2.372444444444444 11.094222222222221 8.605333333333332 13.208888888888888 10.28711111111111 0.032888888888888884 0.025777777777777778 0.05333333333333333 0.05244444444444444 0.07733333333333332 0.0782222222222222L24.802666666666664 13.333333333333332c-0.05333333333333333 -0.07733333333333332 -0.12977777777777777 -0.152 -0.21955555555555553 -0.2222222222222222z"></path>
                </svg>
              </div>

              <div class="plugin-info-cell">
                <div class="plugin-name-row">
                  <div class="plugin-name-text">{{ plugin.name }}</div>
                  <span v-if="plugin.enabled" class="status-badge status-enabled">Enabled</span>
                  <span v-else class="status-badge status-disabled">Disabled</span>
                </div>
                <div class="plugin-meta-row">
                  <span class="plugin-category-text">{{ plugin.category }}</span>
                  <span
                    class="plugin-version-text"
                    :class="{ 'has-update': plugin.updateInfo?.hasUpdate, 'clickable': plugin.repository }"
                    @click="plugin.repository && showUpdateInfo(plugin)"
                  >
                    v{{ plugin.version }}
                    <span v-if="plugin.updateInfo?.hasUpdate" class="update-badge" title="Update available">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                        <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
                      </svg>
                    </span>
                  </span>
                  <span v-if="plugin.installedAt" class="plugin-installed-text">
                    Installed {{ formatDate(plugin.installedAt) }}
                  </span>
                </div>
              </div>

              <div class="plugin-actions-cell">
                <button
                  v-if="plugin.hasConfig"
                  class="btn-icon"
                  @click="openConfigPanel(plugin)"
                  title="Configure"
                  :disabled="!plugin.enabled || !plugin.loaded"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
                    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
                  </svg>
                </button>

                <button
                  class="btn-icon"
                  @click="togglePlugin(plugin)"
                  :title="plugin.enabled ? 'Disable' : 'Enable'"
                  :disabled="toggling === plugin.id"
                >
                  <svg v-if="plugin.enabled" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z"/>
                    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                  </svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
                  </svg>
                </button>

                <button
                  class="btn-icon btn-icon-danger"
                  @click="confirmUninstall(plugin)"
                  title="Uninstall"
                  :disabled="uninstalling === plugin.id"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                    <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>


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

              <div class="plugin-icon-cell">
                <img
                  v-if="plugin.hasIcon && !brokenIcons[plugin.id]"
                  :src="`${api.baseUrl}/api/plugins/${plugin.id}/icon`"
                  :alt="`${plugin.name} icon`"
                  class="plugin-icon-small"
                  @error="brokenIcons[plugin.id] = true"
                />
                <svg v-else class="plugin-icon-placeholder" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 32 32">
                  <path fill="#662113" d="M3.5555555555555554 9.777777777777777v11c0 1.815111111111111 0.9715555555555555 2.2079999999999997 0.9715555555555555 2.2079999999999997l10.287999999999998 8.088C16.434666666666665 32.346666666666664 16 29.666666666666664 16 29.666666666666664V19.555555555555554L3.5555555555555554 9.777777777777777z"></path>
                  <path fill="#c1694f" d="M28.444444444444443 9.777777777777777v11c0 1.815111111111111 -0.9448888888888888 2.2079999999999997 -0.9448888888888888 2.2079999999999997s-8.681777777777777 6.8151111111111105 -10.300444444444443 8.088C15.578666666666665 32.346666666666664 16 29.666666666666664 16 29.666666666666664V19.555555555555554l12.444444444444443 -9.777777777777777z"></path>
                  <path fill="#d99e82" d="M17.145777777777777 0.4444444444444444c-0.6693333333333333 -0.5422222222222222 -1.767111111111111 -0.5422222222222222 -2.437333333333333 0L4.057777777777778 8.914666666666665c-0.6702222222222222 0.5422222222222222 -0.6702222222222222 1.4284444444444444 0 1.9697777777777778l10.68711111111111 8.574222222222222c0.6702222222222222 0.5413333333333333 1.768 0.5413333333333333 2.438222222222222 0l10.75911111111111 -8.648888888888889c0.6702222222222222 -0.5413333333333333 0.6702222222222222 -1.4275555555555555 0 -1.9697777777777778L17.145777777777777 0.4444444444444444z"></path>
                  <path fill="#d99e82" d="M16 31.777777777777775c-0.4906666666666667 0 -0.8888888888888888 -0.4284444444444444 -0.8888888888888888 -0.9582222222222222V19.328888888888887c0 -0.5297777777777777 0.3982222222222222 -0.9582222222222222 0.8888888888888888 -0.9582222222222222 0.4915555555555556 0 0.8888888888888888 0.4284444444444444 0.8888888888888888 0.9582222222222222v11.490666666666666c0 0.5297777777777777 -0.3973333333333333 0.9582222222222222 -0.8888888888888888 0.9582222222222222z"></path>
                  <path fill="#99aab5" d="M24.888888888888886 16.74311111111111c0 0.9813333333333334 0.09244444444444444 1.463111111111111 -0.8888888888888888 2.1706666666666665l-2.1946666666666665 1.6693333333333331c-0.9813333333333334 0.7084444444444444 -1.3608888888888888 0.10044444444444445 -1.3608888888888888 -0.8817777777777778v-2.6319999999999997c0 -0.17155555555555554 -0.02311111111111111 -0.35555555555555557 -0.24711111111111111 -0.5404444444444444C17.905777777777775 14.639999999999999 9.008 7.572444444444444 7.386666666666667 6.267555555555555l4.111111111111111 -3.269333333333333c1.1253333333333333 0.8231111111111111 9.558222222222222 7.335111111111111 13.08622222222222 10.11288888888889 0.1751111111111111 0.13866666666666666 0.3048888888888889 0.29155555555555557 0.3048888888888889 0.45866666666666667v3.173333333333333z"></path>
                  <path fill="#ccd6dd" d="M24.58311111111111 13.11111111111111C21.055999999999997 10.333333333333332 12.623111111111111 3.8213333333333335 11.497777777777777 2.998222222222222l-1.5297777777777777 1.216 -2.5813333333333333 2.0533333333333332c1.622222222222222 1.3048888888888888 10.51911111111111 8.372444444444444 12.810666666666666 10.261333333333333 0.13422222222222221 0.1111111111111111 0.1928888888888889 0.2222222222222222 0.22044444444444444 0.3297777777777778L24.802666666666664 13.333333333333332c-0.05333333333333333 -0.07733333333333332 -0.12977777777777777 -0.152 -0.21955555555555553 -0.2222222222222222z"></path>
                  <path fill="#ccd6dd" d="M24.888888888888886 16.74311111111111v-3.173333333333333c0 -0.1671111111111111 -0.12977777777777777 -0.31911111111111107 -0.30577777777777776 -0.45866666666666667 -3.527111111111111 -2.7777777777777777 -11.959999999999999 -9.289777777777777 -13.085333333333333 -10.11288888888889l-1.8426666666666665 1.4657777777777776c3.0159999999999996 2.372444444444444 11.094222222222221 8.605333333333332 13.208888888888888 10.28711111111111 0.22755555555555554 0.18133333333333332 0.24711111111111111 0.3688888888888889 0.24711111111111111 0.5404444444444444v4.298666666666667l0.8888888888888888 -0.6764444444444444c0.9813333333333334 -0.7084444444444444 0.8888888888888888 -1.1893333333333334 0.8888888888888888 -2.1706666666666665z"></path>
                  <path fill="#e1e8ed" d="M24.58311111111111 13.11111111111111C21.055999999999997 10.333333333333332 12.623111111111111 3.8213333333333335 11.497777777777777 2.998222222222222l-1.8426666666666665 1.4657777777777776c3.0159999999999996 2.372444444444444 11.094222222222221 8.605333333333332 13.208888888888888 10.28711111111111 0.032888888888888884 0.025777777777777778 0.05333333333333333 0.05244444444444444 0.07733333333333332 0.0782222222222222L24.802666666666664 13.333333333333332c-0.05333333333333333 -0.07733333333333332 -0.12977777777777777 -0.152 -0.21955555555555553 -0.2222222222222222z"></path>
                </svg>
              </div>

              <div class="plugin-info-cell">
                <div class="plugin-name-row">
                  <div class="plugin-name-text">{{ plugin.name }}</div>
                  <span v-if="plugin.enabled" class="status-badge status-enabled">Enabled</span>
                  <span v-else class="status-badge status-disabled">Disabled</span>
                </div>
                <div class="plugin-meta-row">
                  <span class="plugin-category-text">{{ plugin.category }}</span>
                  <span
                    class="plugin-version-text"
                    :class="{ 'has-update': plugin.updateInfo?.hasUpdate, 'clickable': plugin.repository }"
                    @click="plugin.repository && showUpdateInfo(plugin)"
                  >
                    v{{ plugin.version }}
                    <span v-if="plugin.updateInfo?.hasUpdate" class="update-badge" title="Update available">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                        <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
                      </svg>
                    </span>
                  </span>
                  <span v-if="plugin.installedAt" class="plugin-installed-text">
                    Installed {{ formatDate(plugin.installedAt) }}
                  </span>
                </div>
              </div>

              <div class="plugin-actions-cell">
                <button
                  v-if="plugin.hasConfig"
                  class="btn-icon"
                  @click="openConfigPanel(plugin)"
                  title="Configure"
                  :disabled="!plugin.enabled || !plugin.loaded"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
                    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
                  </svg>
                </button>

                <button
                  class="btn-icon"
                  @click="togglePlugin(plugin)"
                  :title="plugin.enabled ? 'Disable' : 'Enable'"
                  :disabled="toggling === plugin.id"
                >
                  <svg v-if="plugin.enabled" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1z"/>
                    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                  </svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
                  </svg>
                </button>

                <button
                  class="btn-icon btn-icon-danger"
                  @click="confirmUninstall(plugin)"
                  title="Uninstall"
                  :disabled="uninstalling === plugin.id"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                    <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Keep old card view for reference - will remove after testing -->
        <div v-if="false" class="plugin-card-old">
          <div class="plugin-thumbnail">
            <img
              v-if="plugin.hasIcon && !brokenIcons[plugin.id]"
              :src="`${api.baseUrl}/api/plugins/${plugin.id}/icon`"
              :alt="`${plugin.name} icon`"
              class="plugin-icon"
              @error="brokenIcons[plugin.id] = true"
            />
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 128 140">
              <path d="M62.54 4.84L10.38 31.73c-1.14.67-1.47 1.67-1.46 3.12l.1 1.81L64.09 64.9l54.94-27.79s.06-.28.06-1.26c0 0-.05-1.29-.34-1.89c-.32-.68-1-1.29-1.44-1.66c-1.17-.97-2.34-1.83-4.33-2.95C84.45 13.22 65.69 4.91 65.69 4.91c-1.21-.45-2.21-.61-3.15-.07z" fill="#dea66c"/>
              <path d="M9.74 96.16c3.04 2.01 8.59 4.65 14.2 7.69c13.04 7.06 29.52 15.64 37.72 19.01c1.11.46 1.77.68 2.54.72c.57.03 1.51-.35 1.51-.35s-1.53-55.19-1.62-58.34c-.09-3.08-1.38-4.1-2.52-4.84c-1.78-1.14-5.64-2.92-5.64-2.92s-13.52-6.72-27.02-13.8c-6.42-3.37-11.84-6.82-17.67-9.66c-1.07-.51-2.33.13-2.33 1.33v59.8c0 .57.35 1.05.83 1.36z" fill="#b38251"/>
              <path d="M117.58 96.51L65.82 123.2c-.83.43-1.82-.17-1.82-1.11l.09-57.18c0-.55-.17-1.76-.34-2.24c-.47-1.4.55-1.96 1.01-2.19l51.34-26.44c1.36-.7 2.99.29 2.99 1.82v58.19c0 1.03-.58 1.98-1.51 2.46z" fill="#966239"/>
              <path d="M94.46 47.59S66.09 62.1 65.63 63.33c-.46 1.22 22.26-9.7 24.92-11.07c3.01-1.55 26.65-14.19 26.65-15.58c.01-1.14-22.74 10.91-22.74 10.91z" opacity=".5" fill="#212121"/>
            </svg>
          </div>

          <div class="plugin-info">
            <div class="plugin-title-row">
              <h4 class="plugin-name">{{ plugin.name }}</h4>
              <span class="plugin-version">v{{ plugin.version }}</span>
              <span v-if="plugin.loaded" class="plugin-status plugin-status--loaded">Loaded</span>
              <span v-else class="plugin-status plugin-status--unloaded">Not Loaded</span>
            </div>
            <p v-if="plugin.author" class="plugin-author">by {{ plugin.author }}</p>
            <div class="plugin-meta">
              <span v-if="plugin.loadedAt" class="meta-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/>
                  <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/>
                </svg>
                Loaded {{ formatTime(plugin.loadedAt) }}
              </span>
              <span v-if="plugin.installedAt" class="meta-item">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8z"/>
                </svg>
                Installed {{ formatTime(plugin.installedAt) }}
              </span>
            </div>
          </div>

          <div class="plugin-actions">
              <button
                class="btn-icon"
                @click="openConfigPanel(plugin)"
                title="Configure"
                :disabled="!plugin.enabled || !plugin.loaded || !plugin.hasConfig"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
                  <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
                </svg>
              </button>
              <button
                class="btn-icon"
                @click="reloadPlugin(plugin.id)"
                title="Reload"
                :disabled="!plugin.enabled || !plugin.loaded || reloading === plugin.id"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                  <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
                  <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
                </svg>
              </button>
              <button
                class="btn-icon"
                @click="togglePlugin(plugin)"
                :title="plugin.enabled ? 'Disable' : 'Enable'"
                :disabled="toggling === plugin.id"
              >
                <!-- Connected plug (enabled) -->
                <svg v-if="plugin.enabled" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <!-- Socket -->
                  <rect x="6" y="2" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
                  <!-- Plug pins in socket -->
                  <line x1="9" y1="6" x2="9" y2="2" stroke="currentColor" stroke-width="2"/>
                  <line x1="15" y1="6" x2="15" y2="2" stroke="currentColor" stroke-width="2"/>
                  <!-- Plug body -->
                  <rect x="7" y="10" width="10" height="6" rx="1" fill="currentColor"/>
                  <!-- Cable -->
                  <path d="M10 16 L10 22" stroke="currentColor" stroke-width="2" fill="none"/>
                  <path d="M14 16 L14 22" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>
                <!-- Disconnected plug (disabled) -->
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <!-- Socket -->
                  <rect x="6" y="2" width="12" height="6" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
                  <!-- Plug body (separated) -->
                  <rect x="7" y="12" width="10" height="6" rx="1" fill="currentColor"/>
                  <!-- Plug pins (not connected) -->
                  <line x1="10" y1="12" x2="10" y2="10" stroke="currentColor" stroke-width="2"/>
                  <line x1="14" y1="12" x2="14" y2="10" stroke="currentColor" stroke-width="2"/>
                  <!-- Cable -->
                  <path d="M10 18 L10 22" stroke="currentColor" stroke-width="2" fill="none"/>
                  <path d="M14 18 L14 22" stroke="currentColor" stroke-width="2" fill="none"/>
                </svg>
              </button>
              <button
                class="btn-icon btn-icon-danger"
                @click="confirmUninstall(plugin)"
                title="Uninstall"
                :disabled="uninstalling === plugin.id"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                  <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                </svg>
              </button>
            </div>
        </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Uninstall Confirmation Dialog -->
  <Dialog v-if="showUninstallConfirm && selectedPlugin" @close="showUninstallConfirm = false" :show-header="false" size="small">
    <ConfirmPanel
      :title="`Uninstall ${selectedPlugin.name}?`"
      message="This will remove the plugin and all its data. This action cannot be undone."
      cancel-text="Cancel"
      confirm-text="Uninstall"
      variant="danger"
      @confirm="uninstallPlugin"
      @cancel="showUninstallConfirm = false"
    />
  </Dialog>

  <!-- Category Conflict Dialog -->
  <Dialog v-if="showCategoryConflict && selectedPlugin" @close="showCategoryConflict = false" :show-header="false" size="small">
    <ConfirmPanel
      title="Only One Tool Changer Plugin Allowed"
      :message="`You already have ${conflictingPlugins.map(p => p.name).join(', ')} enabled. Please disable it first before enabling ${selectedPlugin.name}.`"
      cancel-text="OK"
      :show-confirm="false"
      variant="warning"
      @cancel="showCategoryConflict = false"
    />
  </Dialog>

  <!-- Install Plugin Dialog -->
  <Dialog
    v-if="showInstallDialog"
    @close="closeInstallDialog"
    :show-header="false"
    :size="installing || installSuccess || installCategoryConflict ? 'small' : undefined"
    :width="!(installing || installSuccess || installCategoryConflict) ? '850px' : undefined"
    :max-width="!(installing || installSuccess || installCategoryConflict) ? '90vw' : undefined"
    :height="!(installing || installSuccess || installCategoryConflict) ? '60vh' : undefined"
  >
    <div class="install-dialog" :class="{ 'install-dialog--compact': installing || installSuccess || installCategoryConflict }">
      <h3>Install Plugin</h3>

      <div v-if="installError && !installCategoryConflict" class="error">
        {{ installError }}
      </div>

      <div v-if="installing" class="installing-state">
        <div class="loading-spinner"></div>
        <p>Installing plugin...</p>
      </div>

      <div v-else-if="installSuccess || installCategoryConflict" class="success-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
          <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"/>
        </svg>
        <p class="success-message">
          {{ installCategoryConflict ? 'Plugin installed successfully but not activated. Another plugin in the same category is already active.' : 'Plugin installed successfully!' }}
        </p>
        <button class="btn btn-primary" @click="closeInstallDialog">Done</button>
      </div>

      <div v-else class="upload-form">
        <!-- Tab Selector -->
        <div class="install-tabs">
          <button
            :class="['tab-button', { active: installMethod === 'registry' }]"
            @click="installMethod = 'registry'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5z"/>
            </svg>
            Registry
          </button>
          <button
            :class="['tab-button', { active: installMethod === 'zip' }]"
            @click="installMethod = 'zip'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M5 10.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5"/>
              <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1h1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v1H1V2a2 2 0 0 1 2-2"/>
              <path d="M1 5v-.5a.5.5 0 0 1 1 0V5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V8h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0v.5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1z"/>
            </svg>
            ZIP
          </button>
        </div>

        <!-- Registry -->
        <div v-if="installMethod === 'registry'" class="install-method-content">
          <div class="registry-search">
            <input
              v-model="registrySearch"
              type="text"
              placeholder="Search plugins..."
              class="url-input"
            />
          </div>

          <div v-if="loadingRegistry" class="loading-registry">
            <div class="loading-spinner"></div>
            <p>Loading plugin registry...</p>
          </div>

          <div v-else-if="registryError" class="error">
            {{ registryError }}
          </div>

          <div v-else-if="filteredRegistryPlugins.length === 0" class="no-plugins">
            <p>No plugins found</p>
          </div>

          <div v-else class="registry-list">
            <div
              v-for="plugin in filteredRegistryPlugins"
              :key="plugin.id"
              class="registry-plugin"
            >
              <div class="registry-plugin-icon">
                <img
                  v-if="plugin.iconUrl && !brokenRegistryIcons[plugin.id]"
                  :src="plugin.iconUrl"
                  :alt="plugin.name"
                  @error="handleRegistryIconError(plugin.id)"
                />
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 32 32">
                  <path fill="#662113" d="M3.5555555555555554 9.777777777777777v11c0 1.815111111111111 0.9715555555555555 2.2079999999999997 0.9715555555555555 2.2079999999999997l10.287999999999998 8.088C16.434666666666665 32.346666666666664 16 29.666666666666664 16 29.666666666666664V19.555555555555554L3.5555555555555554 9.777777777777777z"></path>
                  <path fill="#c1694f" d="M28.444444444444443 9.777777777777777v11c0 1.815111111111111 -0.9448888888888888 2.2079999999999997 -0.9448888888888888 2.2079999999999997s-8.681777777777777 6.8151111111111105 -10.300444444444443 8.088C15.578666666666665 32.346666666666664 16 29.666666666666664 16 29.666666666666664V19.555555555555554l12.444444444444443 -9.777777777777777z"></path>
                  <path fill="#d99e82" d="M17.145777777777777 0.4444444444444444c-0.6693333333333333 -0.5422222222222222 -1.767111111111111 -0.5422222222222222 -2.437333333333333 0L4.057777777777778 8.914666666666665c-0.6702222222222222 0.5422222222222222 -0.6702222222222222 1.4284444444444444 0 1.9697777777777778l10.68711111111111 8.574222222222222c0.6702222222222222 0.5413333333333333 1.768 0.5413333333333333 2.438222222222222 0l10.75911111111111 -8.648888888888889c0.6702222222222222 -0.5413333333333333 0.6702222222222222 -1.4275555555555555 0 -1.9697777777777778L17.145777777777777 0.4444444444444444z"></path>
                  <path fill="#d99e82" d="M16 31.777777777777775c-0.4906666666666667 0 -0.8888888888888888 -0.4284444444444444 -0.8888888888888888 -0.9582222222222222V19.328888888888887c0 -0.5297777777777777 0.3982222222222222 -0.9582222222222222 0.8888888888888888 -0.9582222222222222 0.4915555555555556 0 0.8888888888888888 0.4284444444444444 0.8888888888888888 0.9582222222222222v11.490666666666666c0 0.5297777777777777 -0.3973333333333333 0.9582222222222222 -0.8888888888888888 0.9582222222222222z"></path>
                  <path fill="#99aab5" d="M24.888888888888886 16.74311111111111c0 0.9813333333333334 0.09244444444444444 1.463111111111111 -0.8888888888888888 2.1706666666666665l-2.1946666666666665 1.6693333333333331c-0.9813333333333334 0.7084444444444444 -1.3608888888888888 0.10044444444444445 -1.3608888888888888 -0.8817777777777778v-2.6319999999999997c0 -0.17155555555555554 -0.02311111111111111 -0.35555555555555557 -0.24711111111111111 -0.5404444444444444C17.905777777777775 14.639999999999999 9.008 7.572444444444444 7.386666666666667 6.267555555555555l4.111111111111111 -3.269333333333333c1.1253333333333333 0.8231111111111111 9.558222222222222 7.335111111111111 13.08622222222222 10.11288888888889 0.1751111111111111 0.13866666666666666 0.3048888888888889 0.29155555555555557 0.3048888888888889 0.45866666666666667v3.173333333333333z"></path>
                  <path fill="#ccd6dd" d="M24.58311111111111 13.11111111111111C21.055999999999997 10.333333333333332 12.623111111111111 3.8213333333333335 11.497777777777777 2.998222222222222l-1.5297777777777777 1.216 -2.5813333333333333 2.0533333333333332c1.622222222222222 1.3048888888888888 10.51911111111111 8.372444444444444 12.810666666666666 10.261333333333333 0.13422222222222221 0.1111111111111111 0.1928888888888889 0.2222222222222222 0.22044444444444444 0.3297777777777778L24.802666666666664 13.333333333333332c-0.05333333333333333 -0.07733333333333332 -0.12977777777777777 -0.152 -0.21955555555555553 -0.2222222222222222z"></path>
                  <path fill="#ccd6dd" d="M24.888888888888886 16.74311111111111v-3.173333333333333c0 -0.1671111111111111 -0.12977777777777777 -0.31911111111111107 -0.30577777777777776 -0.45866666666666667 -3.527111111111111 -2.7777777777777777 -11.959999999999999 -9.289777777777777 -13.085333333333333 -10.11288888888889l-1.8426666666666665 1.4657777777777776c3.0159999999999996 2.372444444444444 11.094222222222221 8.605333333333332 13.208888888888888 10.28711111111111 0.22755555555555554 0.18133333333333332 0.24711111111111111 0.3688888888888889 0.24711111111111111 0.5404444444444444v4.298666666666667l0.8888888888888888 -0.6764444444444444c0.9813333333333334 -0.7084444444444444 0.8888888888888888 -1.1893333333333334 0.8888888888888888 -2.1706666666666665z"></path>
                  <path fill="#e1e8ed" d="M24.58311111111111 13.11111111111111C21.055999999999997 10.333333333333332 12.623111111111111 3.8213333333333335 11.497777777777777 2.998222222222222l-1.8426666666666665 1.4657777777777776c3.0159999999999996 2.372444444444444 11.094222222222221 8.605333333333332 13.208888888888888 10.28711111111111 0.032888888888888884 0.025777777777777778 0.05333333333333333 0.05244444444444444 0.07733333333333332 0.0782222222222222L24.802666666666664 13.333333333333332c-0.05333333333333333 -0.07733333333333332 -0.12977777777777777 -0.152 -0.21955555555555553 -0.2222222222222222z"></path>
                </svg>
              </div>
              <div class="registry-plugin-info">
                <h4>{{ plugin.name }}</h4>
                <p class="registry-plugin-description">{{ plugin.description }}</p>
                <div class="registry-plugin-meta">
                  <span class="registry-plugin-author">{{ plugin.author }}</span>
                </div>
              </div>
              <div class="registry-plugin-actions">
                <button
                  v-if="isPluginInstalled(plugin.id)"
                  class="btn btn-secondary"
                  disabled
                >
                  Installed
                </button>
                <button
                  v-else
                  class="btn btn-primary"
                  @click="installFromRegistry(plugin)"
                  :disabled="installing"
                >
                  Install
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ZIP -->
        <div v-else class="install-method-content">
          <p>Install from ZIP file or URL:</p>

          <div class="zip-input-section">
            <div class="url-input-wrapper">
              <input
                v-model="zipUrl"
                type="text"
                placeholder="https://github.com/owner/repo/releases/download/v1.0.0/plugin.zip"
                class="url-input"
                @keyup.enter="installFromUrl"
                @contextmenu.stop
              />
            </div>

            <div class="zip-divider">
              <span>OR</span>
            </div>

            <div class="file-input-wrapper">
              <input
                ref="fileInput"
                type="file"
                accept=".zip"
                @change="handleFileSelect"
                class="file-input"
              />
              <button class="btn btn-secondary" @click="triggerFileSelect">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>
                  <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/>
                </svg>
                Choose File
              </button>
              <span class="file-name">{{ selectedFileName || 'No file selected' }}</span>
            </div>
          </div>

          <p class="install-hint">
            Plugin must be a ZIP archive containing manifest.json and plugin code.
          </p>
        </div>

        <div class="install-actions">
          <button class="btn btn-primary install-close-btn" @click="closeInstallDialog">Close</button>
          <button
            v-if="installMethod === 'zip' && zipUrl"
            class="btn btn-primary"
            @click="installFromUrl"
            :disabled="installing"
          >
            Install from URL
          </button>
          <button
            v-else-if="installMethod === 'zip' && selectedFile"
            class="btn btn-primary"
            @click="uploadPlugin"
            :disabled="installing"
          >
            Install from File
          </button>
        </div>
      </div>
    </div>
  </Dialog>

  <!-- Update Plugin Dialog -->
  <Dialog v-if="showUpdateDialog && selectedPluginForUpdate" @close="showUpdateDialog = false" :show-header="false" size="small">
    <div class="update-dialog">
      <h3>Update {{ selectedPluginForUpdate.name }}</h3>

      <div v-if="updateError" class="error">
        {{ updateError }}
      </div>

      <div v-if="updating" class="updating-state">
        <div class="loading-spinner"></div>
        <p>Updating plugin...</p>
      </div>

      <div v-else-if="!updateInfo && !updateError" class="updating-state">
        <div class="loading-spinner"></div>
        <p>Checking for updates...</p>
      </div>

      <div v-else-if="updateInfo" class="update-info">
        <div class="version-info">
          <div class="version-row">
            <span class="label">Current version:</span>
            <span class="version">v{{ updateInfo.currentVersion }}</span>
          </div>
          <div class="version-row">
            <span class="label">Latest version:</span>
            <span class="version new-version">v{{ updateInfo.latestVersion }}</span>
          </div>
          <div class="version-row" v-if="updateInfo.publishedAt">
            <span class="label">Published:</span>
            <span class="date">{{ new Date(updateInfo.publishedAt).toLocaleDateString() }}</span>
          </div>
        </div>

        <div v-if="updateInfo.releaseNotes" class="release-notes">
          <h4>Release Notes</h4>
          <div class="notes-content">{{ updateInfo.releaseNotes }}</div>
        </div>

        <div class="update-actions">
          <button class="btn btn-secondary" @click="showUpdateDialog = false" :disabled="updating">Cancel</button>
          <a
            v-if="updateInfo.releaseUrl"
            :href="updateInfo.releaseUrl"
            target="_blank"
            class="btn btn-secondary"
          >
            View on GitHub
          </a>
          <button
            class="btn btn-primary"
            @click="performUpdate"
            :disabled="updating || !updateInfo.hasUpdate"
          >
            Update
          </button>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import Dialog from '@/components/Dialog.vue';
import ConfirmPanel from '@/components/ConfirmPanel.vue';
import { api } from '@/lib/api';
import { settingsStore } from '@/lib/settings-store';
import {
  fetchPlugins,
  fetchPluginConfigUI,
  installPlugin as installPluginRequest,
  setPluginEnabled,
  reloadPlugin as reloadPluginRequest,
  uninstallPlugin as uninstallPluginRequest,
  reorderPlugins,
  checkPluginUpdate,
  updatePlugin,
  PluginListItem,
  PluginUpdateInfo
} from './api';

const plugins = ref<PluginListItem[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const reloading = ref<string | null>(null);
const toggling = ref<string | null>(null);
const uninstalling = ref<string | null>(null);
const selectedPlugin = ref<PluginListItem | null>(null);
const showUninstallConfirm = ref(false);
const showCategoryConflict = ref(false);
const conflictingPlugins = ref<Array<{ id: string; name: string }>>([]);
const conflictCategory = ref<string>('');
const showInstallDialog = ref(false);
const selectedFile = ref<File | null>(null);
const selectedFileName = ref<string>('');
const installing = ref(false);
const installSuccess = ref(false);
const installCategoryConflict = ref(false);
const installError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const showConfigPanel = ref(false);
const selectedPluginForConfig = ref<PluginListItem | null>(null);
const configUIContent = ref('');
const configIframe = ref<HTMLIFrameElement | null>(null);
const installMethod = ref<'zip' | 'registry'>('registry');
const zipUrl = ref<string>('');
const registryPlugins = ref<any[]>([]);
const registrySearch = ref<string>('');
const loadingRegistry = ref(false);
const registryError = ref<string | null>(null);
const registryCacheExpiry = ref<number>(0);
const brokenRegistryIcons = ref<Record<string, boolean>>({});
let unsubscribePluginsChanged: (() => void) | null = null;
let refreshPending = false;
const brokenIcons = ref<Record<string, boolean>>({});

// Update checking state
const showUpdateDialog = ref(false);
const selectedPluginForUpdate = ref<PluginListItem | null>(null);
const updateInfo = ref<PluginUpdateInfo | null>(null);
const updating = ref(false);
const updateError = ref<string | null>(null);

// Check if plugin reordering is allowed from settings
const allowPriorityReordering = computed(() =>
  settingsStore.data?.plugins?.allowPriorityReordering ?? false
);

// Separate plugins by priority for drag-n-drop
const sortablePlugins = computed(() =>
  plugins.value.filter(p => p.priority !== undefined && p.priority !== null)
);

const otherPlugins = computed(() =>
  plugins.value.filter(p => p.priority === undefined || p.priority === null)
);

// Drag-n-drop state
let draggedPluginId: string | null = null;

const handleDragStart = (pluginId: string, event: DragEvent) => {
  draggedPluginId = pluginId;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', (event.target as HTMLElement).innerHTML);
  }
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
};

const handleDragEnter = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

const handleDrop = async (targetIndex: number, event: DragEvent) => {
  event.preventDefault();

  if (!draggedPluginId) {
    return;
  }

  const fromIndex = sortablePlugins.value.findIndex(p => p.id === draggedPluginId);
  if (fromIndex === -1 || fromIndex === targetIndex) {
    draggedPluginId = null;
    return;
  }

  // Reorder the sortable plugins array
  const items = [...sortablePlugins.value];
  const [removed] = items.splice(fromIndex, 1);
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
    await reorderPlugins(pluginIds);
  } catch (error) {
    console.error('Failed to reorder plugins:', error);
    // Revert the local change
    await loadPlugins();
  } finally {
    draggedPluginId = null;
  }
};

const handleDragEnd = () => {
  draggedPluginId = null;
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

const savePluginConfig = () => {
  if (configIframe.value && configIframe.value.contentWindow) {
    configIframe.value.contentWindow.postMessage({ type: 'save-config' }, '*');
  }
};

const onConfigIframeLoad = () => {
  // Inject theme CSS variables into iframe
  if (configIframe.value && configIframe.value.contentWindow && configIframe.value.contentDocument) {
    // Get computed styles from body element since theme classes are applied there
    const computedStyle = getComputedStyle(document.body);
    const iframeRoot = configIframe.value.contentDocument.documentElement;

    // Get all CSS variables from the parent and inject into iframe
    const cssVars = [
      '--color-bg',
      '--color-surface',
      '--color-surface-muted',
      '--color-border',
      '--color-text-primary',
      '--color-text-secondary',
      '--color-accent',
      '--color-danger',
      '--gap-xs',
      '--gap-sm',
      '--gap-md',
      '--gap-lg',
      '--gap-xl',
      '--radius-small',
      '--radius-medium'
    ];

    cssVars.forEach(varName => {
      const value = computedStyle.getPropertyValue(varName);
      if (value) {
        iframeRoot.style.setProperty(varName, value);
      }
    });

    // Set body background color directly with the actual color value
    const iframeBody = configIframe.value.contentDocument.body;
    if (iframeBody) {
      const bgColor = computedStyle.getPropertyValue('--color-bg').trim();
      const textColor = computedStyle.getPropertyValue('--color-text-primary').trim();

      console.log('Setting iframe colors:', { bgColor, textColor });

      iframeBody.style.backgroundColor = bgColor;
      iframeBody.style.color = textColor;
      iframeBody.style.margin = '0';
      iframeBody.style.padding = '20px';
    }
  }
};

const openConfigPanel = async (plugin: PluginListItem) => {
  if (!plugin.hasConfig) {
    loadError.value = 'Plugin does not expose a configuration panel.';
    return;
  }

  try {
    const pluginConfigHTML = await fetchPluginConfigUI(plugin.id);

    // Wrap the plugin config HTML with proper HTML structure and styling
    configUIContent.value = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            * {
              box-sizing: border-box;
            }
            body {
              margin: 0;
              padding: 20px;
              background-color: var(--color-bg);
              color: var(--color-text-primary);
              font-family: system-ui, -apple-system, sans-serif;
            }
            /* Add card styles to match main app */
            textarea, input[type="text"], input[type="number"] {
              background: var(--color-surface) !important;
              border: 1px solid var(--color-border) !important;
              border-radius: var(--radius-small) !important;
              color: var(--color-text-primary) !important;
              padding: 8px 12px !important;
              width: 100% !important;
              font-family: inherit !important;
              font-size: 14px !important;
            }
            textarea:focus, input:focus {
              outline: none !important;
              border-color: var(--color-accent) !important;
            }
            label {
              display: block;
              margin-bottom: 8px;
              font-weight: 500;
              color: var(--color-text-primary);
            }
            h1, h2, h3, h4 {
              color: var(--color-text-primary);
              margin-top: 0;
            }
          </style>
        </head>
        <body>
          ${pluginConfigHTML}
        </body>
      </html>
    `;

    selectedPluginForConfig.value = plugin;
    showConfigPanel.value = true;
  } catch (error: any) {
    loadError.value = error.message || 'Failed to load plugin configuration';
    console.error('Error loading plugin config:', error);
  }
};

const closeConfigPanel = () => {
  showConfigPanel.value = false;
  selectedPluginForConfig.value = null;
  configUIContent.value = '';
};

const loadPlugins = async () => {
  if (loading.value) {
    refreshPending = true;
    return;
  }

  loading.value = true;
  loadError.value = null;

  try {
    plugins.value = await fetchPlugins();
    const filteredEntries = Object.entries(brokenIcons.value).filter(([id]) =>
      plugins.value.some(plugin => plugin.id === id)
    );
    const filteredMap = Object.fromEntries(filteredEntries) as Record<string, boolean>;
    plugins.value.forEach(plugin => {
      if (plugin.hasIcon && filteredMap[plugin.id]) {
        delete filteredMap[plugin.id];
      }
    });
    brokenIcons.value = filteredMap;
  } catch (error: any) {
    loadError.value = error.message || 'Failed to load plugins';
    console.error('Error loading plugins:', error);
  } finally {
    loading.value = false;
    if (refreshPending) {
      refreshPending = false;
      loadPlugins();
    }
  }
};

const reloadPlugin = async (pluginId: string) => {
  reloading.value = pluginId;

  try {
    await reloadPluginRequest(pluginId);
    // loadPlugins() will be triggered by the 'plugins:tools-changed' WebSocket event
  } catch (error: any) {
    loadError.value = error.message || 'Failed to reload plugin';
    console.error('Error reloading plugin:', error);
  } finally {
    reloading.value = null;
  }
};

const togglePlugin = async (plugin: PluginListItem) => {
  toggling.value = plugin.id;

  try {
    await setPluginEnabled(plugin.id, !plugin.enabled);
    await loadPlugins();
  } catch (error: any) {
    console.log('Toggle error:', JSON.stringify({
      hasResponse: !!error.response,
      status: error.response?.status,
      data: error.response?.data
    }));

    if (error.response?.status === 409 && error.response?.data?.error === 'CATEGORY_CONFLICT') {
      selectedPlugin.value = plugin;
      conflictingPlugins.value = error.response.data.conflictingPlugins;
      conflictCategory.value = error.response.data.category;
      showCategoryConflict.value = true;
    } else {
      loadError.value = error.message || 'Failed to toggle plugin';
      console.error('Error toggling plugin:', error);
    }
  } finally {
    toggling.value = null;
  }
};

const confirmUninstall = (plugin: PluginListItem) => {
  selectedPlugin.value = plugin;
  showUninstallConfirm.value = true;
};
// Show update dialog
const showUpdateInfo = async (plugin: PluginListItem) => {
  selectedPluginForUpdate.value = plugin;
  updateError.value = null;
  showUpdateDialog.value = true;

  // Check for updates when dialog is opened
  if (plugin.repository) {
    try {
      updateInfo.value = null; // Clear previous info
      const info = await checkPluginUpdate(plugin.id);
      plugin.updateInfo = info;
      updateInfo.value = info;
    } catch (error: any) {
      console.error(`Failed to check update for ${plugin.id}:`, JSON.stringify(error));
      updateError.value = error.message || 'Failed to check for updates';
      updateInfo.value = null;
    }
  }
};

// Perform plugin update
const performUpdate = async () => {
  if (!selectedPluginForUpdate.value) return;

  updating.value = true;
  updateError.value = null;

  try {
    await updatePlugin(selectedPluginForUpdate.value.id);
    showUpdateDialog.value = false;
    await loadPlugins();
  } catch (error: any) {
    updateError.value = error.message || 'Failed to update plugin';
    console.error('Error updating plugin:', error);
  } finally {
    updating.value = false;
  }
};

const uninstallPlugin = async () => {
  if (!selectedPlugin.value) return;

  const pluginId = selectedPlugin.value.id;
  uninstalling.value = pluginId;
  showUninstallConfirm.value = false;

  try {
    await uninstallPluginRequest(pluginId);
    await loadPlugins();
  } catch (error: any) {
    loadError.value = error.message || 'Failed to uninstall plugin';
    console.error('Error uninstalling plugin:', error);
  } finally {
    uninstalling.value = null;
    selectedPlugin.value = null;
  }
};

const triggerFileSelect = () => {
  fileInput.value?.click();
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (file) {
    selectedFile.value = file;
    selectedFileName.value = file.name;
  }
};

const uploadPlugin = async () => {
  if (!selectedFile.value) return;

  installing.value = true;
  installError.value = null;

  try {
    await installPluginRequest(selectedFile.value);
    installSuccess.value = true;
    await loadPlugins();
  } catch (error: any) {
    if (error.response?.status === 409 && (error.response?.data?.error === 'CATEGORY_CONFLICT' || error.response?.data?.error?.includes('CATEGORY_CONFLICT'))) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    if (error.message?.includes('CATEGORY_CONFLICT')) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    installError.value = error.message || 'Failed to install plugin';
    console.error('Error installing plugin:', error);
  } finally {
    installing.value = false;
  }
};

const installFromUrl = async () => {
  if (!zipUrl.value) return;

  installing.value = true;
  installError.value = null;

  try {
    const response = await fetch(`${api.baseUrl}/api/plugins/install-from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: zipUrl.value }),
    });

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        throw new Error('Invalid JSON response from server');
      }
    } else {
      // Not JSON - try to get text for debugging
      const text = await response.text();
      console.error('Non-JSON response:', text.substring(0, 200));
      throw new Error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      if (response.status === 409 && (data.error === 'CATEGORY_CONFLICT' || data.error?.includes('CATEGORY_CONFLICT'))) {
        installCategoryConflict.value = true;
        installing.value = false;
        await loadPlugins();
        return;
      }
      throw new Error(data.error || 'Failed to install plugin from URL');
    }

    installSuccess.value = true;
    await loadPlugins();
  } catch (error: any) {
    if (error.message?.includes('CATEGORY_CONFLICT')) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    installError.value = error.message || 'Failed to install plugin from URL';
    console.error('Error installing plugin from URL:', error);
  } finally {
    installing.value = false;
  }
};


const openInstallDialog = () => {
  showInstallDialog.value = true;
  loadRegistryPlugins();
};

const closeInstallDialog = () => {
  showInstallDialog.value = false;
  selectedFile.value = null;
  selectedFileName.value = '';
  zipUrl.value = '';
  installMethod.value = 'registry';
  installing.value = false;
  installSuccess.value = false;
  installCategoryConflict.value = false;
  installError.value = null;

  if (fileInput.value) {
    fileInput.value.value = '';
  }
};

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const REGISTRY_URL = 'https://raw.githubusercontent.com/siganberg/ncSender.plugins-registry/main/plugins.json';
const CACHE_DURATION = 3600000;

const filteredRegistryPlugins = computed(() => {
  if (!registrySearch.value) return registryPlugins.value;

  const search = registrySearch.value.toLowerCase();
  return registryPlugins.value.filter(plugin =>
    plugin.name.toLowerCase().includes(search) ||
    plugin.description.toLowerCase().includes(search) ||
    plugin.author.toLowerCase().includes(search)
  );
});

const loadRegistryPlugins = async () => {
  const now = Date.now();
  if (registryPlugins.value.length > 0 && now < registryCacheExpiry.value) {
    return;
  }

  loadingRegistry.value = true;
  registryError.value = null;

  try {
    const response = await fetch(REGISTRY_URL, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to fetch registry: ${response.statusText}`);
    }

    const data = await response.json();
    registryPlugins.value = data;
    registryCacheExpiry.value = now + CACHE_DURATION;
  } catch (error: any) {
    registryError.value = error.message || 'Failed to load plugin registry';
    console.error('Error loading registry:', error);
  } finally {
    loadingRegistry.value = false;
  }
};

const isPluginInstalled = (pluginId: string) => {
  return plugins.value.some(p => p.id === pluginId);
};

const installFromRegistry = async (plugin: any) => {
  installing.value = true;
  installError.value = null;

  try {
    const repoPath = plugin.repository.replace('https://github.com/', '');
    const apiUrl = `https://api.github.com/repos/${repoPath}/releases/latest`;

    const releaseResponse = await fetch(apiUrl);
    if (!releaseResponse.ok) {
      throw new Error('Failed to fetch latest release information');
    }

    const releaseData = await releaseResponse.json();
    const zipAsset = releaseData.assets.find((asset: any) => asset.name.endsWith('.zip'));

    if (!zipAsset) {
      throw new Error('No ZIP file found in latest release');
    }

    const response = await fetch(`${api.baseUrl}/api/plugins/install-from-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: zipAsset.browser_download_url }),
    });

    let data;
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error('Invalid JSON response from server');
      }
    } else {
      const text = await response.text();
      throw new Error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      if (response.status === 409 && (data.error === 'CATEGORY_CONFLICT' || data.error?.includes('CATEGORY_CONFLICT'))) {
        installCategoryConflict.value = true;
        installing.value = false;
        await loadPlugins();
        return;
      }
      throw new Error(data.error || 'Failed to install plugin from registry');
    }

    installSuccess.value = true;
    await loadPlugins();
  } catch (error: any) {
    if (error.message?.includes('CATEGORY_CONFLICT')) {
      installCategoryConflict.value = true;
      installing.value = false;
      await loadPlugins();
      return;
    }
    installError.value = error.message || 'Failed to install plugin from registry';
    console.error('Error installing plugin from registry:', error);
  } finally {
    installing.value = false;
  }
};

const handleRegistryIconError = (pluginId: string) => {
  brokenRegistryIcons.value[pluginId] = true;
};

onMounted(() => {
  loadPlugins();

  unsubscribePluginsChanged = api.on('plugins:tools-changed', () => {
    loadPlugins();
  });
});

onBeforeUnmount(() => {
  if (unsubscribePluginsChanged) {
    unsubscribePluginsChanged();
    unsubscribePluginsChanged = null;
  }
});
</script>

<style scoped>
.plugins-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  color: var(--color-text-primary);
}

.error {
  color: var(--color-danger, #f87171);
  padding: var(--gap-sm) var(--gap-md);
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: var(--radius-small);
  margin-bottom: var(--gap-md);
}

.plugins-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.plugins-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.plugins-scrollable {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  background: var(--color-surface);
}

.header-info {
  display: flex;
  align-items: baseline;
  gap: var(--gap-sm);
}

.header-info h3 {
  margin: 0;
  font-size: 1.1rem;
}

.plugin-count {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.btn {
  background: var(--color-accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-small);
  padding: 8px 16px;
  cursor: pointer;
  font-weight: 600;
  transition: opacity 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
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
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px;
  color: var(--color-text-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.btn-icon:hover:not(:disabled) {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-icon:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.btn-icon-danger:hover:not(:disabled) {
  border-color: var(--color-danger, #f87171);
  color: var(--color-danger, #f87171);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-secondary);
  gap: var(--gap-sm);
}

.empty-state svg {
  opacity: 0.3;
  margin-bottom: var(--gap-md);
}

.empty-state p {
  margin: 0;
}

.empty-hint {
  font-size: 0.9rem;
  opacity: 0.7;
}

.plugins-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--gap-md);
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.plugin-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  padding: var(--gap-md);
  transition: border-color 0.2s ease;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--gap-md);
  align-items: center;
}

.plugin-card:hover {
  border-color: var(--color-accent);
}

.plugin-thumbnail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.plugin-thumbnail:has(.plugin-icon-placeholder) {
  background: transparent;
  border-radius: 0;
}

.plugin-thumbnail svg {
  opacity: 0.5;
}

.plugin-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.plugin-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.plugin-title-row {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  flex-wrap: wrap;
}

.plugin-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.plugin-version {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  background: var(--color-surface-muted);
  padding: 2px 8px;
  border-radius: 12px;
}

.plugin-status {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 600;
}

.plugin-status--loaded {
  background: rgba(52, 211, 153, 0.2);
  color: #34d399;
}

.plugin-status--unloaded {
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}

.plugin-actions {
  display: flex;
  gap: 6px;
}

.plugin-author {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  margin: 0;
}

.plugin-meta {
  display: flex;
  gap: var(--gap-md);
  flex-wrap: wrap;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.meta-item svg {
  opacity: 0.6;
}

.install-dialog {
  padding: var(--gap-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.install-dialog--compact {
  height: auto;
}

.install-dialog h3 {
  margin-top: 0;
}

.install-dialog code {
  background: var(--color-surface-muted);
  padding: 2px 6px;
  border-radius: var(--radius-small);
  font-size: 0.85rem;
}

.install-hint {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin-bottom: var(--gap-md);
}

.install-hint code {
  word-break: break-all;
  white-space: normal;
  display: inline-block;
}

.example-url-wrapper {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  margin-top: 4px;
}

.example-url {
  flex: 1;
  user-select: all;
  cursor: text;
}

.btn-copy {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 4px 6px;
  cursor: pointer;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.btn-copy:hover {
  background: var(--color-surface-muted);
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.btn-copy svg {
  display: block;
}

.install-dialog .btn {

}

.install-tabs {
  display: flex;
  gap: var(--gap-sm);
  margin-bottom: var(--gap-lg);
  border-bottom: 2px solid var(--color-border);
}

.tab-button {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: var(--gap-sm) var(--gap-md);
  margin-bottom: -2px;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.tab-button:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-muted);
}

.tab-button.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.tab-button svg {
  width: 18px;
  height: 18px;
}

.install-method-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.install-method-content p {
  margin: 0;
  color: var(--color-text-primary);
}

.url-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.url-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
  transition: border-color 0.2s ease;
}

.url-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.url-input::placeholder {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.install-note {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: var(--radius-small);
  padding: var(--gap-sm) var(--gap-md);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.install-note code {
  background: rgba(59, 130, 246, 0.15);
  padding: 2px 6px;
  border-radius: 3px;
}

.install-note svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: #3b82f6;
}

.file-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
}

.file-input {
  display: none;
}

.btn-secondary {
  background: var(--color-surface-muted);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-surface);
}

.file-name {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.install-actions {
  display: flex;
  justify-content: center;
  gap: var(--gap-sm);
  margin-top: var(--gap-md);
}

.install-actions .btn {
  display: flex;
  align-items: center;
  justify-content: center;
}

.install-close-btn {
  padding: 12px 24px !important;
}

.installing-state,
.success-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl) var(--gap-md);
  text-align: center;
}

.install-dialog:not(.install-dialog--compact) .installing-state,
.install-dialog:not(.install-dialog--compact) .success-state {
  flex: 1;
  height: 100%;
}

.installing-state p,
.success-state p {
  margin: var(--gap-md) 0;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--color-surface-muted);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.success-state svg {
  color: #34d399;
}

.success-message {
  font-size: 1rem;
  font-weight: 400;
  color: var(--color-text-primary);
}

.upload-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.upload-form p {
  margin-bottom: var(--gap-sm);
}

.zip-input-section {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
}

.zip-divider {
  text-align: center;
  position: relative;
  margin: var(--gap-sm) 0;
}

.zip-divider span {
  background: var(--color-surface);
  padding: 0 var(--gap-md);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  position: relative;
  z-index: 1;
}

.zip-divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--color-border);
}

.registry-search {
  margin-bottom: var(--gap-md);
}

.loading-registry {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--gap-xl);
  text-align: center;
  color: var(--color-text-secondary);
}

.loading-registry .loading-spinner {
  width: 32px;
  height: 32px;
  margin-bottom: var(--gap-md);
}

.no-plugins {
  text-align: center;
  padding: var(--gap-xl);
  color: var(--color-text-secondary);
}

.registry-list {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.registry-plugin {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
  padding: var(--gap-md);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  transition: all 0.2s ease;
}

.registry-plugin:hover {
  background: var(--color-surface);
  border-color: var(--color-accent);
}

.registry-plugin-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.registry-plugin-icon:has(img) {
  background: var(--color-surface);
  border-radius: var(--radius-small);
}

.registry-plugin-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.registry-plugin-icon svg {
  color: var(--color-text-secondary);
  opacity: 0.6;
}

.registry-plugin-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.registry-plugin-info h4 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.registry-plugin-description {
  margin: 0 0 0 0 !important;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.registry-plugin-meta {
  display: flex;
  align-items: center;
  gap: var(--gap-md);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.registry-plugin-author {
  display: flex;
  align-items: center;
  gap: 4px;
}

.registry-plugin-version {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
}

.registry-plugin-actions {
  flex-shrink: 0;
}

.registry-plugin-actions .btn {
  min-width: 100px;
}

.config-panel-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.config-panel-header {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  padding: var(--gap-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  flex-shrink: 0;
}

.config-header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--gap-md);
}

.config-panel-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.btn-back {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  padding: 8px 12px;
  cursor: pointer;
  color: var(--color-text-primary);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.btn-back:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.config-panel-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.config-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  overflow: hidden;
}

.config-panel-content :deep(h1),
.config-panel-content :deep(h2),
.config-panel-content :deep(h3),
.config-panel-content :deep(h4) {
  margin-top: 0;
  color: var(--color-text-primary);
}

.config-panel-content :deep(label) {
  display: block;
  margin-bottom: var(--gap-xs);
  font-weight: 500;
  color: var(--color-text-primary);
}

.config-panel-content :deep(input[type="text"]),
.config-panel-content :deep(input[type="number"]),
.config-panel-content :deep(textarea) {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-family: inherit;
}

.config-panel-content :deep(input[type="text"]:focus),
.config-panel-content :deep(input[type="number"]:focus),
.config-panel-content :deep(textarea:focus) {
  outline: none;
  border-color: var(--color-accent);
}

.config-panel-content :deep(button) {
  background: var(--color-accent);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-small);
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.2s ease;
}

.config-panel-content :deep(button:hover) {
  opacity: 0.9;
}

.plugins-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0 var(--gap-md) var(--gap-md) var(--gap-md);
}

.plugins-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 20px;
}

.section-header {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.plugins-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-row {
  display: grid;
  grid-template-columns: 24px 64px 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 16px;
  padding-left: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-medium);
  transition: all 0.15s ease;
  min-height: 80px;
}

.plugin-row:hover {
  background: var(--color-surface-muted);
}

.plugin-row[draggable="true"] {
  cursor: move;
}

.plugin-row[draggable="true"]:active {
  cursor: grabbing;
}

.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  cursor: grab;
  opacity: 0.6;
  transition: opacity 0.2s ease;
  height: 100%;
  min-height: 48px;
}

.drag-handle svg {
  width: 20px;
  height: 20px;
}

.plugin-row:hover .drag-handle {
  opacity: 1;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle-placeholder {
  width: 24px;
}

.plugin-icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.plugin-icon-small {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-small);
  object-fit: contain;
}

.plugin-icon-placeholder {
  width: 64px;
  height: 64px;
  opacity: 0.6;
}

.plugin-info-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.plugin-name-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.plugin-name-text {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: 0.95rem;
}

.plugin-meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.plugin-category-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  text-transform: capitalize;
  background: var(--color-surface-muted);
  padding: 2px 8px;
  border-radius: 12px;
}

.plugin-version-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  background: var(--color-surface-muted);
  padding: 2px 8px;
  border-radius: 12px;
}

.plugin-installed-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.status-enabled {
  background: rgba(46, 160, 67, 0.15);
  color: #2ea043;
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

.plugin-version-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.plugin-version-text.clickable {
  cursor: pointer;
  color: var(--color-accent);
  text-decoration: underline;
}

.plugin-version-text.clickable:hover {
  opacity: 0.8;
}

.plugin-version-text.has-update {
  font-weight: 600;
}

.update-badge {
  display: inline-flex;
  align-items: center;
  color: var(--color-accent);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.update-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--gap-md);
  padding: var(--gap-lg);
}

.update-dialog h3 {
  margin: 0;
  font-size: 1.2rem;
  color: var(--color-text-primary);
}

.updating-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap-md);
  padding: var(--gap-xl) 0;
}

.loading-spinner {
  border: 3px solid var(--color-border);
  border-top: 3px solid var(--color-accent);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.update-info {
  display: flex;
  flex-direction: column;
  gap: var(--gap-lg);
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
  padding: var(--gap-md);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
}

.version-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.version-row .label {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.version-row .version {
  font-weight: 600;
  color: var(--color-text-primary);
}

.version-row .new-version {
  color: var(--color-accent);
}

.version-row .date {
  color: var(--color-text-primary);
  font-size: 0.9rem;
}

.release-notes {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.release-notes h4 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text-primary);
}

.notes-content {
  padding: var(--gap-md);
  background: var(--color-surface-muted);
  border-radius: var(--radius-small);
  border: 1px solid var(--color-border);
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-primary);
}

.update-actions {
  display: flex;
  gap: var(--gap-sm);
  justify-content: flex-end;
  padding-top: var(--gap-md);
  border-top: 1px solid var(--color-border);
}

.update-actions .btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.update-actions .btn-secondary:hover {
  background: var(--color-surface-muted);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>

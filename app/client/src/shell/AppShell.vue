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
  <div class="shell">
    <header class="shell__top">
      <slot name="top-toolbar" />
    </header>
    <main class="shell__main">
      <section class="shell__content">
        <slot name="main" />
      </section>
    </main>
    <footer class="shell__utility">
      <slot name="utility-bar" />
    </footer>
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--gap-sm);
  width: 100%;
  height: 100vh; /* Full viewport height */
  background: var(--color-bg);
  position: relative;
}

.shell__top {
  padding: var(--gap-sm) var(--gap-sm) 0;
}

.shell__main {
  padding: 0 var(--gap-sm);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gap-md);
  min-height: 0; /* Allow shrinking */
  overflow: hidden; /* Prevent content overflow */
}

.shell__content {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(550px, 1fr);
  gap: var(--gap-sm);
  height: 100%;
  min-height: 0; /* Allow shrinking */
  overflow: hidden;
}

.shell__utility {

}

@media (max-width: 1279px) {
  .shell__content {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    height: 100%;
    overflow: hidden;
  }
}

@media (max-width: 959px) {
  .shell {
    gap: var(--gap-sm);
  }

  .shell__top,
  .shell__main,
  .shell__utility {
    padding: 0 var(--gap-sm);
  }

  .shell__main {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

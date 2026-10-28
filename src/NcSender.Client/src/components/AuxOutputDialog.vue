<!--
  Add or edit one auxiliary output (Settings > Auxiliary I/O): its name, the
  command that turns it on (the off command follows from it), Hold and Quick.
  The list itself only shows the outputs and switches them enabled.
-->
<template>
  <Dialog :show-header="false" size="small" :z-index="10001" @close="$emit('cancel')">
    <form class="aux-dialog" @submit.prevent="save">
      <h2 class="aux-dialog__title">{{ isNew ? 'Add Output' : 'Edit Output' }}</h2>

      <div class="aux-dialog__field">
        <label class="aux-dialog__label" for="aux-dialog-name">Name</label>
        <input id="aux-dialog-name" v-model="form.name" type="text" class="aux-dialog__input" placeholder="Name" />
      </div>

      <div class="aux-dialog__field">
        <label class="aux-dialog__label" for="aux-dialog-on">Output</label>
        <select id="aux-dialog-on" v-model="form.on" class="aux-dialog__input">
          <option v-for="cmd in commands" :key="cmd.value" :value="cmd.value">{{ cmd.label }}</option>
        </select>
        <p v-if="offLabel(form.on)" class="aux-dialog__help">Off: {{ offLabel(form.on) }}</p>
      </div>

      <div class="aux-dialog__option">
        <div class="aux-dialog__option-text">
          <span class="aux-dialog__label">Hold</span>
          <span class="aux-dialog__help">Require 1-second hold to activate — protects against accidental clicks on safety-critical outputs (e.g. pneumatic collet release).</span>
        </div>
        <ToggleSwitch v-model="form.holdToActivate" />
      </div>

      <div class="aux-dialog__option">
        <div class="aux-dialog__option-text">
          <span class="aux-dialog__label">Auto Off</span>
          <span class="aux-dialog__help">Turn the output on for this long, then off again on its own. Saves air on outputs such as a drawbar.</span>
        </div>
        <select v-model.number="form.quickSec" class="aux-dialog__input aux-dialog__quick">
          <option :value="0">Off</option>
          <option v-for="sec in AUX_QUICK_SECS" :key="sec" :value="sec">{{ sec }} s</option>
        </select>
      </div>

      <div class="aux-dialog__footer">
        <button v-if="!isNew" type="button" class="aux-dialog__btn aux-dialog__btn--danger" @click="$emit('delete')">Delete</button>
        <span class="aux-dialog__spacer"></span>
        <button type="button" class="aux-dialog__btn aux-dialog__btn--secondary" @click="$emit('cancel')">Cancel</button>
        <button type="submit" class="aux-dialog__btn aux-dialog__btn--primary">Save</button>
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import Dialog from './Dialog.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import { AUX_QUICK_SECS, auxQuickSec } from '../lib/aux-outputs';

export type AuxOutputForm = { name: string; on: string; holdToActivate: boolean; quickSec: number };

const props = defineProps<{
  output: AuxOutputForm;
  isNew: boolean;
  commands: { value: string; label: string }[];
  offLabel: (on: string) => string;
}>();
const emit = defineEmits<{
  (e: 'save', value: AuxOutputForm): void;
  (e: 'delete'): void;
  (e: 'cancel'): void;
}>();

const form = reactive<AuxOutputForm>({
  name: props.output.name,
  on: props.output.on,
  holdToActivate: !!props.output.holdToActivate,
  quickSec: auxQuickSec(props.output.quickSec),
});

const save = () => emit('save', { ...form, name: form.name.trim() });
</script>

<style scoped>
.aux-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
}
.aux-dialog__title {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--color-text-primary);
}
.aux-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.aux-dialog__label {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text-primary);
}
.aux-dialog__input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-small);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: 0.9rem;
  font-family: inherit;
}
.aux-dialog__input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}
.aux-dialog__help {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
.aux-dialog__option {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border-radius: var(--radius-small);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
}
.aux-dialog__option-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.aux-dialog__quick {
  flex: 0 0 auto;
  width: 110px;
}
.aux-dialog__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
}
.aux-dialog__spacer { flex: 1; }
.aux-dialog__btn {
  border: none;
  border-radius: var(--radius-small);
  padding: var(--gap-sm) var(--gap-md);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
}
.aux-dialog__btn--primary { background: var(--color-accent); color: white; }
.aux-dialog__btn--secondary { background: var(--color-surface-muted); border: 1px solid var(--color-border); color: var(--color-text-primary); }
.aux-dialog__btn--danger { background: var(--color-danger, #f87171); color: white; }
</style>

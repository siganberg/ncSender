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
<!--
  A number field that also reads a value typed in another unit (1/4", 6mm:
  see lib/unit-input). `unit` is what the number is in (mm, in, mm/min,
  in/min); without one it is a plain number field. A plain number is followed
  as it is typed; anything else is read on Enter or when the field is left,
  before the parent's own Enter and change handlers run. Empty gives ''.
-->
<template>
  <input
    ref="input"
    type="text"
    inputmode="decimal"
    autocomplete="off"
    @beforeinput="refuseOtherChars($event, field)"
    @input="onInput"
    @change="commit"
    @keydown.enter="commit"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { dropOtherChars, parseUnitValue, plainNumber, refuseOtherChars, showValue, unitField } from '@/lib/unit-input';

const props = defineProps<{ modelValue?: number | string | null; unit?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: number | ''): void }>();

const input = ref<HTMLInputElement | null>(null);
const field = computed(() => unitField(props.unit));
const shown = computed(() => (props.modelValue === '' || props.modelValue == null ? '' : String(props.modelValue)));
onMounted(() => showValue(input.value, shown.value));
watch(shown, (v) => showValue(input.value, v), { flush: 'post' });

const onInput = (e: Event) => {
  const el = e.target as HTMLInputElement;
  dropOtherChars(el, field.value);
  if (el.value.trim() === '') { emit('update:modelValue', ''); return; }
  const v = plainNumber(el.value);
  if (v != null) emit('update:modelValue', v);
};
const commit = (e: Event) => {
  const el = e.target as HTMLInputElement;
  if (el.value.trim() === '') return;
  const v = parseUnitValue(el.value, field.value);
  if (v != null) {
    if (plainNumber(el.value) == null) el.value = String(v);
    emit('update:modelValue', v);
  }
  nextTick(() => { if (input.value) input.value.value = shown.value; });
};

defineExpose({
  focus: () => input.value?.focus(),
  select: () => input.value?.select(),
  blur: () => input.value?.blur(),
});
</script>

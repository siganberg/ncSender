/*
 * This file is part of ncSender.
 *
 * ncSender is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { ref, computed, onBeforeUnmount, type Ref } from 'vue';

/**
 * Shared hold-tap gesture for a button that triggers a safety-critical action.
 *
 *  - Quick tap (release before holdMs): arms a countdown; fires when it hits 0.
 *  - Long press (≥ holdMs): fires immediately. A hold-fill sweeps across the
 *    button during the hold as a visual affordance.
 *
 * Wire like:
 *
 *   const { armed, displayLabel, buttonRef, onPointerDown, onPointerUp,
 *           onPointerLeave, onPointerCancel } = useHoldTapConfirm({
 *     label: () => step.label,
 *     onFire: () => emit('fire'),
 *     holdMs: () => stepConfig.holdMs ?? 1000,
 *     countdownSec: () => stepConfig.countdownSec ?? 5,
 *     disabled: () => stepsAllDone.value,
 *   });
 *
 * `armed.value` = countdown running (disable the button to prevent re-tap).
 * `displayLabel.value` = label with `(Ns)` suffix while counting down.
 * `buttonRef` = template ref; assign to the button's `:ref="buttonRef"` (or
 * a function ref if the button lives inside `<template v-for>`).
 */
export interface UseHoldTapConfirmOptions {
  label: () => string;
  onFire: () => void;
  holdMs?: () => number;
  countdownSec?: () => number;
  disabled?: () => boolean;
}

export function useHoldTapConfirm(opts: UseHoldTapConfirmOptions) {
  const buttonRef = ref<HTMLButtonElement | null>(null);
  const armed = ref(false);
  const countdown = ref<number | null>(null);
  let holdTimer: number | null = null;
  let countdownTimer: number | null = null;

  const holdMs = computed(() => Math.max(200, opts.holdMs?.() ?? 1000));
  const countdownSec = computed(() => Math.max(1, opts.countdownSec?.() ?? 5));
  const disabled = computed(() => !!opts.disabled?.());

  const displayLabel = computed(() =>
    countdown.value !== null ? `${opts.label()} (${countdown.value}s)` : opts.label(),
  );

  const HOLD_FILL = 'linear-gradient(rgba(255,255,255,0.35), rgba(255,255,255,0.35))';
  function beginHoldFill(): void {
    const btn = buttonRef.value;
    if (!btn) return;
    btn.style.transition = 'none';
    btn.style.backgroundImage = HOLD_FILL;
    btn.style.backgroundRepeat = 'no-repeat';
    btn.style.backgroundSize = '0% 100%';
    // Force reflow so the 0%→100% transition actually runs.
    void btn.offsetWidth;
    btn.style.transition = `background-size ${holdMs.value}ms linear`;
    btn.style.backgroundSize = '100% 100%';
  }
  function clearHoldFill(): void {
    const btn = buttonRef.value;
    if (!btn) return;
    btn.style.transition = 'none';
    btn.style.backgroundImage = '';
    btn.style.backgroundSize = '';
  }

  function clearHoldTimer(): void {
    if (holdTimer !== null) { window.clearTimeout(holdTimer); holdTimer = null; }
    clearHoldFill();
  }
  function clearCountdown(): void {
    if (countdownTimer !== null) { window.clearInterval(countdownTimer); countdownTimer = null; }
    countdown.value = null;
    armed.value = false;
  }

  function fire(): void {
    clearHoldTimer();
    clearCountdown();
    opts.onFire();
  }

  function startCountdown(): void {
    armed.value = true;
    countdown.value = countdownSec.value;
    countdownTimer = window.setInterval(() => {
      if (countdown.value === null) return;
      countdown.value -= 1;
      if (countdown.value <= 0) fire();
    }, 1000);
  }

  function onPointerDown(): void {
    if (disabled.value || armed.value || holdTimer !== null) return;
    beginHoldFill();
    holdTimer = window.setTimeout(() => {
      holdTimer = null;
      clearHoldFill();
      fire();
    }, holdMs.value);
  }

  function releaseAndMaybeArm(shouldArm: boolean): void {
    if (holdTimer === null) return;
    window.clearTimeout(holdTimer);
    holdTimer = null;
    clearHoldFill();
    if (shouldArm && !disabled.value && !armed.value) startCountdown();
  }

  function onPointerUp():     void { releaseAndMaybeArm(true); }
  function onPointerLeave():  void { releaseAndMaybeArm(false); }
  function onPointerCancel(): void { releaseAndMaybeArm(false); }

  function cancel(): void { clearHoldTimer(); clearCountdown(); }

  onBeforeUnmount(cancel);

  return {
    buttonRef: buttonRef as Ref<HTMLButtonElement | null>,
    armed,
    countdown,
    displayLabel,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    cancel,
  };
}

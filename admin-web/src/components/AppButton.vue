<template>
  <button
    class="btn"
    :class="[variant, { block: block, disabled: disabled || loading }]"
    :disabled="disabled || loading"
    type="button"
  >
    <span v-if="loading" class="spin"></span>
    <slot />
  </button>
</template>

<script setup>
defineProps({
  variant: { type: String, default: 'default' }, // primary | default | tint | danger
  block: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
});
</script>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink-2);
  transition: background .15s, border-color .15s, opacity .15s;
}
.btn:active { opacity: .85; }
.btn.block { display: flex; width: 100%; }
.btn.disabled { opacity: .55; cursor: not-allowed; }

/* 只有主操作才用饱和色 */
.btn.primary {
  background: var(--red-deep);
  border-color: var(--red-deep);
  color: #fff;
}
.btn.tint {
  background: rgba(194, 24, 61, 0.08);
  border-color: transparent;
  color: var(--red-deep);
}
.btn.danger {
  background: #fff;
  border-color: rgba(194, 24, 61, 0.35);
  color: var(--red-deep);
}

.spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>

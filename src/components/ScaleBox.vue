<template>
  <div class="scale-box-wrapper">
    <div
      class="scale-box-content"
      :style="{
        width: `${designWidth}px`,
        height: `${designHeight}px`,
        transform: `scale(${scale}) translate(-50%, -50%)`,
        transformOrigin: '0 0'
      }"
    >
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    designWidth?: number;
    designHeight?: number;
  }>(),
  {
    designWidth: 1920,
    designHeight: 1080
  }
);

const scale = ref(1);

function updateScale() {
  const currentW = window.innerWidth;
  const currentH = window.innerHeight;

  const scaleW = currentW / props.designWidth;
  const scaleH = currentH / props.designHeight;

  // 等比例缩放，优先保证画面完整填充满视口
  scale.value = Math.min(scaleW, scaleH);
}

onMounted(() => {
  updateScale();
  window.addEventListener('resize', updateScale);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateScale);
});
</script>

<style scoped>
.scale-box-wrapper {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #07090e;
}

.scale-box-content {
  position: absolute;
  left: 50%;
  top: 50%;
  transition: transform 0.15s cubic-bezier(0, 0, 0.2, 1);
  overflow: hidden;
}
</style>
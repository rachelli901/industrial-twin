<template>
  <transition name="timeline-slide">
    <div v-if="store.isPlaybackMode" class="playback-timeline-bar">
      <div class="timeline-controls">
        <button class="ctrl-btn play-btn" @click="store.togglePlayPause()">
          {{ store.isPlaying ? '⏸ 暂停' : '▶ 播放' }}
        </button>

        <div class="speed-selector">
          <button
            v-for="spd in [1, 2, 4]"
            :key="spd"
            class="speed-btn"
            :class="{ active: store.playbackSpeed === spd }"
            @click="store.setSpeed(spd)"
          >
            {{ spd }}x
          </button>
        </div>

        <div class="slider-wrapper">
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            :value="store.playbackProgress"
            @input="onSliderChange"
            class="time-slider"
          />
          <div class="slider-fill" :style="{ width: `${store.playbackProgress}%` }"></div>
        </div>

        <div class="time-display">
          <span class="curr-time">{{ currentFrameTime }}</span>
          <span class="badge-history">复盘模式</span>
        </div>

        <button class="exit-btn" @click="store.togglePlaybackMode()">
          ✕ 退出复盘
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useWarehouseStore } from '../stores/warehouse';

const store = useWarehouseStore();

const currentFrameTime = computed(() => store.playbackFrameTime);

function onSliderChange(e: Event) {
  const target = e.target as HTMLInputElement;
  store.seekProgress(parseFloat(target.value));
}
</script>

<style scoped>
.playback-timeline-bar {
  pointer-events: auto;
  position: absolute;
  bottom: 96px; /* 位于底部库位卡片上方 */
  left: 50%;
  transform: translateX(-50%);
  width: 720px;
  background: rgba(15, 23, 42, 0.94);
  border: 1px solid #38bdf8;
  border-radius: 8px;
  padding: 10px 18px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  z-index: 15;
}

.timeline-controls {
  display: flex;
  align-items: center;
  gap: 14px;
}

.ctrl-btn {
  background: #0284c7;
  border: none;
  color: #fff;
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.ctrl-btn:hover {
  background: #0369a1;
}

.speed-selector {
  display: flex;
  background: rgba(30, 41, 59, 0.8);
  border-radius: 4px;
  padding: 2px;
  gap: 2px;
}

.speed-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.2s;
}

.speed-btn.active {
  background: #38bdf8;
  color: #0f172a;
  font-weight: 700;
}

.slider-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}

.time-slider {
  -webkit-appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #334155;
  outline: none;
  cursor: pointer;
  position: relative;
  z-index: 2;
}

.time-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 8px #38bdf8;
  cursor: pointer;
  transition: transform 0.1s;
}

.time-slider::-webkit-slider-thumb:hover {
  transform: scale(1.3);
}

.slider-fill {
  position: absolute;
  left: 0;
  height: 6px;
  background: #38bdf8;
  border-radius: 3px;
  z-index: 1;
  pointer-events: none;
}

.time-display {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 13px;
  color: #cbd5e1;
  white-space: nowrap;
}

.badge-history {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid #f59e0b;
  color: #fbbf24;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: sans-serif;
}

.exit-btn {
  background: transparent;
  border: 1px solid #475569;
  color: #94a3b8;
  padding: 5px 10px;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.exit-btn:hover {
  color: #fff;
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.2);
}

.timeline-slide-enter-active,
.timeline-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.timeline-slide-enter-from,
.timeline-slide-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}
</style>
<template>
  <transition name="modal-fade">
    <div v-if="visible" class="energy-modal-backdrop" @click.self="$emit('close')">
      <div class="energy-center-box">
        <div class="modal-header">
          <div class="title-left">
            <span class="icon">⚡</span>
            <span class="modal-title">模拟指标 · OEE 与动力能耗（非现场计量）</span>
          </div>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <!-- OEE 核心指标 -->
          <div class="oee-summary-grid">
            <div class="oee-card main-oee">
              <div class="card-label">综合稼动率 OEE</div>
              <div class="card-val">{{ store.oeeData.oeeScore }}%</div>
              <div class="progress-bar">
                <div class="fill fill-green" :style="{ width: `${store.oeeData.oeeScore}%` }"></div>
              </div>
            </div>
            <div class="oee-card">
              <div class="card-label">时间开动率 (Availability)</div>
              <div class="card-val">{{ store.oeeData.availability }}%</div>
              <div class="progress-bar">
                <div class="fill fill-blue" :style="{ width: `${store.oeeData.availability}%` }"></div>
              </div>
            </div>
            <div class="oee-card">
              <div class="card-label">性能稼动率 (Performance)</div>
              <div class="card-val">{{ store.oeeData.performance }}%</div>
              <div class="progress-bar">
                <div class="fill fill-yellow" :style="{ width: `${store.oeeData.performance}%` }"></div>
              </div>
            </div>
            <div class="oee-card">
              <div class="card-label">合格品率 (Quality)</div>
              <div class="card-val">{{ store.oeeData.quality }}%</div>
              <div class="progress-bar">
                <div class="fill fill-cyan" :style="{ width: `${store.oeeData.quality}%` }"></div>
              </div>
            </div>
          </div>

          <!-- 能耗核算 -->
          <div class="energy-row">
            <div class="energy-item">
              <span class="e-label">本班次动力总电耗</span>
              <span class="e-val">{{ store.oeeData.totalKwh }} <span class="unit">kWh</span></span>
            </div>
            <div class="energy-item">
              <span class="e-label">绿电协同碳减排</span>
              <span class="e-val green">{{ store.oeeData.co2Saved }} <span class="unit">kg CO₂</span></span>
            </div>
            <div class="energy-item">
              <span class="e-label">平均单箱搬运能耗</span>
              <span class="e-val">0.108 <span class="unit">kWh/箱</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useWarehouseStore } from '../stores/warehouse';

defineProps<{ visible: boolean }>();
defineEmits(['close']);

const store = useWarehouseStore();
</script>

<style scoped>
.energy-modal-backdrop {
  pointer-events: auto;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.energy-center-box {
  width: 720px;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid #0284c7;
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(2, 132, 199, 0.3);
  overflow: hidden;
}

.modal-header {
  height: 48px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #334155;
  background: rgba(30, 41, 59, 0.6);
}

.title-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-title {
  color: #f8fafc;
  font-size: 14px;
  font-weight: 600;
}

.close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.close-btn:hover {
  background: #334155;
  color: #fff;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.oee-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.oee-card {
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 12px;
}

.oee-card.main-oee {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
}

.card-label {
  font-size: 10px;
  color: #94a3b8;
  margin-bottom: 6px;
  white-space: nowrap;
}

.card-val {
  font-size: 20px;
  font-weight: 700;
  color: #f8fafc;
  font-family: monospace;
  margin-bottom: 8px;
}

.progress-bar {
  height: 4px;
  background: #1e293b;
  border-radius: 2px;
  overflow: hidden;
}

.fill {
  height: 100%;
}
.fill-green { background: #10b981; }
.fill-blue { background: #38bdf8; }
.fill-yellow { background: #f59e0b; }
.fill-cyan { background: #06b6d4; }

.energy-row {
  display: flex;
  justify-content: space-around;
  background: rgba(30, 41, 59, 0.3);
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 16px;
}

.energy-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.e-label {
  font-size: 11px;
  color: #64748b;
  margin-bottom: 4px;
}

.e-val {
  font-size: 20px;
  font-weight: 700;
  color: #f8fafc;
  font-family: monospace;
}
.e-val.green {
  color: #10b981;
}

.unit {
  font-size: 11px;
  color: #94a3b8;
  font-weight: normal;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.25s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
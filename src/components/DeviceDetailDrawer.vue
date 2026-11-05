<template>
  <transition name="drawer-fade">
    <div v-if="activeAgv" class="device-drawer">
      <div class="drawer-header">
        <div class="header-left">
          <span class="pulse-indicator"></span>
          <span class="drawer-title">{{ activeAgv.name }} ({{ activeAgv.id }})</span>
        </div>
        <button class="close-btn" @click="store.selectAgv(null)">✕</button>
      </div>

      <div class="drawer-body">
        <!-- 综合健康指数卡 -->
        <div class="health-card">
          <div class="health-val">
            <span class="score">{{ activeAgv.metrics.healthScore }}</span>
            <span class="unit">分</span>
          </div>
          <div class="health-desc">
            <div class="label">设备健康指数 (PHM)</div>
            <div class="status-tip">
              {{ activeAgv.status === 'ALARM' ? '⚠️ 存在急停告警' : '🟢 动力传动状态良好' }}
            </div>
          </div>
        </div>

        <!-- 关键实时工况四宫格 -->
        <div class="metrics-grid">
          <div class="metric-item">
            <div class="m-title">驱动电机温升</div>
            <div class="m-val" :class="{ warn: activeAgv.metrics.motorTemp > 50 }">
              {{ activeAgv.metrics.motorTemp }}°C
            </div>
            <div class="m-bar">
              <div class="bar-fill" :style="{ width: `${(activeAgv.metrics.motorTemp / 80) * 100}%` }"></div>
            </div>
          </div>

          <div class="metric-item">
            <div class="m-title">三轴振动 RMS</div>
            <div class="m-val">{{ activeAgv.metrics.vibration }} mm/s</div>
            <div class="m-bar">
              <div class="bar-fill vib" :style="{ width: `${(activeAgv.metrics.vibration / 3.0) * 100}%` }"></div>
            </div>
          </div>

          <div class="metric-item">
            <div class="m-title">动力电池电量</div>
            <div class="m-val" :class="{ danger: activeAgv.battery <= 20 }">
              {{ activeAgv.battery.toFixed(1) }}%
            </div>
            <div class="m-bar">
              <div class="bar-fill bat" :style="{ width: `${activeAgv.battery}%` }"></div>
            </div>
          </div>

          <div class="metric-item">
            <div class="m-title">累计运行里程</div>
            <div class="m-val">{{ activeAgv.metrics.mileage }} km</div>
            <div class="sub-text">维保周期余 875km</div>
          </div>
        </div>

        <!-- 快速调度干预 -->
        <div class="action-footer">
          <button
            class="act-btn alarm"
            :disabled="!store.canSimulate"
            :class="{ recover: activeAgv.status === 'ALARM' }"
            @click="store.toggleAlarm(activeAgv.id)"
          >
            {{ activeAgv.status === 'ALARM' ? '🟢 继续仿真任务' : '🛑 暂停仿真任务' }}
          </button>
          <button
            class="act-btn charge"
            :disabled="!store.canSimulate || activeAgv.hasPayload || ['ALARM', 'CHARGING'].includes(activeAgv.status)"
            @click="store.sendToCharge(activeAgv.id)"
          >
            {{ activeAgv.status === 'CHARGING' ? '⚡ 停靠快充中' : '🔌 派发仿真回充' }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useWarehouseStore } from '../stores/warehouse';

const store = useWarehouseStore();
const activeAgv = computed(() => {
  return store.selectedId ? store.agvs[store.selectedId] : null;
});
</script>

<style scoped>
.device-drawer {
  pointer-events: auto;
  position: absolute;
  right: 330px; /* 紧贴右侧卡片左边缘 */
  top: 72px;
  width: 310px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid #0284c7;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  padding: 16px;
  color: #e2e8f0;
  z-index: 20;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #1e293b;
  padding-bottom: 10px;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pulse-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 8px #38bdf8;
}

.drawer-title {
  font-size: 14px;
  font-weight: 600;
  color: #38bdf8;
}

.close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  color: #fff;
  background: #334155;
}

.health-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 12px;
}

.health-val {
  display: flex;
  align-items: baseline;
}

.health-val .score {
  font-size: 28px;
  font-weight: 800;
  color: #10b981;
  font-family: monospace;
}

.health-val .unit {
  font-size: 11px;
  color: #94a3b8;
  margin-left: 2px;
}

.health-desc .label {
  font-size: 12px;
  font-weight: 600;
  color: #cbd5e1;
}

.health-desc .status-tip {
  font-size: 10px;
  color: #94a3b8;
  margin-top: 2px;
}

.metrics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}

.metric-item {
  background: rgba(17, 24, 39, 0.8);
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 8px 10px;
}

.m-title {
  font-size: 10px;
  color: #64748b;
}

.m-val {
  font-size: 15px;
  font-weight: 700;
  color: #f8fafc;
  font-family: monospace;
  margin: 2px 0 4px;
}

.m-val.warn { color: #f59e0b; }
.m-val.danger { color: #ef4444; }

.m-bar {
  height: 3px;
  background: #1e293b;
  border-radius: 2px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: #38bdf8;
}
.bar-fill.vib { background: #f59e0b; }
.bar-fill.bat { background: #10b981; }

.sub-text {
  font-size: 9px;
  color: #64748b;
}

.action-footer {
  display: flex;
  gap: 8px;
}

.act-btn {
  flex: 1;
  padding: 8px 0;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.act-btn.alarm {
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
  color: #f87171;
}
.act-btn.alarm.recover {
  background: rgba(16, 185, 129, 0.2);
  border-color: #10b981;
  color: #34d399;
}

.act-btn.charge {
  background: rgba(16, 185, 129, 0.2);
  border-color: #10b981;
  color: #34d399;
}
.act-btn.charge:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 动效 */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
<template>
  <transition name="modal-fade">
    <div v-if="visible" class="alarm-modal-backdrop" @click.self="$emit('close')">
      <div class="alarm-center-box">
        <div class="modal-header">
          <div class="title-left">
            <span class="warning-icon">🚨</span>
            <span class="modal-title">车间异常告警与故障快照中心</span>
            <span class="active-badge" v-if="activeAlarmsCount > 0">
              {{ activeAlarmsCount }} 项待处理
            </span>
          </div>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div v-if="store.alarmEvents.length === 0" class="empty-state">
            🟢 生产现场运转正常，暂无故障告警快照记录
          </div>

          <div
            v-for="item in store.alarmEvents"
            :key="item.id"
            class="alarm-card"
            :class="{ resolved: item.resolved, critical: item.level === 'CRITICAL' && !item.resolved }"
          >
            <div class="card-left">
              <div class="alarm-id-row">
                <span class="alarm-time">{{ item.time }}</span>
                <span class="device-tag">{{ item.deviceName }} ({{ item.deviceId }})</span>
                <span class="status-tag" :class="item.resolved ? 'tag-resolved' : 'tag-active'">
                  {{ item.resolved ? '已复位恢复' : '🚨 待处置急停' }}
                </span>
              </div>
              <div class="alarm-desc">{{ item.reason }}</div>
              <div class="alarm-coord">
                故障发生时空间坐标: X = {{ item.snapshotPos.x.toFixed(2) }}, Z = {{ item.snapshotPos.z.toFixed(2) }}
              </div>
            </div>

            <div class="card-right">
              <button
                v-if="!item.resolved"
                class="fix-btn"
                :disabled="!store.canSimulate"
                @click="store.resolveAlarmEvent(item.id)"
              >
                一键复位
              </button>
              <button
                class="locate-btn"
                @click="locateDevice(item.deviceId)"
              >
                视点定位
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useWarehouseStore } from '../stores/warehouse';

defineProps<{ visible: boolean }>();
const emit = defineEmits(['close']);

const store = useWarehouseStore();

const activeAlarmsCount = computed(() => {
  return store.alarmEvents.filter((e) => !e.resolved).length;
});

function locateDevice(id: string) {
  store.selectAgv(id);
  emit('close');
}
</script>

<style scoped>
.alarm-modal-backdrop {
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

.alarm-center-box {
  width: 680px;
  max-height: 80vh;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid #ef4444;
  border-radius: 10px;
  box-shadow: 0 10px 40px rgba(239, 68, 68, 0.25);
  display: flex;
  flex-direction: column;
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

.active-badge {
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
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
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.empty-state {
  text-align: center;
  color: #10b981;
  padding: 30px 0;
  font-size: 13px;
}

.alarm-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 12px 16px;
  transition: all 0.2s;
}

.alarm-card.critical {
  border-color: #ef4444;
  background: rgba(127, 29, 29, 0.25);
}

.alarm-card.resolved {
  opacity: 0.55;
  border-color: #1e293b;
}

.alarm-id-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.alarm-time {
  font-family: monospace;
  font-size: 12px;
  color: #94a3b8;
}

.device-tag {
  color: #38bdf8;
  font-size: 12px;
  font-weight: 600;
}

.status-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag-active {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid #ef4444;
}

.tag-resolved {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid #10b981;
}

.alarm-desc {
  font-size: 12px;
  color: #e2e8f0;
  margin-bottom: 4px;
}

.alarm-coord {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
}

.card-right {
  display: flex;
  gap: 8px;
}

.fix-btn {
  background: #10b981;
  border: none;
  color: #fff;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}
.fix-btn:hover {
  background: #059669;
}

.locate-btn {
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid #38bdf8;
  color: #38bdf8;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.locate-btn:hover {
  background: rgba(56, 189, 248, 0.3);
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
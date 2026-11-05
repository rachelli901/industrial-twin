<template>
  <div class="log-panel">
    <div class="log-header">
      <span class="icon">📋</span>
      <span class="title">车间调度审计日志</span>
      <span class="pulse-dot"></span>
    </div>
    <div class="log-list">
      <div
        v-for="log in store.logs"
        :key="log.id"
        class="log-item"
        :class="log.level.toLowerCase()"
      >
        <span class="log-time">{{ log.time }}</span>
        <span class="log-tag">{{ log.level }}</span>
        <span class="log-msg">{{ log.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useWarehouseStore } from '../stores/warehouse';
const store = useWarehouseStore();
</script>

<style scoped>
.log-panel {
  width: 100%;
  flex: 1;
  min-height: 180px;
  background: rgba(17, 24, 39, 0.85);
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 12px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
}

.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #1e293b;
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: #38bdf8;
  flex: 1;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: log-live 1.2s infinite alternate;
}

@keyframes log-live {
  0% {
    opacity: 0.4;
  }
  100% {
    opacity: 1;
  }
}

.log-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}

.log-list::-webkit-scrollbar {
  width: 3px;
}
.log-list::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 2px;
}

.log-item {
  font-size: 11px;
  line-height: 1.4;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.6);
  border-left: 2px solid #64748b;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.log-item.info {
  border-left-color: #38bdf8;
}
.log-item.success {
  border-left-color: #10b981;
}
.log-item.warn {
  border-left-color: #ef4444;
  background: rgba(69, 10, 10, 0.4);
}

.log-time {
  color: #64748b;
  font-family: monospace;
  font-size: 10px;
}

.log-tag {
  font-size: 9px;
  padding: 1px 3px;
  border-radius: 2px;
  background: #1e293b;
  color: #94a3b8;
  font-weight: 600;
}

.log-item.info .log-tag {
  color: #38bdf8;
}
.log-item.success .log-tag {
  color: #10b981;
}
.log-item.warn .log-tag {
  color: #ef4444;
}

.log-msg {
  color: #cbd5e1;
  flex: 1;
  word-break: break-all;
}
</style>
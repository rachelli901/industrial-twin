<template>
  <ScaleBox :design-width="1920" :design-height="1080">
    <div class="twin-container">
      <WarehouseView ref="warehouseViewRef" />

      <!-- HUD 悬浮层过渡 -->
      <transition name="hud-fade">
        <div v-show="isHudVisible" class="hud-overlay">
          <header class="hud-header">
            <div class="title-block">
              <span class="logo">W1</span>
              <span class="main-title">机器人协同作业现场</span>
              <span class="net-badge" :class="store.connectionStatus.toLowerCase()">
                <span class="net-dot"></span>
                <span v-if="store.connectionStatus === 'CONNECTED'">{{ store.gatewayMode === 'MOCK' ? '模拟网关在线' : '现场遥测在线' }}</span>
                <span v-else-if="store.connectionStatus === 'RECONNECTING'">重连尝试中...</span>
                <span v-else>遥测不可用 / 数据已过期</span>
              </span>
              <div class="poi-quick-nav">
                <button class="poi-btn" @click="handlePoiJump('RACK')">📦 立库区</button>
                <button class="poi-btn" @click="handlePoiJump('CHARGER')">⚡ 充电站</button>
                <button class="poi-btn" @click="handlePoiJump('CONVEYOR')">🔄 输送带</button>
              </div>
            </div>
            <div class="stats-block">
              <span>已完成作业：<strong>{{ store.taskCount }}</strong></span>
              <span class="clock">{{ currentTime }}</span>
              <button
                class="heatmap-toggle-btn"
                :class="{ active: store.showHeatmap }"
                @click="store.toggleHeatmap()"
                :title="store.showHeatmap ? '关闭车间通行热力密度图谱' : '开启车间通行热力密度图谱'"
              >
                🔥 热力
              </button>
              <button
                class="theme-toggle-btn"
                @click="store.toggleTheme()"
                :title="store.currentTheme === 'DARK' ? '切换为工业白班日光模式' : '切换为暗黑赛博夜景模式'"
              >
                {{ store.currentTheme === 'DARK' ? '🌙 夜巡' : '☀️ 白班' }}
              </button>
              <button
                class="playback-toggle-btn"
                :class="{ active: store.isPlaybackMode }"
                @click="store.togglePlaybackMode()"
                :title="store.isPlaybackMode ? '退出历史复盘' : '回看当前会话的车辆轨迹'"
              >
                ⏱ 复盘
              </button>
              <button
                class="alarm-center-btn"
                :class="{ active: activeAlarmCount > 0 }"
                @click="showAlarmModal = true"
                :title="`车间告警中心 (${activeAlarmCount} 项待处理)`"
              >
                🚨 告警
                <span v-if="activeAlarmCount > 0" class="alarm-dot-num">{{ activeAlarmCount }}</span>
              </button>
              <button
                class="export-report-btn"
                @click="handleExportReport"
                title="一键导出交接班工况与时序测点 CSV 报表"
              >
                📊 报表
              </button>
              <button
                class="energy-toggle-btn"
                @click="showEnergyModal = true"
                title="查看车间设备综合稼动率 (OEE) 与全天能耗核算"
              >
                ⚡ 能效
              </button>
              <button
                class="fence-toggle-btn"
                :disabled="!store.canSimulate || store.geofenceRequest !== null"
                :class="{ active: store.geofence.active }"
                @click="store.toggleGeofence()"
                :title="store.geofence.active ? '撤销临时禁行区' : '在主通道划设临时检修电子围栏'"
              >
                🚧 {{ store.geofenceRequest !== null ? '请求确认中' : store.geofence.active ? '围栏生效中' : '电子围栏' }}
              </button>
              <button
                class="icon-ctrl-btn"
                :class="{ active: isMuted }"
                @click="toggleMute"
                :title="isMuted ? '取消静音 (快捷键 M)' : '全局静音 (快捷键 M)'"
              >
                {{ isMuted ? '🔇' : '🔊' }}
              </button>
              <button
                class="icon-ctrl-btn"
                @click="toggleHud"
                title="纯净三维沉浸模式 (快捷键 H)"
              >
                👁️
              </button>
              <button
                class="fullscreen-btn"
                @click="toggleFullscreen"
                :title="isFullscreen ? '退出全屏' : '全屏展示'"
              >
                {{ isFullscreen ? '🗗' : '⛶' }}
              </button>
            </div>
          </header>

          <div class="hud-content">
            <!-- 左侧综合仪表板（图表 + 安全雷达 + 审计流水） -->
            <aside class="left-sidebar">
              <TelemetryCharts />
              <OperationLogs />
            </aside>

            <!-- 历史轨迹时间轴（居中浮于底部热力图上方） -->
            <PlaybackTimeline />

            <!-- 底部库位热力图 -->
            <div class="bottom-heatmap">
              <div class="heatmap-header">
                <span class="heatmap-title">立库库存状态 (点击占用库位派发拣选任务)</span>
                <div class="legend">
                  <span class="dot empty"></span>空闲
                  <span class="dot occupied"></span>占用
                  <span class="dot picking"></span>作业中
                </div>
              </div>
              <div class="slots-grid">
                <div
                  v-for="slot in store.slots"
                  :key="slot.id"
                  class="slot-cell"
                  :class="slot.status.toLowerCase()"
                  :title="`${slot.id} - 点击加入出库队列`"
                  @click="store.triggerPickTask(slot.id)"
                >
                  {{ slot.id.replace('LOC-', '') }}
                </div>
              </div>
            </div>

            <!-- 3D 点击设备下钻测点抽屉 -->
            <DeviceDetailDrawer />

            <!-- 右侧卡片面板 -->
            <aside class="side-panel">
              <div class="view-mode-bar">
                <button
                  :class="{ active: store.cameraMode === 'OVERVIEW' }"
                  @click="store.setCameraMode('OVERVIEW')"
                >
                  🌐 全局总览
                </button>
                <button
                  :class="{ active: store.cameraMode === 'FOCUS' }"
                  @click="store.setCameraMode('FOCUS')"
                >
                  🎯 特写跟随
                </button>
                <button
                  :class="{ active: store.cameraMode === 'FPV' }"
                  @click="store.setCameraMode('FPV')"
                >
                  🎥 车载视角
                </button>
                <button
                  :class="{ active: store.cameraMode === 'TOUR' }"
                  @click="store.setCameraMode('TOUR')"
                >
                  🚀 自动巡视
                </button>
              </div>

              <div
                v-for="agv in store.agvs"
                :key="agv.id"
                class="agv-card"
                :class="{
                  active: store.selectedId === agv.id,
                  'card-alarm': agv.status === 'ALARM',
                  'card-charging': agv.status === 'CHARGING'
                }"
                @click="store.selectAgv(agv.id)"
              >
                <div class="card-title">
                  <span class="name">{{ agv.name }}</span>
                  <span class="status-pill" :class="agv.status.toLowerCase()">
                    {{ agv.status }}
                  </span>
                </div>

                <div v-if="agv.status === 'ALARM'" class="alarm-banner">
                  ⚠️ 激光雷达防撞急停中
                </div>
                <div v-if="agv.status === 'CHARGING'" class="charge-banner">
                  ⚡ 智能回充停靠中 ({{ agv.battery.toFixed(1) }}%)
                </div>

                <div class="metric-row">
                  <span>搬运负载</span>
                  <span :style="{ color: agv.hasPayload ? '#38bdf8' : '#94a3b8' }">
                    {{ agv.hasPayload ? '已装载货箱' : '空载' }}
                  </span>
                </div>
                <div class="metric-row">
                  <span>电池电量</span>
                  <span :style="{ color: agv.battery <= 20 ? '#ef4444' : '#10b981' }">
                    {{ agv.battery.toFixed(1) }}%
                  </span>
                </div>
                <div class="battery-track">
                  <div
                    class="battery-fill"
                    :class="{ low: agv.battery <= 20 }"
                    :style="{ width: agv.battery + '%' }"
                  ></div>
                </div>
                <div class="metric-row coord">
                  <span>坐标 (X, Z)</span>
                  <span>{{ agv.position.x.toFixed(2) }}, {{ agv.position.z.toFixed(2) }}</span>
                </div>

                <div class="action-btn-row">
                  <button
                    class="alarm-toggle-btn"
                    :disabled="!store.canSimulate"
                    title="暂停仿真车辆，保留任务和载荷"
                    :class="{ 'btn-recover': agv.status === 'ALARM' }"
                    @click.stop="store.toggleAlarm(agv.id)"
                  >
                    {{ agv.status === 'ALARM' ? '▶ 继续作业' : '⏸ 暂停作业' }}
                  </button>

                  <button
                    class="charge-toggle-btn"
                    :disabled="!store.canSimulate || agv.hasPayload || ['ALARM', 'CHARGING'].includes(agv.status)"
                    @click.stop="store.sendToCharge(agv.id)"
                  >
                    {{ agv.status === 'CHARGING' ? '⚡ 充能中' : '🔌 派发回充' }}
                  </button>
                </div>
              </div>
              <TaskCenter />
            </aside>
          </div>
        </div>
      </transition>

      <!-- 纯净模式下的悬浮还原唤起按钮 -->
      <div
        v-if="!isHudVisible"
        class="restore-hud-trigger"
        @click="toggleHud"
        title="恢复仪表显示 (快捷键 H)"
      >
        <span>👁️ 唤起仪表</span>
      </div>

      <!-- 全局操作 Toast 提示 -->
      <transition name="toast-fade">
        <div v-if="toastMsg" class="global-toast">
          {{ toastMsg }}
        </div>
      </transition>

      <!-- 异常故障审计与告警中心 Modal -->
      <AlarmCenterModal :visible="showAlarmModal" @close="showAlarmModal = false" />

      <!-- 车间 OEE 与动力能耗核算 Modal -->
      <EnergyOeeModal :visible="showEnergyModal" @close="showEnergyModal = false" />
    </div>
  </ScaleBox>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import TaskCenter from './components/TaskCenter.vue';
import ScaleBox from './components/ScaleBox.vue';
import WarehouseView from './components/WarehouseView.vue';
import TelemetryCharts from './components/TelemetryCharts.vue';
import OperationLogs from './components/OperationLogs.vue';
import DeviceDetailDrawer from './components/DeviceDetailDrawer.vue';
import PlaybackTimeline from './components/PlaybackTimeline.vue';
import AlarmCenterModal from './components/AlarmCenterModal.vue';
import EnergyOeeModal from './components/EnergyOeeModal.vue';
import { useWarehouseStore } from './stores/warehouse';
import { soundManager } from './utils/audioEffects';
import type { PoiKey } from './three/SceneManager';

const store = useWarehouseStore();
const warehouseViewRef = ref<{ flyToPoi: (poi: PoiKey, onComplete?: () => void) => void } | null>(null);
const isFullscreen = ref(false);
const currentTime = ref('');
const showAlarmModal = ref(false);
const showEnergyModal = ref(false);
const toastMsg = ref('');
const isHudVisible = ref(true);
const isMuted = ref(false);

let toastTimer: number = 0;
let clockTimer: number = 0;

const activeAlarmCount = computed(() => {
  return store.alarmEvents.filter((e) => !e.resolved).length;
});

function updateClock() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  currentTime.value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function handlePoiJump(key: PoiKey) {
  warehouseViewRef.value?.flyToPoi(key);
  const poiNames: Record<PoiKey, string> = {
    RACK: '智能高位立体仓库',
    CHARGER: 'AGV 智能快充基站',
    CONVEYOR: '出货滚筒流水线'
  };
  store.addLog('INFO', `相机运镜聚焦工位: ${poiNames[key]}`);
}

function handleExportReport() {
  store.exportDailyReport();
  toastMsg.value = '📊 车间运营报表 (.CSV) 已生成并保存至本地下载目录！';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMsg.value = '';
  }, 3200);
}

function toggleMute() {
  isMuted.value = soundManager.toggleMute();
  toastMsg.value = isMuted.value ? '🔇 全局告警音效已静音' : '🔊 全局音效已恢复';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMsg.value = '';
  }, 2000);
}

function toggleHud() {
  isHudVisible.value = !isHudVisible.value;
}

function handleKeyDown(e: KeyboardEvent) {
  if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

  if (e.key === 'h' || e.key === 'H') {
    toggleHud();
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMute();
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function handleFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

onMounted(() => {
  updateClock();
  clockTimer = window.setInterval(updateClock, 1000);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  clearInterval(clockTimer);
  if (toastTimer) clearTimeout(toastTimer);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
body {
  overflow: hidden;
  background: #07090e;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
}
</style>

<style scoped>
.twin-container {
  position: relative;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: #07090e;
}

.hud-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  display: flex;
  flex-direction: column;
}

.hud-header {
  pointer-events: auto;
  height: 52px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0) 100%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  color: #f1f5f9;
}

.title-block {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  font-weight: 800;
  color: #38bdf8;
  font-size: 18px;
}

.main-title {
  font-size: 15px;
  font-weight: 500;
  color: #cbd5e1;
}

.net-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid #334155;
  color: #94a3b8;
}

.net-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.net-badge.connected .net-dot {
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.net-badge.reconnecting .net-dot {
  background: #f59e0b;
  box-shadow: 0 0 6px #f59e0b;
}

.net-badge.mock_mode .net-dot {
  background: #38bdf8;
  box-shadow: 0 0 6px #38bdf8;
}

.poi-quick-nav {
  display: flex;
  gap: 6px;
  margin-left: 14px;
}

.poi-btn {
  background: rgba(30, 41, 59, 0.7);
  border: 1px solid #334155;
  color: #94a3b8;
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.poi-btn:hover {
  color: #38bdf8;
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.15);
}

.stats-block {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.stats-block strong {
  color: #38bdf8;
}

.clock {
  color: #94a3b8;
  font-family: monospace;
  font-size: 13px;
}

.heatmap-toggle-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.2s;
}

.heatmap-toggle-btn:hover,
.heatmap-toggle-btn.active {
  border-color: #f59e0b;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.2);
}

.theme-toggle-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.2s;
}

.theme-toggle-btn:hover {
  border-color: #38bdf8;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.15);
}

.playback-toggle-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.2s;
}

.playback-toggle-btn:hover,
.playback-toggle-btn.active {
  border-color: #38bdf8;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.2);
}

.alarm-center-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: all 0.2s;
}

.alarm-center-btn.active {
  border-color: #ef4444;
  color: #f87171;
  background: rgba(239, 68, 68, 0.2);
  animation: alarm-pulse 1s infinite alternate;
}

.alarm-dot-num {
  background: #ef4444;
  color: #fff;
  border-radius: 10px;
  font-size: 10px;
  padding: 1px 5px;
  font-weight: 700;
}

@keyframes alarm-pulse {
  0% { transform: scale(1); box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
  100% { transform: scale(1.04); box-shadow: 0 0 8px rgba(239, 68, 68, 0.6); }
}

.export-report-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.2s;
}

.export-report-btn:hover {
  border-color: #10b981;
  color: #34d399;
  background: rgba(16, 185, 129, 0.15);
}

.energy-toggle-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.2s;
}

.energy-toggle-btn:hover {
  border-color: #38bdf8;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.15);
}

.fence-toggle-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.2s;
}

.fence-toggle-btn:hover {
  border-color: #ef4444;
  color: #f87171;
}

.fence-toggle-btn.active {
  border-color: #ef4444;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.2);
  animation: fence-pulse 1.2s infinite alternate;
}

@keyframes fence-pulse {
  0% { box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
  100% { box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); }
}

.icon-ctrl-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #cbd5e1;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.icon-ctrl-btn:hover {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.15);
}

.icon-ctrl-btn.active {
  border-color: #ef4444;
  color: #f87171;
}

.fullscreen-btn {
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid #334155;
  color: #94a3b8;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.fullscreen-btn:hover {
  color: #f8fafc;
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.2);
}

.restore-hud-trigger {
  pointer-events: auto;
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid #38bdf8;
  color: #38bdf8;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  cursor: pointer;
  z-index: 50;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 14px rgba(56, 189, 248, 0.25);
  transition: all 0.2s;
}

.restore-hud-trigger:hover {
  background: rgba(56, 189, 248, 0.25);
  transform: scale(1.05);
}

.hud-fade-enter-active,
.hud-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.hud-fade-enter-from,
.hud-fade-leave-to {
  opacity: 0;
  transform: scale(1.02);
}

.global-toast {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(16, 185, 129, 0.95);
  border: 1px solid #34d399;
  color: #064e3b;
  font-weight: 600;
  font-size: 13px;
  padding: 8px 18px;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
  z-index: 1000;
  pointer-events: none;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: all 0.3s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -10px);
}

.hud-content {
  flex: 1;
  position: relative;
}

.left-sidebar {
  pointer-events: auto;
  position: absolute;
  left: 20px;
  top: 20px;
  bottom: 24px;
  width: 290px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bottom-heatmap {
  pointer-events: auto;
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(17, 24, 39, 0.85);
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 12px 18px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.heatmap-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 8px;
  gap: 20px;
}

.heatmap-title {
  font-weight: 600;
  color: #38bdf8;
}

.legend {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.dot.empty { background: #334155; }
.dot.occupied { background: #0284c7; }
.dot.picking { background: #f59e0b; }

.slots-grid {
  display: grid;
  grid-template-columns: repeat(4, 46px);
  gap: 6px;
}

.slot-cell {
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.slot-cell.empty {
  background: rgba(51, 65, 85, 0.5);
  border: 1px dashed #64748b;
  color: #94a3b8;
}

.slot-cell.occupied {
  background: #0284c7;
  border: 1px solid #38bdf8;
  color: #fff;
  box-shadow: 0 0 6px rgba(2, 132, 199, 0.4);
}

.slot-cell.picking {
  background: #f59e0b;
  border: 1px solid #fbbf24;
  color: #fff;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
  animation: pulse 1s infinite alternate;
}

@keyframes pulse {
  0% { transform: scale(0.96); }
  100% { transform: scale(1.04); }
}

.side-panel {
  pointer-events: auto;
  position: absolute;
  right: 20px;
  top: 20px;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.view-mode-bar {
  display: flex;
  background: rgba(17, 24, 39, 0.85);
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 3px;
  gap: 3px;
}

.view-mode-bar button {
  flex: 1;
  background: transparent;
  border: none;
  color: #94a3b8;
  padding: 6px 2px;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 4px;
  white-space: nowrap;
  transition: all 0.2s;
}

.view-mode-bar button:hover {
  color: #f8fafc;
}

.view-mode-bar button.active {
  background: #0284c7;
  color: #fff;
  box-shadow: 0 0 8px rgba(2, 132, 199, 0.5);
}

.agv-card {
  background: rgba(17, 24, 39, 0.85);
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 14px;
  color: #e2e8f0;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.2s ease;
}

.agv-card:hover,
.agv-card.active {
  border-color: #38bdf8;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.25);
  background: rgba(30, 41, 59, 0.9);
}

.agv-card.card-alarm {
  border-color: #ef4444;
  background: rgba(69, 10, 10, 0.85);
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.4);
}

.agv-card.card-charging {
  border-color: #10b981;
  background: rgba(6, 78, 59, 0.7);
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.4);
}

.alarm-banner {
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
  text-align: center;
  animation: banner-pulse 0.8s infinite alternate;
}

.charge-banner {
  background: #10b981;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 8px;
  text-align: center;
}

@keyframes banner-pulse {
  0% { opacity: 0.8; }
  100% { opacity: 1; }
}

.card-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.name {
  font-weight: 600;
  font-size: 14px;
}
.status-pill {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #475569;
  color: #fff;
}
.status-pill.navigating { background: #0284c7; }
.status-pill.picking { background: #f59e0b; }
.status-pill.delivering { background: #8b5cf6; }
.status-pill.idle { background: #334155; }
.status-pill.alarm { background: #ef4444; }
.status-pill.charging { background: #10b981; }

.metric-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 4px;
}

.coord {
  margin-top: 8px;
  font-size: 11px;
}

.battery-track {
  height: 4px;
  background: #334155;
  border-radius: 2px;
  overflow: hidden;
}

.battery-fill {
  height: 100%;
  background: #10b981;
}

.battery-fill.low {
  background: #ef4444;
}

.action-btn-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.alarm-toggle-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid #ef4444;
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.alarm-toggle-btn:hover {
  background: rgba(239, 68, 68, 0.3);
}

.alarm-toggle-btn.btn-recover {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.charge-toggle-btn {
  flex: 1;
  padding: 6px 0;
  border: 1px solid #10b981;
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.charge-toggle-btn:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.3);
}

.charge-toggle-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
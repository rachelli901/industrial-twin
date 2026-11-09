<template>
  <div ref="viewportRef" class="viewport-canvas"></div>
  <div v-if="loginVisible" class="gateway-login">
    <form @submit.prevent="submitToken">
      <h2>连接数据网关</h2>
      <p>输入管理员配置的访问令牌。</p>
      <label for="gateway-token">访问令牌</label>
      <input id="gateway-token" v-model="loginToken" type="password" autocomplete="current-password" required autofocus />
      <p v-if="loginError" role="alert">{{ loginError }}</p>
      <button type="submit">连接</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useWarehouseStore } from '../stores/warehouse';
import type { PoiKey } from '../three/SceneManager';
import { SceneManager } from '../three/SceneManager';
import { TelemetryClient } from '../utils/telemetryClient';
import { LocalSimulationClient } from '../utils/localSimulationClient';
import type { GatewayClient } from '../utils/gatewayClient';

const store = useWarehouseStore();
const viewportRef = ref<HTMLDivElement | null>(null);
const loginVisible = ref(false);
const loginToken = ref('');
const loginError = ref('');
function submitToken() {
  telemetry?.authenticate(loginToken.value);
  loginToken.value = '';
  loginError.value = '';
}
let manager: SceneManager | null = null;
let telemetry: GatewayClient | null = null;
let commandTimer = 0;
defineExpose({ flyToPoi: (poi: PoiKey, onComplete?: () => void) => manager?.flyToPoi(poi, onComplete) });

onMounted(() => {
  if (viewportRef.value) {
    manager = new SceneManager(
      viewportRef.value,
      (id) => store.selectAgv(id),
      (slotId) => store.triggerPickTask(slotId)
    );
    manager.syncSlots(store.slots);
    manager.toggleHeatmap(store.showHeatmap);
  }

  if (import.meta.env.VITE_DEMO_MODE === 'static') {
    telemetry = new LocalSimulationClient();
  } else {
    // 动态同源地址（自适应容器对外映射的任何端口）：
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    telemetry = new TelemetryClient(`${protocol}//${window.location.host}/v1/telemetry`);
  }
  telemetry.onAuthRequired = () => { loginVisible.value = true; };
  telemetry.onAuthFailure = () => {
    loginVisible.value = true;
    loginError.value = '验证失败或已超时，请重新输入令牌';
  };

  telemetry.onStatusChange = (status) => {
    store.setConnectionStatus(status);
  };

  telemetry.onMessage = (msg) => {
    if (msg.type === 'AGV_POSE') {
      store.updateAgv(msg.data.id, msg.data);
    } else if (msg.type === 'SLOT_UPDATE') {
      const slot = store.slots.find((s) => s.id === msg.data.id);
      if (slot) slot.status = msg.data.status;
    } else if (msg.type === 'SYSTEM_INFO') {
      loginVisible.value = false;
      loginError.value = '';
      store.gatewayMode = msg.data.gatewayMode;
      store.confirmGeofence(msg.data.geofenceActive);
    } else if (msg.type === 'OPERATIONS_STATE') {
      store.applyOperations(msg.data);
    } else if (msg.type === 'COMMAND_RESULT') {
      store.handleCommandResult(msg.data);
    } else if (msg.type === 'GEOFENCE_STATUS') {
      store.confirmGeofence(msg.data.active);
    } else if (msg.type === 'COMMAND_ERROR') {
      store.geofenceRequest = null;
      store.addLog('WARN', msg.data.message);
    }
  };

  commandTimer = window.setInterval(() => store.expireCommands(), 1000);
  window.addEventListener('resize', onResize);
});

watch(
  () => store.slots,
  (newSlots) => {
    if (manager) manager.syncSlots(newSlots);
  },
  { deep: true }
);

watch(
  () => store.currentTheme,
  (theme) => {
    if (manager) manager.setTheme(theme);
  }
);

// 监听车间通行热力图显隐切换
watch(
  () => store.showHeatmap,
  (visible) => {
    if (manager) manager.toggleHeatmap(visible);
  }
);

watch(
  [() => store.cameraMode, () => store.selectedId],
  ([mode, targetId]) => {
    if (!manager) return;
    manager.setViewMode(mode, targetId);
    manager.updateLabelState('AGV_01', store.agvs['AGV_01']?.status || '', targetId === 'AGV_01');
    manager.updateLabelState('AGV_02', store.agvs['AGV_02']?.status || '', targetId === 'AGV_02');
  }
);

watch(
  () => store.geofence.active,
  (active) => {
    manager?.setGeofenceState(active);

  }
);

watch(() => store.commandQueue.length, () => {
  for (const command of store.commandQueue.splice(0)) {
    if (!telemetry?.send({ type: 'COMMAND', data: command })) {
      store.handleCommandResult({ requestId: command.id, accepted: false, message: '网关离线，指令未发送' });
    }
  }
});

watch([() => store.operationState, () => store.isPlaybackMode], ([state, playback]) => {
  if (!manager || !state) return;
  manager.setRoutes(playback ? [] : state.robots);
  if (!playback) manager.syncConveyorState(state.conveyorBoxes);
}, { deep: true });

watch(
  () => store.agvs,
  (agvs) => {
    if (!manager) return;

    manager.authoritativePose = true;
    Object.values(agvs).forEach((agv) => {
      const isAlarm = agv.status === 'ALARM';
      const isCharging = agv.status === 'CHARGING';

      manager!.setTargetPose(agv.id, agv.position.x, agv.position.z, agv.heading);
      manager!.setAgvPayload(agv.id, agv.hasPayload);
      manager!.setAgvLift(agv.id, agv.liftHeight ?? 0.7);
      manager!.setAgvCharging(agv.id, isCharging);
      manager!.setAgvAlarm(agv.id, isAlarm);

      let text: string = agv.status;
      if (isAlarm) text = agv.alarmMsg || '急停';
      if (isCharging) text = `⚡ 快速充电中 (${agv.battery.toFixed(1)}%)`;

      manager!.updateLabelState(agv.id, text, store.selectedId === agv.id, isAlarm);
    });
  },
  { deep: true }
);

function onResize() {
  manager?.resize();
}

onUnmounted(() => {
  clearInterval(commandTimer);
  telemetry?.destroy();
  window.removeEventListener('resize', onResize);
  manager?.dispose();
});
</script>

<style scoped>
.gateway-login { position: absolute; inset: 0; z-index: 100; display: grid; place-items: center; background: rgba(0,0,0,.75); }
.gateway-login form { width: 340px; padding: 28px; background: #111827; color: #f8fafc; border: 1px solid #334155; border-radius: 8px; display: grid; gap: 16px; }
.gateway-login h2 { font-size: 20px; }
.gateway-login p { font-size: 14px; color: #cbd5e1; }
.gateway-login input, .gateway-login button { padding: 10px; border: 1px solid #64748b; border-radius: 4px; }
.gateway-login button { cursor: pointer; }

.viewport-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}
</style>
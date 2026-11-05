import type { Command, CommandResult, OperationsState, Task } from '../domain/operations';
import { defineStore } from 'pinia';
import { ref, computed, onScopeDispose } from 'vue';
import { parsePose } from '../utils/telemetryProtocol';
import { soundManager } from '../utils/audioEffects';

export type AgvStatus = 'NAVIGATING' | 'PICKING' | 'DELIVERING' | 'IDLE' | 'ALARM' | 'CHARGING';
export type SlotStatus = 'EMPTY' | 'OCCUPIED' | 'PICKING';
export type CameraViewMode = 'OVERVIEW' | 'FOCUS' | 'FPV' | 'TOUR';
export type ThemeMode = 'DARK' | 'LIGHT';

export interface AgvMetrics {
  motorTemp: number;   // 电机温升 (°C)
  vibration: number;   // 三轴振动速度 RMS (mm/s)
  mileage: number;     // 累计运行里程 (km)
  healthScore: number; // 综合健康度评估分 (0-100)
}

export interface AgvState {
  id: string;
  name: string;
  battery: number;
  speed?: number;
  liftHeight?: number;
  taskId?: string | null;
  status: AgvStatus;
  position: { x: number; z: number };
  heading: number;
  hasPayload: boolean;
  alarmMsg?: string;
  metrics: AgvMetrics;
}

export interface HistoryFrame {
  timestamp: number;
  timeStr: string;
  poses: Record<string, { x: number; z: number; heading: number; status: AgvStatus; battery: number }>;
}

export interface AlarmEvent {
  id: string;
  deviceId: string;
  deviceName: string;
  time: string;
  level: 'CRITICAL' | 'WARNING';
  reason: string;
  snapshotPos: { x: number; z: number };
  resolved: boolean;
}

export interface StorageSlot {
  id: string;
  tier: number;
  col: number;
  status: SlotStatus;
}

export interface OperationLog {
  id: number;
  time: string;
  level: 'INFO' | 'WARN' | 'SUCCESS';
  text: string;
}

export interface GeofenceZone {
  id: string;
  name: string;
  center: { x: number; z: number };
  radius: number;
  active: boolean;
}

export interface OeeMetrics {
  availability: number; // 可用率 (%)
  performance: number;  // 表现指数 (%)
  quality: number;      // 质量合格率 (%)
  oeeScore: number;     // 综合 OEE 指数 (%)
  totalKwh: number;     // 当班总电耗 (kWh)
  co2Saved: number;     // 绿电节能减碳量 (kg)
}

export const useWarehouseStore = defineStore('warehouse', () => {
  const selectedId = ref<string | null>(null);
  const cameraMode = ref<CameraViewMode>('OVERVIEW');
  const connectionStatus = ref<'CONNECTED' | 'RECONNECTING' | 'MOCK_MODE' | 'STALE'>('RECONNECTING');
  const gatewayMode = ref<'MOCK' | 'MQTT' | null>(null);
  const geofenceRequest = ref<boolean | null>(null);
  const liveAgvs = ref<Record<string, AgvState> | null>(null);
  const canSimulate = computed(() => gatewayMode.value === 'MOCK' && connectionStatus.value === 'CONNECTED' && !isPlaybackMode.value);
  const tasks = ref<Task[]>([]);
  const operationState = ref<OperationsState | null>(null);
  const commandQueue = ref<Command[]>([]);
  const pendingCommands = ref<Record<string, { kind: string; sentAt: number }>>({});
  const commandResults = ref<CommandResult[]>([]);
  let alarmSequence = 0;
  let commandSequence = 0;
  const taskCount = ref(0);
  const currentTheme = ref<ThemeMode>('DARK');
  const showHeatmap = ref(false);

  // 输送线光电传感器过箱统计
  const conveyorOutCount = ref(0);
  const pphRate = ref(0);

  // 电子围栏临时禁行区
  const geofence = ref<GeofenceZone>({
    id: 'ZONE-A1',
    name: '通道临时检修禁行区',
    center: { x: -0.2, z: -0.2 },
    radius: 2.0,
    active: false
  });

  // 车间全局 OEE 稼动率与动力能耗核算
  const oeeData = ref<OeeMetrics>({
    availability: 92.4,
    performance: 88.6,
    quality: 99.5,
    oeeScore: 81.5,
    totalKwh: 342.8,
    co2Saved: 128.4
  });

  // 历史复盘模块状态
  const isPlaybackMode = ref(false);
  const isPlaying = ref(false);
  const playbackSpeed = ref(1);
  const playbackProgress = ref(0);
  const historyData = ref<HistoryFrame[]>([]);
  let playbackTimer: number | null = null;

  // 告警事件中心
  const alarmEvents = ref<AlarmEvent[]>([]);

  // 审计日志列表
  const logs = ref<OperationLog[]>([]);

  function addLog(level: 'INFO' | 'WARN' | 'SUCCESS', text: string) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    logs.value.unshift({
      id: Date.now() + Math.random(),
      time: timeStr,
      level,
      text
    });
    if (logs.value.length > 20) logs.value.pop();
  }

  const agvs = ref<Record<string, AgvState>>({
    'AGV_01': {
      id: 'AGV_01',
      name: '01·拣选机器人',
      battery: 95,
      status: 'IDLE',
      position: { x: -3.5, z: -0.75 },
      heading: 0,
      hasPayload: false,
      metrics: {
        motorTemp: 42.5,
        vibration: 0.85,
        mileage: 124.6,
        healthScore: 98
      }
    },
    'AGV_02': {
      id: 'AGV_02',
      name: '02·补货机器人',
      battery: 28,
      status: 'IDLE',
      position: { x: 1.5, z: 2.5 },
      heading: 0,
      hasPayload: false,
      metrics: {
        motorTemp: 38.2,
        vibration: 0.62,
        mileage: 86.4,
        healthScore: 95
      }
    }
  });

  // 计算两车动态直线间距 (米)
  const interAgvDistance = computed(() => {
    const p1 = agvs.value['AGV_01']?.position;
    const p2 = agvs.value['AGV_02']?.position;
    if (!p1 || !p2) return 0;
    const dx = p1.x - p2.x;
    const dz = p1.z - p2.z;
    return Math.sqrt(dx * dx + dz * dz);
  });

  const slots = ref<StorageSlot[]>([]);
  for (let t = 1; t <= 3; t++) {
    for (let c = 1; c <= 4; c++) {
      const isOccupied = (t + c) % 2 === 0;
      slots.value.push({
        id: `LOC-${t}-${c}`,
        tier: t,
        col: c,
        status: isOccupied ? 'OCCUPIED' : 'EMPTY'
      });
    }
  }

  function queueCommand(input: Omit<Command, 'id'>) {
    if (!canSimulate.value) { addLog('WARN', '请连接仿真网关并退出回放后操作'); return; }
    const id = `cmd-${Date.now()}-${++commandSequence}-${Math.random().toString(36).slice(2, 8)}`;
    const command = { ...input, id } as Command;
    pendingCommands.value[id] = { kind: command.kind, sentAt: Date.now() };
    commandQueue.value.push(command);
  }

  function handleCommandResult(result: CommandResult) {
    const pending = pendingCommands.value[result.requestId];
    if (!pending) return;
    delete pendingCommands.value[result.requestId];
    commandResults.value.unshift(result);
    if (commandResults.value.length > 20) commandResults.value.pop();
    if (pending.kind === 'SET_GEOFENCE') geofenceRequest.value = null;
    addLog(result.accepted ? 'SUCCESS' : 'WARN', result.message);
  }

  function expireCommands() {
    for (const [id, pending] of Object.entries(pendingCommands.value)) {
      if (Date.now() - pending.sentAt > 10000) handleCommandResult({ requestId: id, accepted: false,
        message: '未收到指令回执，请核对任务列表后操作；系统不会自动重复派单' });
    }
  }

  function applyOperations(state: OperationsState) {
    operationState.value = state;
    tasks.value = state.tasks;
    slots.value = state.slots;
    taskCount.value = state.completedCount;
    conveyorOutCount.value = state.conveyorCount;
    pphRate.value = state.time > 0 ? Math.round(state.conveyorCount / state.time * 3600) : 0;
    geofence.value.active = state.geofenceActive;
    const target = isPlaybackMode.value ? liveAgvs.value : agvs.value;
    for (const robot of state.robots) {
      const agv = target?.[robot.id];
      if (!agv) continue;
      const wasAlarm = agv.status === 'ALARM';
      Object.assign(agv, JSON.parse(JSON.stringify(robot)), { metrics: { ...agv.metrics, ...robot.metrics } });
      agv.alarmMsg = robot.paused ? '操作员暂停（仿真）' : undefined;
      if (!wasAlarm && robot.paused) raiseAlarmEvent(robot.id, '操作员暂停仿真车辆，任务与载荷保留');
      if (wasAlarm && !robot.paused) alarmEvents.value.filter(e => e.deviceId === robot.id).forEach(e => { e.resolved = true; });
    }
    if (!isPlaybackMode.value) recordHistory();
  }

  function toggleGeofence() {
    if (!canSimulate.value || geofenceRequest.value !== null) return;
    geofenceRequest.value = !geofence.value.active;
    queueCommand({ kind: 'SET_GEOFENCE', active: geofenceRequest.value } as Omit<Command, 'id'>);
  }
  function confirmGeofence(active: boolean) { geofence.value.active = active; geofenceRequest.value = null; }
  function pickAll() { queueCommand({ kind: 'PICK_ALL' }); }
  function restock() { queueCommand({ kind: 'RESTOCK' }); }

  function selectAgv(id: string | null) {
    selectedId.value = id;
    if (id) {
      if (cameraMode.value === 'OVERVIEW') {
        cameraMode.value = 'FOCUS';
      }
      addLog('INFO', `切换视角追踪锁定设备: ${id}`);
      soundManager.playClick();
    } else {
      cameraMode.value = 'OVERVIEW';
    }
  }

  function setCameraMode(mode: CameraViewMode) {
    cameraMode.value = mode;
    soundManager.playClick();
    if (mode === 'OVERVIEW' || mode === 'TOUR') {
      selectedId.value = null;
    } else if (!selectedId.value) {
      selectedId.value = 'AGV_01';
    }
    if (mode === 'TOUR') addLog('INFO', '进入全景无人值守巡航漫游模式');
    if (mode === 'FPV') addLog('INFO', '挂载 AGV 车载前置行车监控视口');
  }

  function toggleTheme() {
    currentTheme.value = currentTheme.value === 'DARK' ? 'LIGHT' : 'DARK';
    soundManager.playClick();
    addLog(
      'INFO',
      `切换大屏视觉环境为: ${currentTheme.value === 'DARK' ? '暗黑赛博夜班' : '工业明光白班'} 模式`
    );
  }

  function toggleHeatmap() {
    showHeatmap.value = !showHeatmap.value;
    soundManager.playClick();
    addLog('INFO', `${showHeatmap.value ? '启用' : '关闭'} 车间地面通行热力密度图谱`);
  }

  function updateAgv(id: string, partial: unknown) {
    const pose = parsePose(partial);
    const target = isPlaybackMode.value ? liveAgvs.value : agvs.value;
    if (!pose || pose.id !== id || !target?.[id]) return;
    const agv = target[id];
    agv.position = pose.position;
    agv.heading = pose.heading;
    if (pose.battery !== undefined) agv.battery = pose.battery;
    if (pose.speed !== undefined) agv.speed = pose.speed;
    if (pose.metrics) Object.assign(agv.metrics, pose.metrics);
    if (pose.status) agv.status = pose.status;
    if (!isPlaybackMode.value) recordHistory();
  }

  function recordHistory() {
    const timestamp = Date.now();
    if (timestamp - (historyData.value.at(-1)?.timestamp ?? 0) < 1000) return;
    historyData.value.push({ timestamp, timeStr: new Date(timestamp).toLocaleTimeString(),
      poses: Object.fromEntries(Object.entries(agvs.value).map(([id, a]) => [id, {
        x: a.position.x, z: a.position.z, heading: a.heading, status: a.status, battery: a.battery
      }])) });
    if (historyData.value.length > 601) historyData.value.shift();
  }

  function raiseAlarmEvent(deviceId: string, reason: string, level: 'CRITICAL' | 'WARNING' = 'CRITICAL') {
    const agv = agvs.value[deviceId];
    if (!agv) return;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const event: AlarmEvent = {
      id: `ALM-${Date.now()}-${++alarmSequence}`,
      deviceId,
      deviceName: agv.name,
      time: timeStr,
      level,
      reason,
      snapshotPos: { ...agv.position },
      resolved: false
    };

    alarmEvents.value.unshift(event);
    if (alarmEvents.value.length > 10) alarmEvents.value.pop();
  }

  function resolveAlarmEvent(eventId: string) {
    const event = alarmEvents.value.find(e => e.id === eventId);
    if (event && !event.resolved) queueCommand({ kind: 'RESUME', deviceId: event.deviceId } as Omit<Command, 'id'>);
  }
  function toggleAlarm(id: string) {
    const agv = agvs.value[id];
    if (agv) queueCommand({ kind: agv.status === 'ALARM' ? 'RESUME' : 'PAUSE', deviceId: id } as Omit<Command, 'id'>);
  }
  function sendToCharge(id: string) { queueCommand({ kind: 'CHARGE', deviceId: id } as Omit<Command, 'id'>); }
  function toggleSlot(_slotId: string) { restock(); }
  function setConnectionStatus(status: 'CONNECTED' | 'RECONNECTING' | 'MOCK_MODE' | 'STALE') {
    if (connectionStatus.value === status) return;
    connectionStatus.value = status;
    if (status === 'CONNECTED') addLog('SUCCESS', '网关在线，任务状态由服务器同步');
  }
  function triggerPickTask(slotId: string) { queueCommand({ kind: 'PICK', slotId } as Omit<Command, 'id'>); }

  function exportDailyReport() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    let csvContent = '\uFEFF';
    csvContent += `车间运行快照（含模拟指标）,导出日期: ${dateStr}\n\n`;
    csvContent += '设备编号,设备名称,当前状态,动力电量(%),累计里程(km),电机温升(°C),三轴振动(mm/s),健康度评估(分)\n';

    Object.values(agvs.value).forEach((agv) => {
      csvContent += `${agv.id},${agv.name},${agv.status},${agv.battery}%,${agv.metrics.mileage},${agv.metrics.motorTemp},${agv.metrics.vibration},${agv.metrics.healthScore}\n`;
    });

    const occupiedCount = slots.value.filter((s) => s.status === 'OCCUPIED').length;
    const pickingCount = slots.value.filter((s) => s.status === 'PICKING').length;
    const emptyCount = slots.value.filter((s) => s.status === 'EMPTY').length;

    csvContent += `\n立库库存汇总,总库位: ${slots.value.length},占用: ${occupiedCount},作业中: ${pickingCount},空闲: ${emptyCount},总作业出库次数: ${taskCount.value}\n\n`;

    csvContent += '告警编号,设备,告警时间,告警详情,处置状态\n';
    if (alarmEvents.value.length === 0) {
      csvContent += '-, -, -, 生产周期内无异常急停记录, 正常\n';
    } else {
      alarmEvents.value.forEach((ev) => {
        csvContent += `${ev.id},${ev.deviceName}(${ev.deviceId}),${ev.time},"${ev.reason}",${ev.resolved ? '已复位恢复' : '未解除'}\n`;
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `W1_车间运行快照_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    addLog('SUCCESS', `已生成并下载车间运营工况数据报表 [W1_车间运行快照_${dateStr}.csv]`);
    soundManager.playClick();
  }

  function applyFrame(idx: number) {
    const frame = historyData.value[idx];
    if (!frame) return;

    Object.entries(frame.poses).forEach(([id, pose]) => {
      if (agvs.value[id]) {
        agvs.value[id].position.x = pose.x;
        agvs.value[id].position.z = pose.z;
        agvs.value[id].heading = pose.heading;
        agvs.value[id].status = pose.status;
        agvs.value[id].battery = pose.battery;
        if (pose.status === 'ALARM') {
          agvs.value[id].alarmMsg = '⚠️ 历史报警切片';
        } else {
          agvs.value[id].alarmMsg = undefined;
        }
      }
    });
  }

  function frameIndex(prog: number) {
    const frames = historyData.value;
    if (!frames.length) return -1;
    const timestamp = frames[0]!.timestamp + (frames.at(-1)!.timestamp - frames[0]!.timestamp) * prog / 100;
    let low = 0, high = frames.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (frames[mid]!.timestamp <= timestamp) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  const playbackFrameTime = computed(() => historyData.value[frameIndex(playbackProgress.value)]?.timeStr ?? '--:--:--');
  function applyProgress(prog: number) {
    applyFrame(frameIndex(prog));
  }

  function pausePlayback() {
    isPlaying.value = false;
    if (playbackTimer !== null) {
      clearInterval(playbackTimer);
      playbackTimer = null;
    }
  }

  function startPlayback() {
    if (!isPlaybackMode.value) return;
    if (playbackProgress.value >= 100) playbackProgress.value = 0;
    pausePlayback();
    isPlaying.value = true;
    const duration = (historyData.value.at(-1)?.timestamp ?? 0) - (historyData.value[0]?.timestamp ?? 0);
    if (duration <= 0) { pausePlayback(); return; }
    let lastTick = Date.now();

    playbackTimer = window.setInterval(() => {
      if (playbackProgress.value < 100) {
        playbackProgress.value = Math.min(100, playbackProgress.value + ((Date.now() - lastTick) * playbackSpeed.value / duration) * 100);
        lastTick = Date.now();
        applyProgress(playbackProgress.value);
      } else {
        pausePlayback();
        addLog('SUCCESS', '历史回放播放完成');
      }
    }, 100);
  }

  function togglePlaybackMode() {
    if (!isPlaybackMode.value) {
      if (historyData.value.length < 2) {
        addLog('WARN', '请至少采集两帧遥测后再回放');
        return;
      }
      liveAgvs.value = JSON.parse(JSON.stringify(agvs.value));
      isPlaybackMode.value = true;
      pausePlayback();
      playbackProgress.value = 0;
      applyFrame(0);
    } else {
      pausePlayback();
      if (liveAgvs.value) agvs.value = liveAgvs.value;
      liveAgvs.value = null;
      isPlaybackMode.value = false;
    }
    soundManager.playClick();
  }

  function togglePlayPause() {
    if (isPlaying.value) {
      pausePlayback();
    } else {
      startPlayback();
    }
    soundManager.playClick();
  }

  function setSpeed(speed: number) {
    if (![1, 2, 4].includes(speed)) return;
    playbackSpeed.value = speed;
    if (isPlaying.value) {
      pausePlayback();
      startPlayback();
    }
    soundManager.playClick();
  }

  function seekProgress(val: number) {
    if (!isPlaybackMode.value || !Number.isFinite(val)) return;
    playbackProgress.value = Math.max(0, Math.min(100, val));
    applyProgress(playbackProgress.value);
  }

  onScopeDispose(() => {
    pausePlayback();

  });

  return {
    tasks,
    operationState,
    commandQueue,
    pendingCommands,
    commandResults,
    handleCommandResult,
    expireCommands,
    applyOperations,
    pickAll,
    restock,
    gatewayMode,
    canSimulate,
    geofenceRequest,
    confirmGeofence,
    selectedId,
    cameraMode,
    connectionStatus,
    taskCount,
    currentTheme,
    showHeatmap,
    interAgvDistance,
    conveyorOutCount,
    pphRate,
    geofence,
    oeeData,
    alarmEvents,
    isPlaybackMode,
    isPlaying,
    playbackSpeed,
    playbackProgress,
    playbackFrameTime,
    historyData,
    logs,
    agvs,
    slots,
    selectAgv,
    setCameraMode,
    toggleTheme,
    toggleHeatmap,
    toggleGeofence,
    updateAgv,
    toggleAlarm,
    sendToCharge,
    toggleSlot,
    setConnectionStatus,
    triggerPickTask,
    addLog,
    raiseAlarmEvent,
    resolveAlarmEvent,
    exportDailyReport,
    togglePlaybackMode,
    togglePlayPause,
    setSpeed,
    seekProgress
  };
});
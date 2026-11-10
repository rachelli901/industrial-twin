# Industrial Twin 工业数字孪生大屏 · 技术文档

> 本文档为 **industrial-twin** 项目的完整技术说明，覆盖：系统定位、整体架构、模块划分与职责、核心功能清单、关键算法实现、静态化改造原理、部署形态、目录索引。
> 所有代码片段与行号均取自当前仓库源码（核对于 2026-11-09 / 2026-11-11），非凭印象撰写。
> 若只需「如何构建并发布免令牌静态演示版」，见 [STATIC_DEMO_DEPLOYMENT.md](./STATIC_DEMO_DEPLOYMENT.md)。

---

## 1. 项目概述

### 1.1 它是什么

Industrial Twin 是一套 **W1 车间机器人协同作业现场** 的数字孪生可视化系统。它把一个虚拟的工业场景（立体仓库、两台 AGV、出货输送线、充电桩、电子围栏）以 3D 形式实时渲染到大屏，并模拟完整的作业闭环：拣选出库 → AGV 搬运 → 卸货上线 → 空箱回流 → 低电量自动回充。

### 1.2 两种运行形态

| 维度 | 完整版（`dist/` + Docker Compose） | 静态演示版（`dist-static/`） |
|---|---|---|
| 仿真计算位置 | 后端 Node.js 网关（`server/SimulationEngine`） | 浏览器内置同一套引擎 |
| 通信 | WebSocket（`/v1/telemetry`）+ MQTT（Mosquitto） | 无网络，本地直驱 |
| 鉴权 | 需 `GATEWAY_TOKEN` | 免令牌 |
| 多客户端同步 | ✅ 网关统一状态 | ❌ 每人各跑各的 |
| 部署 | 三容器 Compose（Nginx + 网关 + broker） | 任意静态托管（Vercel / CF Pages / CDN） |
| 持久化 | 后端内存（重启即重置） | 浏览器内存（刷新即重置） |

两套形态**共用同一份前端 UI 与同一套仿真内核**，差别只在「数据从哪来」——这是通过统一客户端接口 + 编译期开关实现的（详见第 6 节）。

### 1.3 技术栈

| 层 | 选型 | 用途 |
|---|---|---|
| 前端框架 | Vue 3（`<script setup>` + TS） | 组件与响应式 |
| 状态管理 | Pinia | 单一数据源 store |
| 构建 | Vite 8（`vue-tsc` 类型检查 + 构建） | 开发 / 生产打包 |
| 3D 渲染 | Three.js（WebGL） | 场景、模型、相机、后期 |
| 后处理 | EffectComposer + UnrealBloom | 辉光 / 赛博感 |
| 图表 | ECharts | 遥测折线 |
| 动画 | GSAP | 相机运镜 / 缓动 |
| 通信 | WebSocket（`ws` 库，后端）/ 原生 `WebSocket`（前端） | 实时遥测 |
| 消息总线 | MQTT（Mosquitto，完整版） | 现场设备遥测（演示用 MOCK 模式不依赖） |
| 适配 | 自研 `ScaleBox` | 1920×1080 设计稿自适应任意分辨率 |

---

## 2. 整体架构

### 2.1 分层结构

```
┌──────────────────────────────────────────────────────────────┐
│                         浏览器                                  │
│                                                                │
│  ┌──────────────┐   ┌──────────────────────────────────────┐  │
│  │  UI 组件层    │   │       渲染层 (three/SceneManager)      │  │
│  │ App.vue 等    │   │  Three.js 场景 / AGV / 货架 / 相机     │  │
│  │ 9 个 .vue     │   │  动画循环 / 点击拾取 / 后期处理         │  │
│  └──────┬───────┘   └───────────────┬──────────────────────┘  │
│         │ 读状态/派指令              │ 监听 store 变化驱动物体     │
│         ▼                           ▼                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │           状态管理层 (stores/warehouse.ts · Pinia)        │  │
│  │   agvs / tasks / slots / alarms / logs / oee / history   │  │
│  └───────────────────────────┬────────────────────────────┘  │
│                                │ 收消息 → 写状态；派指令 → 发消息 │
│              ┌─────────────────┴──────────────────┐            │
│              ▼                                     ▼            │
│  ┌──────────────────────┐            ┌──────────────────────┐  │
│  │ 网关客户端(WS)        │            │ 本地仿真客户端(无网)   │  │
│  │ TelemetryClient       │            │ LocalSimulationClient │  │
│  │ (实现 GatewayClient)  │            │ (实现 GatewayClient)  │  │
│  └──────────┬───────────┘            └──────────┬───────────┘  │
└─────────────┼────────────────────────────────────┼──────────┘
              │ WebSocket /v1/telemetry             │ 浏览器内直接
              ▼                                     │ 实例化引擎
   ┌─────────────────────────────┐                 │
   │   后端网关 (server.ts)       │◄────────────────┘
   │  ┌───────────────────────┐  │
   │  │ SimulationEngine.ts   │  │  ← 与前端同一份逻辑
   │  │ navigation.ts (A*)    │  │
   │  └───────────────────────┘  │
   │  ┌───────────────────────┐  │
   │  │ MQTT Broker (Mosquitto)│  │  ← 完整版现场遥测
   │  └───────────────────────┘  │
   └─────────────────────────────┘
```

### 2.2 数据流（完整版）

1. 后端 `SimulationEngine.tick(dt)` 每 100ms 推进一次仿真，生成新的 `OperationsState`。
2. `server.ts` 通过 WebSocket 把 `snapshot()` 序列化为 `OPERATIONS_STATE` 报文广播给所有客户端。
3. `TelemetryClient` 收到后 `parseOperationsState` 校验，回调 `onMessage`。
4. `WarehouseView.vue` 的 `onMessage` 把 `OPERATIONS_STATE` 转交 `store.applyOperations()`。
5. Pinia store 更新 `agvs / tasks / slots` 等响应式状态。
6. 多个 `watch` 监听 store 变化 → 调用 `SceneManager` 的 `setTargetPose / syncSlots / setRoutes / setAgvPayload ...` → Three.js 在下一帧渲染。
7. 用户点击库位 / 按钮 → `store.queueCommand()` → `commandQueue` 变化被 `watch` 捕获 → `telemetry.send({type:'COMMAND', data})` → 后端 `dispatch()` → 回执 `COMMAND_RESULT` → store 更新。

### 2.3 数据流（静态版差异）

第 2、3、7 步的「后端 + WS」被替换：`LocalSimulationClient` 在浏览器内 `new SimulationEngine()`，用 `setInterval(100ms)` 自驱 `tick`，直接回调 `onMessage` 和模拟 `COMMAND_RESULT`。**store、UI、渲染层完全不变**。

---

## 3. 模块划分与职责

### 3.1 仿真内核层（可移植，无框架依赖）

| 文件 | 行数 | 职责 |
|---|---|---|
| `server/SimulationEngine.ts` | ~207 | 仿真引擎主体，实现 `OperationsAdapter`（`dispatch / tick / snapshot`），管理机器人移动、任务状态机、取卸货、充电、围栏、电量 |
| `server/navigation.ts` | ~68 | A* 寻路、可行走判定 `walkable`、段清空判定 `segmentClear`、工位坐标常量 |
| `src/domain/operations.ts` | ~61 | 核心类型契约（`Robot / Task / OperationsState / Command / CommandResult`）+ `parseCommand` / `parseOperationsState` 校验 |

> **关键设计**：`SimulationEngine` 与 `navigation` 是纯 TypeScript，仅用 `structuredClone / Math / Map / Set`，**零 Node API**，因此可被浏览器直接 `import` 运行（静态版的核心前提）。

### 3.2 状态管理层

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/stores/warehouse.ts` | ~581 | Pinia store，全应用唯一数据源。暴露所有响应式状态（agvs/slots/tasks/alarms/logs/oee/history…）与动作（queueCommand/applyOperations/toggleAlarm/sendToCharge/exportDailyReport/回放控制…） |

### 3.3 渲染层

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/three/SceneManager.ts` | ~1497 | Three.js 封装：场景构建、AGV/货架/输送线/充电桩几何、相机控制、后期辉光、动画主循环、点击拾取、热力图、围栏光幕、激光雷达视觉、运动轨迹、主题切换、资源释放 |

### 3.4 通信层

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/utils/telemetryClient.ts` | ~179 | WebSocket 客户端：`AUTH_REQUIRED` 鉴权、心跳保活、断线指数退避重连、报文解析与状态判定（`CONNECTED/STALE/RECONNECTING`） |
| `src/utils/telemetryProtocol.ts` | ~38 | `Pose` 解析 `parsePose` 与 `parseSlot` 字段级校验 |
| `src/utils/gatewayClient.ts` | ~15 | `GatewayClient` 统一接口（静态版与 WS 版共同实现） |
| `src/utils/localSimulationClient.ts` | ~70 | 静态版客户端：浏览器内实例化 `SimulationEngine`，自驱 tick 并模拟网关协议 |

### 3.5 UI 组件层

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/App.vue` | 根布局 | HUD 顶栏（标题/连接徽标/POI 快跳/工具栏）、左侧栏（图表+日志）、右侧栏（视角+AGV 卡+任务中心）、底部库位热力图、告警/OEE 弹窗、快捷键（H 隐藏仪表、M 静音）、全屏 |
| `src/components/WarehouseView.vue` | 入口桥接 | 挂载 `SceneManager`；按 `VITE_DEMO_MODE` 选客户端；`onMessage` 七类报文分发；多 `watch` 把 store 状态同步到 SceneManager |
| `src/components/TelemetryCharts.vue` | 图表 | ECharts 线速度双线图 + 出货/协同车距 KPI 卡 |
| `src/components/OperationLogs.vue` | 列表 | 车间调度审计流水（最多 20 条） |
| `src/components/TaskCenter.vue` | 面板 | 作业调度：执行/排队数、一键出库、补库存、机器人任务进度 |
| `src/components/AlarmCenterModal.vue` | 弹窗 | 告警与故障快照中心，一键复位 / 视点定位 |
| `src/components/EnergyOeeModal.vue` | 弹窗 | OEE 综合分 + 动力能耗核算 |
| `src/components/PlaybackTimeline.vue` | 控制条 | 历史轨迹回放（播放/暂停/倍速/进度/退出），仅回放模式可见 |
| `src/components/DeviceDetailDrawer.vue` | 抽屉 | 选中 AGV 的 PHM 健康卡 + 实时工况 + 干预按钮 |
| `src/components/ScaleBox.vue` | 容器 | 大屏等比缩放适配（1920×1080 设计稿 → 任意视口） |
| `src/components/HelloWorld.vue` | 样例 | Vite 脚手架默认组件，**未接入业务**，待清理 |

### 3.6 工具模块

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/utils/audioEffects.ts` | ~112 | `SoundEffectsManager` 单例，用 Web Audio `OscillatorNode` 程序化合成点击/急停/充电音效（无音频文件） |
| `src/components/...`（调用） + `src/three/SceneManager.ts` | — | `src/utils/conveyor.ts`（~16）纯函数 `advanceConveyor`，按帧推进输送线箱体，返回 `{exited, passes, blocking}`，被 SceneManager 调用且有单测 |

---

## 4. 核心功能清单

### 4.1 3D 数字孪生大屏
- 深色赛博场景（`SceneManager.initScene`，背景 `0x07090e` + 指数雾），WebGL 渲染，`UnrealBloom` 辉光（`setupPostProcessing`）。
- 立体仓库 12 货位用 `InstancedMesh` 合批渲染（`buildWarehouseEnvironment`，实例数 `totalSlots=12`），按状态着色（空=灰 / 占用=蓝 / 作业中=琥珀）。
- 两台 AGV 用 `GLTFLoader` 加载 `/models/robot.glb`（失败时回退为 Box），带 `AnimationMixer` 播放内置动画与激光雷达扇形、告警环、运动轨迹。

### 4.2 A* 导航与动态避障
- `findPath` 在 25cm 网格上做 A*，**仅 4 邻域无对角**（避免切膨胀后的障碍角），启发式 = 欧氏距离×4（`navigation.ts:33-68`）。
- 移动中每步用 `segmentClear` 沿段采样（0.05m 粒度）校验：不与障碍相交、且与其他 AGV 保持 `SEPARATION=1.0m`（`navigation.ts:23-30`）。若段被占，任务置 `BLOCKED` 并 1s 后重试（`SimulationEngine.block`，`retryAt`）。

### 4.3 双车任务调度
- 任务状态机 `TaskPhase`：`TO_PICK → PICKING → TO_DROP → UNLOADING → RETURNING → COMPLETED`；充电任务：`TO_CHARGER → CHARGING → RETURNING`。
- `tick` 中空闲车自动认领队列任务：低电量（<20%）且未安排充电则先建 `CHARGE` 任务；其余按「到目标点距离」升序分配（`SimulationEngine.tick:102-119`）。
- 单台机器人同时只持有一个 `taskId`，任务队列上限 24、保留历史上限 60（`execute` / `newTask`）。

### 4.4 取货 / 卸货作业链
- `PICK` 命中占用库位 → 库位置 `PICKING`（蓝→琥珀）→ AGV 导航到库位前（`target` 计算：`x:-4.5+col, z:-0.75`）→ `PICKING` 2.5s 提升货叉（高度随库位层 `tier` 插值）→ 库位变 `EMPTY`、AGV `hasPayload=true` → 转 `TO_DROP` → `UNLOADING` 1.5s 放箱到输送线 → 输送线生成 `conveyorBox`（@ `z=-1.8`）→ 回流。
- 出货计数：箱体穿越 `z=0.5` 检测面时 `conveyorCount++`（`SimulationEngine.tick:127-133`）。

### 4.5 自动回充
- 电量 `<20%` 自动入队 `CHARGE`；或用户手动「派发回充」。AGV 导航到充电桩 `charger={-4.5, 2}`，`CHARGING` 以 `+5%/s` 充电，满电后 `RETURNING`（`SimulationEngine.work:179-188`）。
- 渲染层：充电时告警环/激光变绿、绿灯呼吸（`SceneManager.setAgvCharging`）。

### 4.6 电子围栏
- `SET_GEOFENCE` 命令：若围栏区（`fence={-0.2,-0.2}` 半径 2m）内有车则拒绝（`throw '围栏区域内有车辆…'`）；启用后清空所有 `route` 并触发路径重规划（`SimulationEngine.execute:33-39`）。
- 渲染层：`geofenceMesh` 红色圆柱光幕 + 顶/底激光锁边环 + 呼吸脉冲（`SceneManager.startLoop` 围栏段）。

### 4.7 暂停 / 恢复
- `PAUSE`：机器人 `paused=true`、清 `route`、`speed=0`、状态 `ALARM`（卡片显「激光雷达防撞急停中」）；`RESUME` 恢复原任务。任务和载荷保留（`execute:61-68`）。

### 4.8 历史轨迹回放
- store 每 ≥1s 记录一帧 AGV 位姿到 `historyData`（上限 601 帧，`recordHistory`）。
- 进入复盘模式：快照现场到 `liveAgvs`，UI 切换为回放；`PlaybackTimeline` 支持播放/暂停/1×2×4× 倍速/拖拽进度。`seekProgress` 用二分在帧时间戳中定位并 `applyFrame` 还原位姿（`warehouse.ts:408-518`）。

### 4.9 库位热力图与状态面板
- App 底部 `slots-grid`：12 格反映 `EMPTY/OCCUPIED/PICKING`；点击占用格直接 `triggerPickTask` 派取出库。
- 3D 地面 `heatmapMesh`：按到通道走廊距离生成蓝→青→红热力，`toggleHeatmap` 显隐（`SceneManager.buildWarehouseEnvironment`）。

### 4.10 告警中心与急停
- 暂停/围栏触发 `raiseAlarmEvent` → `alarmEvents`（上限 10）。`AlarmCenterModal` 展示时间/设备/原因/坐标，支持「一键复位」（派 `RESUME`）与「视点定位」（选中 AGV）。

### 4.11 OEE 与能耗核算
- `oeeData`：可用率/性能/合格率/OEE 综合分 + 总电耗/减碳量（`EnergyOeeModal` 展示）。**注：当前为模拟指标**，非现场计量。

### 4.12 运行报表 CSV 导出
- `exportDailyReport`：拼接设备工况、库存汇总、告警清单，带 UTF-8 BOM（`\uFEFF`）防止 Excel 乱码，用 `Blob` + `URL.createObjectURL` 触发下载（`warehouse.ts:366-406`）。

### 4.13 音效反馈
- `soundManager`：点击（正弦 800→400Hz）、急停（方波双脉冲）、充电（三角波升调）。`isMuted` 时静默；`try/catch` 吞掉自动播放策略拦截（`audioEffects.ts`）。

### 4.14 主题 / 夜班白班
- `toggleTheme`：`DARK`（赛博夜巡）↔ `LIGHT`（工业白班），切换 scene 背景/雾/灯光强度/Bloom 强度（`SceneManager.setTheme`）。

### 4.15 多视角相机
- `CameraViewMode`：
  - `OVERVIEW` 总览、`FOCUS` 跟随选中 AGV、`FPV` 车载第一视角（相机挂到 AGV 模型）、`TOUR` 自动巡航 4 个预设机位（`SceneManager.setViewMode` + GSAP 运镜）。

### 4.16 大屏自适应缩放
- `ScaleBox` 以 `scale = min(w/1920, h/1080)` + `transform: scale + translate(-50%,-50%)` 把 1920×1080 设计稿等比居中铺满任意分辨率（`ScaleBox.vue`）。

---

## 5. 关键算法实现

### 5.1 A* 寻路（`server/navigation.ts`）

```ts
// 25cm 网格量化
const cell = (p: Point) => ({ x: Math.round(p.x * 4), z: Math.round(p.z * 4) });
// 仅 4 邻域，避免切膨胀角
for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { ... }
// 启发式：欧氏距离 × 4（格子单位）
const estimate = (k: string) => distance(point(k), goal) * 4;
```

要点：
- **无对角移动**：障碍已按 `ROBOT_CLEARANCE=0.45` 膨胀（`walkable`），若允许对角会切角穿障，故禁用。
- **起点的合法性**：从 `start` 周围 5×5 格找最近可行走且 `segmentClear` 的点作为首个节点（`navigation.ts:40-42`），避免贴墙起步即失败。
- **动态障碍**：`others`（其他 AGV 位置）参与 `valid` 与 `segmentClear` 判定，实现运行期避让。

### 5.2 任务状态机与移动（`server/SimulationEngine.ts`）

```ts
private move(robot, task, dt) {
  const goal = this.target(robot, task);
  if (!robot.route.length) {
    const path = findPath(robot.position, goal, geofenceActive, others);
    if (!path) { this.block(robot, task, '等待通道或工位释放'); return; }
    robot.route = path;
  }
  // 按剩余时间步进给进，逐步 segmentClear 校验
  while (robot.route.length && remaining > 0) {
    if (!segmentClear(...)) { this.block(robot, task, '交通让行，等待安全间距'); return; }
    robot.position = { ...position };
    if (length <= step + eps) robot.route.shift();
  }
  robot.battery = Math.max(0, robot.battery - travelled * 0.06);
  robot.metrics.mileage += travelled / 1000;
  // 到达 goal → 进入下一 phase
}
```

- `target()` 按当前 phase 返回目标点：库位前 / dropoff / charger / home。
- `work()` 处理原地作业（PICKING 提升、UNLOADING 放箱、CHARGING 充电），用 `elapsed` 计时，到时长后 `transition` 推进 phase。

### 5.3 双车协同与避让
- **任务级**：`tick` 分配时低电量优先充电；同车单任务，避免争用。
- **运动级**：`segmentClear` 保证任意时刻两车间距 ≥ `SEPARATION=1.0m`；被占则 `BLOCKED` 退避 1s 重试。
- **视觉级**：`SceneManager` 实时计算两车距离，安全间距线随距离变色（<1.4m 红 / <2.2m 琥珀 / 否则绿）。

### 5.4 电量模型
- 移动耗电：`battery -= travelled * 0.06`（约 16.7m 耗 1%）。
- 充电：`+5%/s`；满电自动 RETURNING。
- 阈值：`<20%` 触发自动回充；UI 电量条 `<=20%` 标红。

### 5.5 输送线推进（`src/utils/conveyor.ts`）
纯函数 `advanceConveyor(boxes, delta)`：按 `delta*1.2` 推进 `currentZ`，统计穿越 `z=0.5` 的 `passes`、检测面附近 `|z-0.5|<0.25` 的 `blocking`、超出 `z=3.8` 的 `exited`（并从数组 splice）。SceneManager 同时用本地（非权威）或后端（权威）模式驱动箱体，并据 `blocking` 切换光电传感器的红/绿光束。

---

## 6. 静态化改造实现原理

### 6.1 为什么能搬进浏览器
`SimulationEngine.ts` 与 `navigation.ts` 是纯 TS，依赖仅 `structuredClone / Math / Map / Set`，无 `fs` / `net` / `process` 等 Node API。因此浏览器可直接 `import { SimulationEngine } from '../../server/SimulationEngine.ts'` 运行，仿真逻辑零改写。

### 6.2 统一客户端接口（`src/utils/gatewayClient.ts`）

```ts
export interface GatewayClient {
  onAuthRequired: () => void;
  onAuthFailure: () => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onMessage: (msg: TelemetryMessage) => void;
  authenticate(token: string): void;
  send(data: object): boolean;
  destroy(): void;
}
```

`TelemetryClient`（WS 版）与 `LocalSimulationClient`（浏览器版）共同实现该接口，向 store 投递同样的 `SYSTEM_INFO / OPERATIONS_STATE / COMMAND_RESULT` 三类报文。**store、App.vue、所有图表与 3D 组件完全不需要改动**——这是解耦的关键。

### 6.3 浏览器内置仿真客户端（`src/utils/localSimulationClient.ts`）

```ts
constructor() {
  queueMicrotask(() => {           // 必须用微任务延后首帧
    this.onMessage({ type:'SYSTEM_INFO', data:{ gatewayMode:'MOCK', geofenceActive:false, brokerConnected:true }});
    this.onStatusChange('CONNECTED');
    this.emitState();
    this.timer = window.setInterval(() => {
      const now = performance.now();
      this.engine.tick((now - this.last) / 1000);   // 自驱仿真
      this.last = now;
      this.emitState();                              // 广播 snapshot
    }, 100);
  });
}
send(data) {                      // 模拟网关 dispatch
  const command = parseCommand(data);
  const result = command ? this.engine.dispatch(command)
                         : { requestId, accepted:false, message:'无效指令' };
  this.onMessage({ type:'COMMAND_RESULT', data: result });
  this.emitState();
  return true;
}
```

要点：
- **`queueMicrotask` 延后首帧**：构造函数运行时 `WarehouseView` 尚未给 `onMessage` 赋值，同步发消息会被吞；延后到微任务确保回调已挂载。
- **`parseCommand` 复用**：与后端同一套指令校验，保证语义一致。
- **`authenticate` 为空实现**：静态版无需鉴权，`SYSTEM_INFO` 直接声明 `MOCK` 模式，store 的 `canSimulate` 即满足。

### 6.4 入口开关（`src/components/WarehouseView.vue:50-56`）

```ts
if (import.meta.env.VITE_DEMO_MODE === 'static') {
  telemetry = new LocalSimulationClient();
} else {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  telemetry = new TelemetryClient(`${protocol}//${location.host}/v1/telemetry`);
}
```

`VITE_DEMO_MODE` 由 `.env.static`（`VITE_DEMO_MODE=static`）在 `vite build --mode static` 时注入 `import.meta.env`。构建产物 `dist-static/` 即为免令牌版。

### 6.5 保留 vs 失去

| 保留 | 失去 |
|---|---|
| 3D 大屏、A* 导航、双车作业闭环、取卸货、回充、围栏、暂停恢复、回放、CSV、音效、主题、多视角 | 多客户端同步（每人各跑各的） |
| 完整交互（点击库位出库、派发回充、暂停、围栏…） | MQTT 现场遥测 |
|  | 后端离线继续运行 / 服务端统一状态 |

---

## 7. 部署形态索引

| 形态 | 产物 | 部署目标 | 入口文档 |
|---|---|---|---|
| 完整版 | `dist/` | Docker Compose（Nginx 80 → 网关 8080 → Mosquitto） | `README.md`、`./PROJECT_REVIEW.md` |
| 静态演示版 | `dist-static/` | Vercel / Cloudflare Pages / 任意静态托管 / CDN | [STATIC_DEMO_DEPLOYMENT.md](./STATIC_DEMO_DEPLOYMENT.md) |

静态版已上线示例：<https://twin.ixoshub.top/>（Vercel + 自定义域名，免令牌、可交互）。

构建命令：
```sh
npm run build:static   # = vue-tsc -b && vite build --mode static --outDir dist-static
```

---

## 8. 目录结构与关键文件索引

```
industrial-twin/
├── index.html                  # Vite 入口
├── package.json                # build / build:static / dev / preview / server 脚本
├── vite.config.ts
├── tsconfig.app.json          # 含 server/**/*.ts 以便跨目录 import
├── .env / .env.example        # 完整版 GATEWAY_TOKEN 等
├── .env.static                # VITE_DEMO_MODE=static（静态版开关，已提交）
├── Dockerfile* / docker-compose.yml / nginx.conf   # 完整版容器编排
├── server/
│   ├── SimulationEngine.ts     # 仿真引擎（可移植到浏览器）
│   └── navigation.ts           # A* 寻路 + 工位坐标
├── src/
│   ├── main.ts                 # createApp + Pinia
│   ├── App.vue                 # HUD 布局根
│   ├── domain/operations.ts    # 类型契约 + 校验
│   ├── stores/warehouse.ts      # 唯一数据源（Pinia）
│   ├── three/SceneManager.ts    # Three.js 渲染层
│   ├── components/              # 9 个 UI 组件（见 §3.5）
│   └── utils/
│       ├── telemetryClient.ts       # WS 客户端
│       ├── telemetryProtocol.ts     # Pose/Slot 解析
│       ├── gatewayClient.ts         # 统一客户端接口
│       ├── localSimulationClient.ts # 静态版客户端
│       ├── audioEffects.ts          # 音效管理器
│       └── conveyor.ts              # 输送线推进纯函数
├── tests/                      # conveyor 等单测
├── public/models/robot.glb     # AGV 模型
└── docs/
    ├── STATIC_DEMO_DEPLOYMENT.md   # 部署操作手册
    └── TECHNICAL_GUIDE.md          # 本文档
```

### 关键文件速查

| 想了解 | 看 |
|---|---|
| 仿真怎么跑、任务怎么流转 | `server/SimulationEngine.ts` |
| 车怎么走、怎么避障 | `server/navigation.ts` |
| 数据长什么样、指令怎么校验 | `src/domain/operations.ts` |
| 界面状态从哪来、动作怎么派 | `src/stores/warehouse.ts` |
| 3D 场景怎么搭、怎么渲染 | `src/three/SceneManager.ts` |
| 前端怎么连后端 / 怎么免后端 | `src/utils/telemetryClient.ts` / `src/utils/localSimulationClient.ts` |
| 入口如何切换两种形态 | `src/components/WarehouseView.vue` |
| 大屏长什么样、按钮在哪 | `src/App.vue` |
```

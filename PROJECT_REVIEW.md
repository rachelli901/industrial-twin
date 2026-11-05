# Industrial Twin 深度检查

## 仿真作业升级（2026-11-05）

已将最初的轨迹播放器和前端任务定时器替换为后端统一作业引擎：双车队列与自动分配、A* 导航、货架举升取货、输送线卸货与过箱计数、归位、行驶到桩后充电、暂停后恢复原任务。页面增加作业调度面板与地面路线。刷新浏览器可以重新同步网关的任务、载荷和库存，客户端离线不影响后端任务执行。

验证：20 项自动回归通过，其中包含两轮共 18 单连续执行、双车间距与障碍检查、取卸货位置、暂停保货、到桩后充电、围栏阻塞恢复、请求幂等与多客户端同步。原修复记录中涉及本地任务定时器的描述已由本次后端引擎取代。

容器与真实 Chrome 联调通过了完整出库、实际到桩后充电、归位及刷新恢复；任务面板与三维画面已截图检查，未发现未捕获浏览器异常。新版镜像已部署至本机 7000 端口。

边界：当前为仿真作业；未对接实体 AGV/RCS，MQTT 模式仍拒绝未经适配的控制命令。当前任务存于网关进程内，重启网关会重置；历史轨迹存于浏览器内存。导航与交通规则适用于这个小场景，不代表工业安全认证。

## 修复后状态（2026-11-05）

本次已修复下文 14 项问题对应的代码路径，或在缺少现场协议时明确禁用功能，避免显示虚假成功：

- 输送线改为单次推进与独立过线计数；多个箱体同时出界可安全清理。
- 拣选改为互斥任务；急停取消取料回调，配送中急停保留货物，复位后恢复配送；拒绝任务不再污染库位。
- 网关添加 Origin 白名单、访问令牌验证、消息限额、背压、PONG 与连接错误处理。页面支持密码输入框登录与验证失败后重试。
- 现场 MQTT 模式禁用未经实现的围栏及本地模拟调度；MOCK 围栏使用服务器确认与跨客户端同步。
- 遥测在网关和前端使用共享 schema 校验与字段白名单，校验 MQTT topic 与设备/库位 ID。
- 回放来自实际接收的帧，分离实时缓存，退出恢复最新状态，按记录时间播放，移除合成历史。
- 修复工位跳转公开方法、开发 WebSocket 代理、持续退避重连、数据过期检查。图表改为每秒采样，缺失速度不补假值。
- 默认 Compose 改为 MOCK；前端绑定本机；broker 不向宿主暴露端口。现场 broker 支持配置凭据与 mqtts。
- 移除未使用 OPC UA 依赖；容器使用 npm ci 并排除宿主 node_modules。后端及脚本纳入类型检查。补充实际使用文档。
- 场景销毁补充事件、控制器、动画、后处理及场景资源清理，并防止模型在销毁后继续挂载。

验证记录：15 项自动回归通过；生产构建通过；官方 registry 依赖审计 0 漏洞；前后端容器镜像构建通过。使用临时隔离容器与真实 Chrome 验证了 HTTP/模型加载、Nginx WebSocket 代理、令牌登录、实时遥测、工位跳转、围栏确认及模拟告警切换，未发现未捕获浏览器异常，临时进程和容器已清理。

边界：没有实现厂商 PLC/调度协议，MQTT 控制因此明确拒绝；指标仍有已标注的模拟来源；历史和告警仍在内存，不是持久审计系统；未进行真实设备或长时间内存压力测试。

以下保留**修复前**审查记录与复现证据，原始描述不代表当前代码状态。

检查日期：2026-11-05。范围：全部应用源码、网关、模拟发布器、构建配置及容器配置。未修改业务源码。

结论：项目具备可构建的三维演示基础，但目前不适合直接用于真实工业监控或控制。主要阻碍是状态机竞态、实时与模拟数据混用、控制链路不完整和访问控制缺失。

## 已执行验证

- `npm run build` 通过，包括 Vue/TypeScript 项目检查与 Vite 打包。注意 server.ts 和 scripts 不在当前 tsconfig 检查范围内。
- `docker compose config --quiet` 通过；Docker daemon 可用。未构建或启动整套容器，未验证真实 PLC/MQTT 现场链路。
- 对 Pinia store 使用隔离实例与可控定时回调，复现急停覆盖、拒绝任务污染库位、历史告警残留与非法坐标传播。
- 临时启动独立端口的真实网关，确认不可信 Origin 可连接且未认证客户端可改变围栏状态；检查后已停止该进程。
- 使用受控 WebSocket 和定时器验证：6 次连接失败后进入 MOCK_MODE，剩余重连任务为 0。
- 提取实际输送线循环执行：单箱移动量为预期两倍；双箱出界可抛出 undefined.currentZ 异常。
- `npm audit --registry=https://registry.npmjs.org --json` 返回 8 个受影响依赖项：3 high、5 moderate、0 critical。这是受影响包数量，并非 8 个独立漏洞。默认 npmmirror 审计接口返回 404。
- 未进行浏览器交互、WebGL 视觉与长时间内存测试；相关界面判断来自源码。未执行自动修复或升级依赖。
- 当前目录不存在可用 Git 仓库，因此无法检查提交历史或区分已有未提交改动。构建刷新了 dist 和 TypeScript 构建缓存。

## P1：优先修复

### 1. 输送线嵌套重复循环导致速度异常与运行时崩溃

位置：src/three/SceneManager.ts:1242–1283。

外层遍历箱体时又完整遍历并推进所有箱体，内外层都执行位移和 splice。单箱每帧移动两次；多个箱体时复杂度升为 O(n²)。在两箱均位于 z=3.7、delta=0.1 时，内层删除剩余箱体，外层随后访问不存在的 item，抛出 `Cannot read properties of undefined (reading 'currentZ')`。动画后续帧仍可能调度，但当前帧处理与计数已中断。

修复：仅保留一个推进/移除循环；在循环外初始化 anyBoxBlocking，并在遍历结束后统一处理光电边缘状态。

### 2. 拣选任务定时回调覆盖急停/充电状态

位置：src/stores/warehouse.ts:372–399。

启动拣选后触发急停，再执行 2 秒回调，设备状态从 ALARM 变为 DELIVERING，告警记录仍未解除。后续 3 秒回调同样无条件设置 IDLE。重复点击 PICKING 库位或并行派发其他库位还会创建多组任务回调，重复计数并混淆载荷。

修复：使用明确状态转换和任务 ID；忙碌时拒绝新任务；急停/充电/取消时撤销任务；回调确认任务归属和允许状态后才能写入。

### 3. 控制 WebSocket 没有身份验证与 Origin 检查

位置：server.ts:9、20–52；nginx.conf:29–39。

真实连接测试中，Origin=https://untrusted.example 的客户端可以连接并提交 SET_GEOFENCE，服务器广播 active=true。任何可访问暴露端点的客户端都能读遥测并改变共享围栏；当前 Compose 将该端点经前端端口发布。MQTT 模式下此操作目前不控制 PLC，但依然能改变网关共享状态。

修复：在 upgrade 阶段验证身份与允许的 Origin，区分只读与控制权限，严格校验消息类型与字段，加入大小/频率限制及控制审计。

### 4. MQTT 模式的围栏指令未下发现场，却显示生效

位置：server.ts:38–50、71–101；src/stores/warehouse.ts:199–208。

Compose 默认使用 MQTT。SET_GEOFENCE 仅修改内存标记并广播，MQTT 适配器只有 subscribe，没有向 PLC/调度器 publish；绕行算法仅在 MOCK 仿真中消费标记。前端仍显示围栏生效并记录“已下发重规划”，现场轨迹不会因此改变。

修复：落实命令主题、关联 ID、设备确认及超时/失败状态；确认前仅显示“请求中”。若定位为展示项目，应明确标示围栏是模拟能力。

### 5. 历史回放污染实时状态，历史告警退出后无法自动恢复

位置：src/stores/warehouse.ts:442–545、256–272；src/components/WarehouseView.vue:40–44。

回放直接写入实时 agvs，没有实时快照或独立状态。seekProgress(65) 写入历史 ALARM 后退出，再注入 NAVIGATING 遥测，updateAgv 会删除 status 更新，设备持续保持历史告警。实时急停也可能被回放首帧覆盖。历史数据完全由 initMockHistory 生成，并无实际采集记录；不能作为现场事故复盘依据。10 分钟数据按当前进度步长仅约 20 秒播完，1x 也不是实际时间倍率。

修复：分离 live 与 playback 状态；回放期间继续维护 live 缓存；退出切回最新状态；用真实时间戳驱动进度，合成历史必须明确标注。

### 6. 遥测报文未经结构校验即可覆盖业务状态

位置：server.ts:85–93；src/utils/telemetryClient.ts:45–50；src/stores/warehouse.ts:256–272。

网关仅 JSON.parse，前端将整个 data Object.assign 给设备。position={x:1} 可替换完整坐标，使 z 变为 undefined，实测车距变成 NaN；null/错误字段可能使三维更新异常。攻击者或故障发布端还可覆盖非遥测业务字段。MQTT broker 端口公开且配置无认证进一步扩大输入来源。

修复：网关和前端边界进行 schema 校验、有限数值与范围检查；按白名单更新字段；校验 topic 与设备 ID 的映射；对无效包记录并丢弃。

## P2：功能与可靠性问题

### 7. 工位跳转调用不存在的组件公开方法

位置：src/App.vue:286、309；src/components/WarehouseView.vue。

App 调用 warehouseViewRef.value?.flyToPoi(key)，但 WarehouseView 没有 defineExpose 暴露该方法，实际方法只存在于 SceneManager。组件实例存在时，?. 只保护 value，不保护缺失的方法，点击跳转将发生 TypeError。

修复：在 WarehouseView 中定义转发函数并 defineExpose({ flyToPoi })，使用对应组件公开类型。

### 8. 开发环境同源 WebSocket 地址没有后端代理

位置：src/components/WarehouseView.vue:32–34；vite.config.ts:13–16。

npm run dev 下客户端访问 ws://localhost:5173/v1/telemetry，而网关监听 8080；Vite 未设置 server.proxy。即使同时运行 npm run server 也无法按当前 URL 接入。nginx 代理仅适用于容器部署。

修复：为 /v1/telemetry 配置 target=http://127.0.0.1:8080、ws=true 的开发代理，或使用可配置网关 URL。

### 9. 降级模拟模式后永久停止重连

位置：src/utils/telemetryClient.ts:82–96。

受控测试中连续 6 次失败后进入 MOCK_MODE，重连队列为 0。后端恢复后仍永久使用本地合成遥测，必须刷新页面才可能恢复真实链路。

修复：降级期间继续低频退避重连；区分真实数据、模拟数据与数据陈旧状态；生产监控应明确授权模拟模式。

### 10. 围栏初始状态和跨客户端更新被忽略

位置：server.ts:24–29、46–49；src/utils/telemetryClient.ts:3–5；src/components/WarehouseView.vue:40–51、90–96。

服务器发送 SYSTEM_INFO 与 GEOFENCE_STATUS，但前端类型和处理器仅认识 AGV_POSE/SLOT_UPDATE。刷新页面或其他客户端操作后，本地围栏标志与服务器不同步；离线点击的 send 也会静默丢弃，本地依然显示成功。

修复：补齐协议联合类型与接收处理；服务器状态为准；区分请求与确认，避免接收同步触发反向发送形成回环。

### 11. 拒绝拣选之前已将库位设为 PICKING

位置：src/stores/warehouse.ts:373–379。

设备 ALARM/CHARGING 时点击占用库位，函数先设置 slot.status=PICKING 再 return。实测任务未创建但库位留在作业中。

修复：先完成设备、库位和任务可用性检查，再原子更新双方状态。

### 12. WebSocket 在线不等于现场遥测在线

位置：server.ts:71–101；src/utils/telemetryClient.ts:33–38、66–70；src/App.vue:13–17。

网关 WebSocket 可以在 MQTT 未连接或断开时继续在线，前端只依据 ws.onopen 显示链路在线。PING 没有响应/超时判定，也没有最后遥测时间。默认 Compose 不启动 mock-plc-publisher，因此单独启动整套服务不会产生模拟 PLC 遥测，画面可保持初始数据却显示在线。

修复：分别暴露网关、broker、设备与数据时效状态；增加 PONG/超时和 telemetry freshness；为演示部署显式配置发布器或 MOCK 模式。

### 13. Broker 对外开放且无认证

位置：docker-compose.yml:7–9。

1883 发布到宿主机所有接口，使用 mosquitto-no-auth.conf。可达客户端可直接发布伪造 AGV/库位数据或订阅遥测。与第 6 项叠加可污染大屏状态。

修复：移除不必要的宿主机端口映射；现场接入需要时配置认证、按 topic 的 ACL 和适当的加密传输。

### 14. 当前依赖锁定包含已知漏洞

位置：package.json:18 与 package-lock.json。

已安装 node-opcua-client@2.138.0、node-opcua-transport@2.137.0。官方 registry 审计返回 node-opcua TCP 重连资源泄漏高危公告 GHSA-r2pf-9cw4-5j65，修复范围为 >=2.170.0；另有 glob/minimatch 相关中危依赖链。三个 high 项包含依赖传播，不应当作三个独立高危漏洞。

当前源码未引用 node-opcua-client，不能据此认定运行中的 MQTT 网关可直接利用这些 OPC UA 漏洞。优先移除未使用依赖，或升级并重跑锁文件审计与集成测试。未运行 npm audit fix。

## 其他改进

- 速度图表对整个 agvs 做 deep watch，告警、载荷、电量变化也会追加样本；没有固定采样时基，默认速度又可能掩盖缺失数据。建议只记录带时间戳的实际速度。
- OEE、能耗、碳减排、PPH 等多项为固定或随机模拟数据，真实 MQTT 模式也不切换来源。报表名为日报，但只导出当前内存快照与最多 10 条告警，不能作为持久化日报或审计记录。
- server.ts 未监听单连接 error，广播未做 bufferedAmount 背压或失活清理；大屏长时间运行与慢客户端场景需要补足生命周期管理。
- SceneManager.dispose 未完整清理模型、场景材质/纹理、事件处理和所有动画资源，异步模型加载也缺少销毁后保护。此项为源码风险，未进行内存实测。
- mock-plc-publisher 在每次 MQTT connect 都新增 interval，断线重连后可能叠加发布任务。
- 无测试脚本、CI、业务 README、健康检查与 .dockerignore；Docker 构建使用 npm install 且 COPY . . 会包含宿主 node_modules，构建可重复性与上下文体积需改善。建议 npm ci 并排除 node_modules、dist 与报告等非镜像内容。

## 建议处理顺序

1. 修复输送线崩溃与任务竞态，增加针对急停、重复派单和双箱出界的回归测试。
2. 分离实时/回放/模拟状态，落实遥测 schema 与数据时效检查。
3. 补齐访问控制、围栏确认及 MQTT 命令链路，关闭无认证 broker 暴露。
4. 修复工位跳转、开发代理与持续重连，再完善构建、依赖、文档和部署验证。

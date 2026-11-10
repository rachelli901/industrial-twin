# 静态演示版构建与部署手册

> 系统实现细节、模块划分与功能清单见 [TECHNICAL_GUIDE.md](./TECHNICAL_GUIDE.md)。

本手册说明如何将 Industrial Twin 大屏发布为一个**免令牌、无后端、可直接分享链接**的静态站点。适用于：把演示页发给客户/面试官看，或挂在自己的域名上长期展示。

> 已上线示例：<https://twin.ixoshub.top/>（Vercel + 自定义域名，免令牌、可交互）

---

## 1. 它是什么，不是什么

| 维度 | 静态演示版（`dist-static`） | 完整版（`dist`，Docker Compose） |
|---|---|---|
| 数据来源 | 浏览器内置仿真引擎 | Node.js WebSocket/MQTT 网关 `backend:8080` |
| 是否需要令牌 | **否**，打开即用 | 是，需 `GATEWAY_TOKEN` |
| 多客户端同步 | 否，每人各跑各的 | 是，网关统一状态 |
| 持久化 | 无 | 无（同样在后端内存，重启即重置） |
| 部署形态 | 任意静态托管 / CDN | 三容器 Compose（Nginx + 网关 + broker） |

**保留的能力**：3D 大屏、A* 导航、双车出库、取卸货、到桩充电、电子围栏、暂停/恢复、轨迹回放、CSV 报表、音效、主题切换。

**失去的能力**：多客户端同步、MQTT 现场遥测、后端离线继续运行、服务端统一状态。

---

## 2. 原理

1. `server/SimulationEngine.ts` 与 `server/navigation.ts` 是纯 TypeScript，仅依赖 `structuredClone` / `Math` / `Map` / `Set`，**无任何 Node 专属 API**，因此可在浏览器直接运行。
2. `src/components/WarehouseView.vue` 按编译期开关选择数据源：

   ```ts
   if (import.meta.env.VITE_DEMO_MODE === 'static') {
     telemetry = new LocalSimulationClient();
   } else {
     const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
     telemetry = new TelemetryClient(`${protocol}//${window.location.host}/v1/telemetry`);
   }
   ```

3. `TelemetryClient`（WebSocket 版）与 `LocalSimulationClient`（浏览器版）实现同一个 `GatewayClient` 接口（`src/utils/gatewayClient.ts`）。两者都向 store 投递 `SYSTEM_INFO` / `OPERATIONS_STATE` / `COMMAND_RESULT` 三类消息，因此 `stores/warehouse.ts`、`App.vue`、所有图表与 3D 组件**完全不需要改动**。

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

### 关键文件清单

| 文件 | 角色 |
|---|---|
| `src/utils/gatewayClient.ts` | 客户端统一接口（新增） |
| `src/utils/localSimulationClient.ts` | 浏览器内置仿真客户端（新增） |
| `src/components/WarehouseView.vue` | 按 `VITE_DEMO_MODE` 选择客户端（已改） |
| `.env.static` | `VITE_DEMO_MODE=static`（新增，已提交仓库） |
| `package.json` | 新增 `build:static` 脚本（已改） |
| `.gitignore` | 放行 `.env.static`（`!.env.static`，已改） |

> 未改动：`server.ts`、`server/`、`tests/`、`Dockerfile*`、`docker-compose.yml`、`nginx.conf`、`vite.config.ts`、`.env`。现有三容器部署完全不受影响。

---

## 3. 本地构建

```sh
npm ci
npm run build:static
```

- 脚本展开为：`vue-tsc -b && vite build --mode static --outDir dist-static`
- `--mode static` 让 Vite 加载 `.env.static`，注入 `VITE_DEMO_MODE=static` 到 `import.meta.env`。
- 产物输出到 `dist-static/`，**不覆盖** `dist/`（Compose 部署仍用 `dist/`）。

构建成功标志：`vite build` 0 错误；`dist-static/index.html`、`dist-static/assets/`、`dist-static/models/robot.glb` 均存在。

### 本地预览验证

```sh
npx vite preview --outDir dist-static --port 4173
```

打开 <http://localhost:4173>，预期：

- **不弹令牌框**，3D 场景直接渲染。
- 右上角连接状态为 `CONNECTED`。
- 点击蓝色占用库位能触发出库，AGV 开始运动。
- DevTools → Network 中**没有任何 `/v1/telemetry` 请求**，Console 无报错。

预览完记得自己停掉（`Ctrl+C`）。

---

## 4. 部署到 Vercel（Git 集成，推荐）

Vercel 支持「拉取仓库 → 平台侧构建 → 直接发布」，无需本地上传、无需 CLI 登录。本项目已按此方式上线 `twin.ixoshub.top`。

### 4.1 Import 配置

在 Vercel 控制台 **Add New → Project → Import Git Repository**，选择 `rachelli901/industrial-twin`，保持：

- Team / Project Name：默认
- Root Directory：`./`
- Framework Preset：`Vite`

**必须同时覆盖两项**（只改其一会发布错误的构建）：

| 字段 | 值 |
|---|---|
| Build Command（Override） | `npm run build:static` |
| Output Directory（Override） | `dist-static` |
| Install Command | 默认，不动 |
| Environment Variables | 删掉示例行，**不添加任何变量** |

> `.env.static` 已提交仓库，`--mode static` 才能生效。**不要删除它**；也不要把任何 `GATEWAY_TOKEN` 作为 Vercel 环境变量配置——静态版用不到，且令牌不应进入前端构建。

点击 **Deploy**。构建完成后给出生产域名（形如 `https://<project>.vercel.app`）。

### 4.2 绑定自定义域名（可选）

在 Project Settings → Domains 添加你的域名（如 `twin.ixoshub.top`），按提示在 DNS 添加 CNAME 记录。站点挂在域名根路径，因此 `index.html` 里的 `/assets/`、`/models/` 绝对引用直接有效，无需改 `base`。

> 若部署到子路径（如 GitHub Pages 的 `/工业-twin/`），才需要把 `vite.config.ts` 的 `base` 改为 `'./'` 或对应前缀；根域名/子域不需要。

### 4.3 自动部署

此后任意 `git push` 到 `main` 都会触发 Vercel 自动重建，链接不变。

---

## 5. 备选部署（直接上传预构建产物）

若不想走 Git 集成，可在本地构建好后直接上传 `dist-static/` 整个目录：

- **Cloudflare Pages**：`npx wrangler pages deploy dist-static`（需 `wrangler login`）。
- **Vercel Drop**：在 <https://vercel.com/drop> 拖入 `dist-static` 文件夹（注意选文件夹本身，不是项目根）。
- **GitHub Pages / 任意静态托管**：注意上文子路径的 `base` 问题。

上传式部署每次更新都要重新上传；Git 集成式则自动。

---

## 6. 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开后弹令牌框 / 显示「遥测不可用」 | 发布的是 `dist/`（原版 WS 版）而非 `dist-static` | 确认 Build Command=`npm run build:static` 且 Output Directory=`dist-static` 同时改了 |
| 构建报错 `VITE_DEMO_MODE` 未定义 | `.env.static` 缺失或被忽略 | 确认仓库含 `.env.static`，且 `.gitignore` 有 `!.env.static` |
| 页面白屏，Console 报 `/models/robot.glb` 404 | 部署到子路径，绝对路径失效 | 改 `vite.config.ts` 的 `base` 为 `'./'` 后重新构建 |
| 构建报 Node 版本不符（Vite 8 需 `^20.19.0 \|\| >=22.12.0`） | Vercel 默认 Node 偏低 | 项目根加 `"engines": {"node": ">=22.12.0"}` 提交，或在 Vercel Settings 选 Node 22/24 |
| 3D 场景不渲染但无报错 | 浏览器未启用 WebGL | 换支持 WebGL 的浏览器/开启硬件加速 |

---

## 7. 安全与边界提示

- 静态版**无需令牌**，任何拿到链接的人都能操作演示（出库、暂停、围栏、回充、补库）。这是设计预期；若只想"只读展示"可后续加只读模式（让 `LocalSimulationClient.send()` 直接返回 `false` 并隐藏控制按钮）。
- 静态版**无持久化**：每位访客各跑各的仿真，刷新页面场景重置，没有跨客户端同步。
- 本机 `127.0.0.1:7000` 那套 Compose 部署与静态版互不干扰；静态构建不写 `dist/`，不会破坏原部署。

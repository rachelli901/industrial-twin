<template>
  <section class="task-center">
    <header><strong>作业调度 · 仿真</strong><span>{{ running }} 执行 / {{ queued }} 排队</span></header>
    <div class="task-actions">
      <button class="dispatch-all" :disabled="!store.canSimulate" @click="store.pickAll()">一键出库</button>
      <button :disabled="!store.canSimulate || running + queued > 0" @click="store.restock()">补充库存</button>
    </div>
    <p class="task-hint">点击蓝色库位派单；两台车自动分工，按地面路线行驶。</p>
    <div class="robot-work" v-for="robot in store.operationState?.robots" :key="robot.id">
      <div><b>{{ robot.id }}</b><span>{{ robot.paused ? '已暂停' : robot.taskId ? phaseName[activeTask(robot.taskId)?.phase ?? 'RETURNING'] : '待命' }}</span></div>
      <small v-if="robot.taskId">{{ robot.taskId }} · {{ activeTask(robot.taskId)?.slotId ?? '充电位' }}</small>
      <small v-if="activeTask(robot.taskId)?.reason" class="wait-reason">{{ activeTask(robot.taskId)?.reason }}</small>
    </div>
    <div class="task-list">
      <article v-for="task in visibleTasks" :key="task.id" :data-task-id="task.id" :data-status="task.status">
        <div><b>{{ task.id }} · {{ task.kind === 'PICK' ? task.slotId : '回充' }}</b><span :class="task.status.toLowerCase()">{{ statusName[task.status] }}</span></div>
        <small>{{ task.deviceId ?? '等待分车' }} · {{ task.status === 'COMPLETED' ? '已归位' : phaseName[task.phase] }}</small>
        <progress :value="task.progress" max="100"></progress>
      </article>
      <p v-if="!visibleTasks.length" class="task-hint">暂无任务。点击「一键出库」开始作业。</p>
    </div>
    <p class="last-result" v-if="store.commandResults[0]" role="status">{{ store.commandResults[0].message }}</p>
    <footer>已完成 {{ store.taskCount }} 单 · 输送线已过箱 {{ store.conveyorOutCount }} 箱</footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useWarehouseStore } from '../stores/warehouse';
import type { TaskPhase, TaskStatus } from '../domain/operations';
const store = useWarehouseStore();
const phaseName: Record<TaskPhase, string> = { TO_PICK: '前往库位', PICKING: '举升取货', TO_DROP: '运往输送线', UNLOADING: '卸货交接', TO_CHARGER: '驶向充电位', CHARGING: '停靠充电', RETURNING: '返回待命位' };
const statusName: Record<TaskStatus, string> = { QUEUED: '排队', RUNNING: '执行中', PAUSED: '已暂停', BLOCKED: '等待通行', COMPLETED: '完成' };
const running = computed(() => store.tasks.filter(t => !['QUEUED', 'COMPLETED'].includes(t.status)).length);
const queued = computed(() => store.tasks.filter(t => t.status === 'QUEUED').length);
const visibleTasks = computed(() => [...store.tasks.filter(t => t.status !== 'COMPLETED'), ...store.tasks.filter(t => t.status === 'COMPLETED').reverse()].slice(0, 8));
const activeTask = (id?: string | null) => store.tasks.find(t => t.id === id);
</script>

<style scoped>
.task-center { margin-top: 12px; padding: 14px; border: 1px solid #334155; border-radius: 8px; background: rgba(15,23,42,.94); color: #e2e8f0; font-size: 12px; }
header, .robot-work>div, article>div { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
header span, small, footer, .task-hint { color: #94a3b8; font-size: 11px; }
.task-actions { display: flex; gap: 8px; margin: 12px 0 8px; }
button { flex: 1; padding: 7px; cursor: pointer; color: #e2e8f0; background: #1e293b; border: 1px solid #475569; border-radius: 4px; }
.dispatch-all { color: #38bdf8; border-color: #0284c7; }
button:disabled { opacity: .4; cursor: not-allowed; }
.task-hint { line-height: 1.6; margin: 8px 0; }
.robot-work { padding: 8px 0; border-bottom: 1px solid #334155; }
small { display: block; margin-top: 4px; }
.wait-reason, .blocked, .paused { color: #fbbf24; }
.task-list { max-height: 176px; overflow-y: auto; margin-top: 8px; }
article { padding: 8px 0; }
article b { font-size: 11px; font-weight: 500; }
.completed { color: #34d399; }
.running { color: #38bdf8; }
progress { width: 100%; height: 4px; accent-color: #38bdf8; }
.last-result { line-height: 1.5; margin: 8px 0; color: #cbd5e1; }
footer { margin-top: 8px; }
</style>

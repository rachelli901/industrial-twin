import type { Command, CommandResult, OperationsAdapter, OperationsState, Point, Robot, Task, TaskPhase } from '../src/domain/operations.ts';
import { charger, distance, dropoff, fence, findPath, homes, ROBOT_CLEARANCE, segmentClear } from './navigation.ts';

/** Backend owns inventory, movement and task transitions; browsers only issue commands. */
export class SimulationEngine implements OperationsAdapter {
  private state: OperationsState = {
    revision: 0, time: 0, geofenceActive: false, tasks: [], completedCount: 0, conveyorCount: 0, conveyorBoxes: [],
    slots: Array.from({ length: 12 }, (_, i) => ({ id: `LOC-${Math.floor(i / 4) + 1}-${i % 4 + 1}`,
      tier: Math.floor(i / 4) + 1, col: i % 4 + 1, status: (Math.floor(i / 4) + i % 4) % 2 === 0 ? 'OCCUPIED' : 'EMPTY' })),
    robots: Object.entries(homes).map(([id, position], index) => ({ id, position: { ...position }, heading: 0,
      battery: index ? 65 : 95, speed: 0, status: 'IDLE', paused: false, hasPayload: false, taskId: null,
      route: [], liftHeight: 0.7, workProgress: 0,
      metrics: { motorTemp: 32, vibration: 0, mileage: 0, healthScore: 100 } }))
  };
  private sequence = 0;
  private elapsed = new Map<string, number>();
  private retryAt = new Map<string, number>();
  private results = new Map<string, CommandResult>();

  snapshot(): OperationsState { return structuredClone(this.state); }
  dispatch(command: Command): CommandResult {
    const previous = this.results.get(command.id);
    if (previous) return { ...previous };
    let result: CommandResult;
    try { result = { requestId: command.id, accepted: true, ...this.execute(command) }; }
    catch (error) { result = { requestId: command.id, accepted: false, message: (error as Error).message }; }
    this.results.set(command.id, result);
    if (this.results.size > 1000) this.results.delete(this.results.keys().next().value!);
    this.state.revision++;
    return { ...result };
  }
  private execute(command: Command): { message: string; taskId?: string } {
    if (command.kind === 'SET_GEOFENCE') {
      if (command.active && this.state.robots.some(r => distance(r.position, fence) < fence.radius + ROBOT_CLEARANCE)) throw new Error('围栏区域内有车辆，请先驶离再启用');
      this.state.geofenceActive = command.active;
      this.state.robots.forEach(r => { r.route = []; });
      this.retryAt.clear();
      return { message: command.active ? '围栏已启用，任务重新规划路径' : '围栏已撤销，受阻任务将继续' };
    }
    if (command.kind === 'RESTOCK') {
      if (this.state.tasks.some(t => t.status !== 'COMPLETED')) throw new Error('请等待所有任务完成后补充演示库存');
      this.state.slots.forEach(s => { s.status = 'OCCUPIED'; });
      return { message: '演示库存已补满' };
    }
    if (command.kind === 'PICK' || command.kind === 'PICK_ALL') {
      const slots = command.kind === 'PICK' ? this.state.slots.filter(s => s.id === command.slotId) : this.state.slots.filter(s => s.status === 'OCCUPIED');
      if (!slots.length || slots.some(s => s.status !== 'OCCUPIED')) throw new Error('库位为空或已被任务预留');
      if (this.state.tasks.filter(t => t.status !== 'COMPLETED').length + slots.length > 24) throw new Error('任务队列已满');
      let taskId = '';
      for (const slot of slots) { const task = this.newTask('PICK'); task.slotId = slot.id; slot.status = 'PICKING'; taskId = task.id; }
      return { message: `已加入 ${slots.length} 个出库任务，等待车辆分配`, taskId };
    }
    if (!('deviceId' in command)) throw new Error('不支持的指令');
    const robot = this.state.robots.find(r => r.id === command.deviceId);
    if (!robot) throw new Error('未知设备');
    if (command.kind === 'CHARGE') {
      if (robot.taskId || robot.paused || robot.hasPayload || this.state.tasks.some(t => t.kind === 'CHARGE' && t.deviceId === robot.id && t.status !== 'COMPLETED')) throw new Error('车辆正忙或已安排回充');
      const task = this.newTask('CHARGE'); task.deviceId = robot.id;
      return { message: '回充任务已加入队列，到达充电位后开始充电', taskId: task.id };
    }
    robot.paused = command.kind === 'PAUSE';
    robot.speed = 0;
    robot.route = [];
    const task = this.state.tasks.find(t => t.id === robot.taskId);
    if (task) { task.status = robot.paused ? 'PAUSED' : 'RUNNING'; task.reason = robot.paused ? '操作员暂停' : ''; }
    robot.status = robot.paused ? 'ALARM' : task ? this.robotStatus(task.phase) : 'IDLE';
    this.retryAt.delete(robot.id);
    return { message: robot.paused ? '车辆已暂停，任务和载荷保留' : '车辆已恢复，继续原任务' };
  }
  private newTask(kind: Task['kind']) {
    const task: Task = { id: `TASK-${++this.sequence}`, kind, phase: kind === 'PICK' ? 'TO_PICK' : 'TO_CHARGER',
      status: 'QUEUED', progress: 0, reason: '', createdAt: this.state.time };
    this.state.tasks.push(task);
    // Retain a bounded completed history without dropping active work.
    while (this.state.tasks.length > 60) {
      const index = this.state.tasks.findIndex(t => t.status === 'COMPLETED');
      if (index < 0) break;
      this.state.tasks.splice(index, 1);
    }
    return task;
  }
  private robotStatus(phase: TaskPhase): Robot['status'] {
    if (phase === 'PICKING') return 'PICKING';
    if (phase === 'CHARGING') return 'CHARGING';
    if (phase === 'TO_DROP' || phase === 'UNLOADING') return 'DELIVERING';
    return 'NAVIGATING';
  }
  private target(robot: Robot, task: Task): Point {
    if (task.phase === 'TO_PICK') {
      const slot = this.state.slots.find(s => s.id === task.slotId)!;
      return { x: -4.5 + slot.col, z: -0.75 };
    }
    if (task.phase === 'TO_DROP') return dropoff;
    if (task.phase === 'TO_CHARGER') return charger;
    return homes[robot.id]!;
  }
  private transition(robot: Robot, task: Task, phase: TaskPhase, progress: number) {
    task.phase = phase; task.progress = progress; task.status = 'RUNNING'; task.reason = '';
    robot.route = []; robot.workProgress = 0; robot.speed = 0; robot.status = this.robotStatus(phase);
    this.elapsed.set(task.id, 0); this.retryAt.delete(robot.id);
  }
  tick(delta: number) {
    const dt = Math.max(0, Math.min(delta, 0.2));
    if (!dt) return;
    this.state.time += dt;
    this.state.revision++;
    for (const robot of this.state.robots) {
      if (robot.taskId || robot.paused) continue;
      // Low battery goes to the charger before accepting more picking work.
      if (robot.battery < 20 && !this.state.tasks.some(t => t.kind === 'CHARGE' && t.deviceId === robot.id && t.status !== 'COMPLETED')) {
        const charge = this.newTask('CHARGE'); charge.deviceId = robot.id;
      }
      const queued = this.state.tasks.filter(t => t.status === 'QUEUED' &&
        (t.kind === 'CHARGE' ? t.deviceId === robot.id : robot.battery >= 20));
      queued.sort((a, b) => (a.kind === 'CHARGE' ? -1 : b.kind === 'CHARGE' ? 1 :
        distance(robot.position, this.target(robot, a)) - distance(robot.position, this.target(robot, b))));
      const task = queued[0];
      if (task) { task.deviceId = robot.id; task.status = 'RUNNING'; robot.taskId = task.id; robot.status = this.robotStatus(task.phase); }
    }
    for (const robot of this.state.robots) {
      if (robot.paused) continue;
      const task = this.state.tasks.find(t => t.id === robot.taskId);
      if (!task) { robot.speed = 0; robot.status = 'IDLE'; continue; }
      if (['PICKING', 'UNLOADING', 'CHARGING'].includes(task.phase)) { this.work(robot, task, dt); continue; }
      this.move(robot, task, dt);
    }
    for (let i = this.state.conveyorBoxes.length - 1; i >= 0; i--) {
      const box = this.state.conveyorBoxes[i]!;
      const previous = box.currentZ;
      box.currentZ += dt * 1.2;
      if (previous < 0.5 && box.currentZ >= 0.5) this.state.conveyorCount++;
      if (box.currentZ > 3.8) this.state.conveyorBoxes.splice(i, 1);
    }
  }
  private move(robot: Robot, task: Task, dt: number) {
    const goal = this.target(robot, task);
    const others = this.state.robots.filter(r => r.id !== robot.id).map(r => r.position);
    if (!robot.route.length) {
      if (this.state.time < (this.retryAt.get(robot.id) ?? 0)) return;
      const path = findPath(robot.position, goal, this.state.geofenceActive, others);
      if (!path) { this.block(robot, task, '等待通道或工位释放；检查电子围栏'); return; }
      robot.route = path; task.status = 'RUNNING'; task.reason = '';
    }
    let remaining = dt * 0.9;
    let travelled = 0;
    while (robot.route.length && remaining > 0) {
      const next = robot.route[0]!;
      const length = distance(robot.position, next);
      const step = Math.min(length, remaining);
      const position = length < 0.0001 ? next : { x: robot.position.x + (next.x - robot.position.x) * step / length,
        z: robot.position.z + (next.z - robot.position.z) * step / length };
      if (!segmentClear(robot.position, position, this.state.geofenceActive, others)) { this.block(robot, task, '交通让行，等待安全间距'); return; }
      if (length > 0.0001) robot.heading = Math.atan2(next.x - robot.position.x, next.z - robot.position.z);
      robot.position = { ...position }; remaining -= step; travelled += step;
      if (length <= step + 0.0001) robot.route.shift();
    }
    robot.speed = travelled / dt;
    robot.battery = Math.max(0, robot.battery - travelled * 0.06);
    robot.metrics.mileage += travelled / 1000;
    robot.metrics.motorTemp = robot.speed > 0 ? 39 : 32;
    robot.metrics.vibration = robot.speed > 0 ? 0.6 : 0;
    robot.liftHeight += (0.7 - robot.liftHeight) * Math.min(1, dt * 3);
    if (!robot.route.length && distance(robot.position, goal) < 0.01) {
      if (task.phase === 'TO_PICK') this.transition(robot, task, 'PICKING', 25);
      else if (task.phase === 'TO_DROP') this.transition(robot, task, 'UNLOADING', 70);
      else if (task.phase === 'TO_CHARGER') this.transition(robot, task, 'CHARGING', 40);
      else {
        task.status = 'COMPLETED'; task.progress = 100; task.completedAt = this.state.time;
        robot.taskId = null; robot.status = 'IDLE'; robot.speed = 0;
        if (task.kind === 'PICK') this.state.completedCount++;
      }
    }
  }
  private block(robot: Robot, task: Task, reason: string) {
    robot.route = []; robot.speed = 0;
    task.status = 'BLOCKED'; task.reason = reason;
    this.retryAt.set(robot.id, this.state.time + 1);
  }
  private work(robot: Robot, task: Task, dt: number) {
    const elapsed = (this.elapsed.get(task.id) ?? 0) + dt;
    this.elapsed.set(task.id, elapsed);
    robot.speed = 0;
    if (task.phase === 'CHARGING') {
      robot.battery = Math.min(100, robot.battery + dt * 5);
      task.progress = 40 + robot.battery * 0.45;
      if (robot.battery >= 100) this.transition(robot, task, 'RETURNING', 90);
      return;
    }
    const duration = task.phase === 'PICKING' ? 2.5 : 1.5;
    robot.workProgress = Math.min(1, elapsed / duration);
    if (task.phase === 'PICKING') {
      const slot = this.state.slots.find(s => s.id === task.slotId)!;
      robot.heading = Math.PI;
      robot.liftHeight = 0.7 + (slot.tier * 0.8 + 0.2 - 0.7) * Math.sin(robot.workProgress * Math.PI / 2);
    } else { robot.heading = Math.PI / 2; }
    if (elapsed < duration) return;
    if (task.phase === 'PICKING') {
      this.state.slots.find(s => s.id === task.slotId)!.status = 'EMPTY';
      robot.hasPayload = true;
      this.transition(robot, task, 'TO_DROP', 45);
    } else {
      robot.hasPayload = false;
      this.state.conveyorBoxes.push({ id: task.id, currentZ: -1.8 });
      this.transition(robot, task, 'RETURNING', 85);
    }
  }
}

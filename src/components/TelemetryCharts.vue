<template>
  <div class="telemetry-panel">
    <div class="panel-header">
      <span class="panel-title">AGV 运行线速度 (m/s)</span>
      <div class="legend">
        <span class="dot agv1"></span>01·拣选
        <span class="dot agv2"></span>02·补货
      </div>
    </div>

    <!-- ECharts 动态波形容器 -->
    <div ref="chartRef" class="chart-container"></div>

    <div class="kpi-row">
      <div class="kpi-item">
        <div class="kpi-label">模拟平均节拍</div>
        <div class="kpi-val">14.2s</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-label">模拟测距就绪度</div>
        <div class="kpi-val highlight">99.8%</div>
      </div>
    </div>

    <!-- 出货分拣滚筒流水线节拍指标卡 -->
    <div class="conveyor-stat-card">
      <div class="c-header">
        <span class="c-title">出货分拣滚筒流水线</span>
        <span class="c-status">● 模拟变频运行</span>
      </div>
      <div class="c-metric-grid">
        <div class="c-item">
          <div class="label">仿真累计检出过箱</div>
          <div class="val">{{ store.conveyorOutCount ?? 158 }} <span class="unit">箱</span></div>
        </div>
        <div class="c-item">
          <div class="label">仿真累计吞吐率</div>
          <div class="val pph">{{ store.pphRate ?? 78 }} <span class="unit">PPH</span></div>
        </div>
      </div>
    </div>

    <!-- 动态防撞安全测距监控 -->
    <div class="safety-radar-card">
      <div class="radar-header">
        <span class="r-title">协同车距防撞雷达</span>
        <span
          class="r-badge"
          :class="{
            danger: (store.interAgvDistance ?? 0) < 1.4,
            warning: (store.interAgvDistance ?? 0) >= 1.4 && (store.interAgvDistance ?? 0) < 2.2,
            safe: (store.interAgvDistance ?? 0) >= 2.2
          }"
        >
          {{
            (store.interAgvDistance ?? 0) < 1.4
              ? '🛑 高风险距离'
              : (store.interAgvDistance ?? 0) < 2.2
              ? '⚠️ 距离接近阈值'
              : '🟢 安全作业间距'
          }}
        </span>
      </div>
      <div class="radar-val-row">
        <span class="num">{{ (store.interAgvDistance ?? 0).toFixed(2) }}</span>
        <span class="unit">米 (m)</span>
      </div>
      <div class="radar-progress-bar">
        <div
          class="bar-fill"
          :style="{ width: `${Math.min(100, ((store.interAgvDistance ?? 0) / 4.0) * 100)}%` }"
          :class="{
            fill_danger: (store.interAgvDistance ?? 0) < 1.4,
            fill_warn: (store.interAgvDistance ?? 0) >= 1.4 && (store.interAgvDistance ?? 0) < 2.2
          }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import * as echarts from 'echarts';
import { useWarehouseStore } from '../stores/warehouse';

const store = useWarehouseStore();
const chartRef = ref<HTMLDivElement | null>(null);
let chartInstance: echarts.ECharts | null = null;

const maxPoints = 12;
const timeLabels: string[] = [];
const agv1Speeds: (number | null)[] = [];
const agv2Speeds: (number | null)[] = [];

let sampleTimer = 0;

function initChart() {
  if (!chartRef.value) return;
  chartInstance = echarts.init(chartRef.value);

  const option: echarts.EChartsOption = {
    grid: {
      top: 15,
      right: 10,
      bottom: 20,
      left: 28
    },
    xAxis: {
      type: 'category',
      data: timeLabels,
      axisLine: { lineStyle: { color: '#334155' } },
      axisLabel: { color: '#64748b', fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 2.0,
      splitLine: { lineStyle: { color: '#1e293b' } },
      axisLabel: { color: '#64748b', fontSize: 10 }
    },
    series: [
      {
        name: '01·拣选',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: agv1Speeds,
        lineStyle: { width: 2, color: '#38bdf8' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(56, 189, 248, 0.35)' },
            { offset: 1, color: 'rgba(56, 189, 248, 0.0)' }
          ])
        }
      },
      {
        name: '02·补货',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: agv2Speeds,
        lineStyle: { width: 2, color: '#10b981' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(16, 185, 129, 0.35)' },
            { offset: 1, color: 'rgba(16, 185, 129, 0.0)' }
          ])
        }
      }
    ]
  };

  chartInstance.setOption(option);
}

function sampleSpeeds() {
  if (!chartInstance || store.isPlaybackMode) return;
  timeLabels.push(new Date().toLocaleTimeString());
  const fresh = store.connectionStatus === 'CONNECTED';
  agv1Speeds.push(fresh ? store.agvs['AGV_01']?.speed ?? null : null);
  agv2Speeds.push(fresh ? store.agvs['AGV_02']?.speed ?? null : null);
  if (timeLabels.length > maxPoints) { timeLabels.shift(); agv1Speeds.shift(); agv2Speeds.shift(); }
  chartInstance.setOption({ xAxis: { data: timeLabels }, series: [{ data: agv1Speeds }, { data: agv2Speeds }] });
}

function handleResize() {
  chartInstance?.resize();
}

onMounted(() => {
  initChart();
  sampleTimer = window.setInterval(sampleSpeeds, 1000);
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  clearInterval(sampleTimer);
  window.removeEventListener('resize', handleResize);
  chartInstance?.dispose();
});
</script>

<style scoped>
.telemetry-panel {
  background: rgba(17, 24, 39, 0.85);
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 14px;
  backdrop-filter: blur(8px);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  color: #cbd5e1;
}

.legend {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: #94a3b8;
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 4px;
}
.dot.agv1 { background: #38bdf8; }
.dot.agv2 { background: #10b981; }

.chart-container {
  width: 100%;
  height: 110px;
}

.kpi-row {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  border-top: 1px solid #1e293b;
  padding-top: 8px;
}

.kpi-item {
  display: flex;
  flex-direction: column;
}

.kpi-label {
  font-size: 10px;
  color: #64748b;
}

.kpi-val {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
  font-family: monospace;
}
.kpi-val.highlight {
  color: #38bdf8;
}

.conveyor-stat-card {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 10px 12px;
  margin-top: 10px;
}

.c-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.c-title {
  font-size: 11px;
  font-weight: 600;
  color: #cbd5e1;
}

.c-status {
  font-size: 10px;
  color: #10b981;
}

.c-metric-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.c-item .label {
  font-size: 10px;
  color: #64748b;
}

.c-item .val {
  font-size: 18px;
  font-weight: 700;
  color: #f8fafc;
  font-family: monospace;
  margin-top: 2px;
}

.c-item .val.pph {
  color: #38bdf8;
}

.c-item .unit {
  font-size: 10px;
  color: #94a3b8;
  font-weight: normal;
}

.safety-radar-card {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 10px 12px;
  margin-top: 10px;
}

.radar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.r-title {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}

.r-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.r-badge.safe {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid #10b981;
}

.r-badge.warning {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid #f59e0b;
}

.r-badge.danger {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
  border: 1px solid #ef4444;
  animation: pulse 0.8s infinite alternate;
}

@keyframes pulse {
  0% { transform: scale(0.97); }
  100% { transform: scale(1.03); }
}

.radar-val-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 6px;
}

.radar-val-row .num {
  font-size: 20px;
  font-weight: 700;
  color: #f8fafc;
  font-family: monospace;
}

.radar-val-row .unit {
  font-size: 11px;
  color: #64748b;
}

.radar-progress-bar {
  height: 4px;
  background: #1e293b;
  border-radius: 2px;
  overflow: hidden;
}

.radar-progress-bar .bar-fill {
  height: 100%;
  background: #10b981;
  transition: width 0.1s linear, background-color 0.2s;
}

.radar-progress-bar .bar-fill.fill_warn {
  background: #f59e0b;
}

.radar-progress-bar .bar-fill.fill_danger {
  background: #ef4444;
}
</style>
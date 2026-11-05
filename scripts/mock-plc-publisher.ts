// Load local configuration without overriding explicitly supplied environment variables.
try { process.loadEnvFile(); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

import * as mqtt from 'mqtt';

const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const client = mqtt.connect(BROKER_URL, { username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD });

console.log('[PLC Mock Publisher] 正在连接现场 MQTT Broker...');

let timer: ReturnType<typeof setInterval> | undefined;
client.on('close', () => { clearInterval(timer); timer = undefined; });
client.on('connect', () => {
  console.log('[PLC Mock Publisher] 连接成功，开始模拟现场 AGV 车载控制器与光电信号推送');

  clearInterval(timer);
  let t = 0;
  timer = setInterval(() => {
    t += 0.05;

    // 1. 模拟 AGV_01 车载 PLC 发布的实时遥测点位
    const agv1Payload = {
      id: 'AGV_01',
      position: {
        x: -2.0 + Math.sin(t * 0.8) * 1.5,
        z: -0.6 + Math.cos(t * 0.8) * 1.2
      },
      heading: t * 0.8 + Math.PI / 2,
      speed: +(1.2 + Math.sin(t) * 0.2).toFixed(2),
      battery: Math.max(20, Math.floor(92 - ((t * 0.2) % 60))),
      status: 'NAVIGATING',
      metrics: {
        motorTemp: +(39.2 + Math.sin(t * 0.3) * 4).toFixed(1),
        vibration: +(0.68 + Math.cos(t * 0.4) * 0.15).toFixed(2),
        mileage: +(132.8 + t * 0.02).toFixed(1),
        healthScore: 99
      }
    };

    client.publish('factory/workshop1/agv/01/telemetry', JSON.stringify(agv1Payload));

    // 2. 模拟 AGV_02 补货车点位
    const agv2Payload = {
      id: 'AGV_02',
      position: {
        x: 1.6 + Math.sin(t * 0.5) * 1.1,
        z: 0.5 + Math.cos(t * 0.5) * 0.7
      },
      heading: t * 0.5,
      speed: +(0.85 + Math.cos(t) * 0.15).toFixed(2),
      battery: Math.max(15, Math.floor(75 - ((t * 0.15) % 50))),
      status: 'NAVIGATING',
      metrics: {
        motorTemp: +(42.1 + Math.cos(t * 0.2) * 3).toFixed(1),
        vibration: +(0.74 + Math.sin(t * 0.3) * 0.12).toFixed(2),
        mileage: +(94.2 + t * 0.015).toFixed(1),
        healthScore: 96
      }
    };

    client.publish('factory/workshop1/agv/02/telemetry', JSON.stringify(agv2Payload));
  }, 100);
});

client.on('error', (err) => {
  console.error('[PLC Mock Publisher] 发布错误:', err.message);
});
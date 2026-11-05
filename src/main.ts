import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './style.css'; // 确保引入全局重置样式

const app = createApp(App);
app.use(createPinia());
app.mount('#app');
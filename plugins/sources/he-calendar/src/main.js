import { createApp } from 'vue';
import App from './App.vue';
import './main.css';
import './collectify.css';
import { initialize, status } from './bridge.js';
initialize()
    .then(() => createApp(App).mount('#app'))
    .catch((error) => {
        const node = document.createElement('p');
        node.textContent = '日历读取失败，原配置已保留：' + error.message;
        document.querySelector('#app').replaceChildren(node);
    });
status();

<script setup>
import { ref, onUnmounted } from 'vue';
import Calendar from './Calendar/index.vue';
import { onState, retry } from './bridge.js';
const active = ref(true),
    failure = ref('');
const unsubscribe = onState((state) => {
    active.value = state.active;
    failure.value = state.error;
});
onUnmounted(unsubscribe);
</script>
<template>
    <div class="app-container collectify-calendar">
        <div v-if="failure" class="save-warning" role="alert">
            {{ failure }} <button @click="retry">重试保存</button>
        </div>
        <Calendar :is-plugin-active="active" />
    </div>
</template>

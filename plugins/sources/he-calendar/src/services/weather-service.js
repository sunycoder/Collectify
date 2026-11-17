import { invoke } from '../bridge.js';
export class WeatherError extends Error {}
export class LocationError extends Error {}
export const searchLocations = (query) => invoke('weather-search', { query });
export const fetchWeatherData = (location) => invoke('weather', { location });
export const cancelWeather = () => invoke('weather-cancel').catch(() => {});
// 桌面插件保持沙箱权限边界，不申请浏览器定位权限；使用原项目的桌面城市搜索交互。
export async function autoLocateAndFetch() {
    throw new LocationError('桌面插件请在设置中搜索并选择城市');
}

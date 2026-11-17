const enums = {
    'calendar-theme': ['auto', 'default', 'ink', 'red', 'gold', 'cyan'],
    'calendar-color-mode': ['auto', 'light', 'dark'],
    'calendar-week-start': ['0', '1'],
    'calendar-show-solar-festivals': ['true', 'false'],
    'calendar-show-lunar-festivals': ['true', 'false'],
    'calendar-show-international-festivals': ['true', 'false'],
    'calendar-show-solar-terms': ['true', 'false'],
    'calendar-show-weather': ['true', 'false']
};
function location(input) {
    if (
        !input ||
        typeof input !== 'object' ||
        !Number.isFinite(input.lat) ||
        !Number.isFinite(input.lon) ||
        Math.abs(input.lat) > 90 ||
        Math.abs(input.lon) > 180 ||
        typeof input.name !== 'string' ||
        !input.name.trim() ||
        input.name.length > 100 ||
        typeof input.locationKey !== 'string' ||
        input.locationKey.length > 150
    )
        throw Error('天气城市信息不正确，请重新搜索城市');
    return { name: input.name, locationKey: input.locationKey, lat: input.lat, lon: input.lon };
}
function preferences(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 15)
        throw Error('日历设置格式不正确');
    const result = {};
    for (const [key, value] of Object.entries(input)) {
        if (key === 'calendar-weather-location') {
            if (typeof value !== 'string' || value.length > 1000) throw Error('天气城市格式不正确');
            let parsed;
            try {
                parsed = JSON.parse(value);
            } catch {
                throw Error('天气城市格式不正确');
            }
            result[key] = JSON.stringify(parsed === null ? null : location(parsed));
        } else {
            if (!Object.hasOwn(enums, key) || !enums[key].includes(value)) throw Error('不支持的日历设置：' + key);
            result[key] = value;
        }
    }
    return result;
}
module.exports = { preferences, location };

(function (root) {
    const PRESETS = [
        {
            id: 'office',
            name: '办公 · 蓝',
            caption: '清晰蓝白，轻量办公',
            accent: '#2b63e6',
            background: '#f5f6f7',
            surface: '#ffffff',
            sidebar: '#f0f2f5'
        },
        {
            id: 'linen',
            name: '亚麻 · 森',
            caption: '暖白与松绿，安静而清晰',
            accent: '#476354',
            background: '#f5f4f0',
            surface: '#fffefa',
            sidebar: '#24352e'
        },
        {
            id: 'mist',
            name: '雾蓝 · 岩',
            caption: '灰白与靛蓝，专注工作',
            accent: '#536ba0',
            background: '#f2f4f8',
            surface: '#ffffff',
            sidebar: '#263044'
        },
        {
            id: 'clay',
            name: '陶土 · 沙',
            caption: '米色与赭石，温润有序',
            accent: '#9a664e',
            background: '#f7f2eb',
            surface: '#fffdf9',
            sidebar: '#3c312b'
        },
        {
            id: 'iris',
            name: '鸢尾 · 紫',
            caption: '淡灰与灰紫，轻盈柔和',
            accent: '#776393',
            background: '#f5f3f8',
            surface: '#fffdff',
            sidebar: '#302b3b'
        },
        {
            id: 'ink',
            name: '墨夜 · 月',
            caption: '炭灰与银青，舒适夜间',
            accent: '#9bb6ae',
            background: '#1d2525',
            surface: '#283131',
            sidebar: '#151c1c'
        },
        {
            id: 'rose',
            name: '蔷薇 · 奶',
            caption: '奶白与烟粉，柔和一点',
            accent: '#a06376',
            background: '#f8f3f3',
            surface: '#fffdfc',
            sidebar: '#3b2c33'
        }
    ];
    const hex = (value, fallback) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

    function validate(input = {}) {
        const preset = PRESETS.find(p => p.id === input.preset) || PRESETS[0];
        return {
            preset: preset.id,
            accent: hex(input.accent, preset.accent),
            background: hex(input.background, preset.background),
            surface: hex(input.surface, preset.surface),
            sidebar: hex(input.sidebar, preset.sidebar),
            radius: Number.isFinite(Number(input.radius)) ? Math.max(8, Math.min(22, Number(input.radius))) : preset.id === 'office' ? 8 : 14,
            density: input.density === 'compact' ? 'compact' : 'comfortable',
            motion: input.motion !== false,
            widgetMaterial: input.widgetMaterial === 'glass' ? 'glass' : 'solid',
            glassOpacity: Number.isFinite(Number(input.glassOpacity)) ? Math.max(55,Math.min(95,Number(input.glassOpacity))) : 78
        };
    }

    function luminance(color) {
        const rgb = color.match(/[\da-f]{2}/gi).map(n => parseInt(n, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    }

    function contrast(a, b) {
        const aa = luminance(a), bb = luminance(b);
        return (Math.max(aa, bb) + .05) / (Math.min(aa, bb) + .05);
    }

    function foreground(background) {
        return contrast(background, '#ffffff') > contrast(background, '#000000') ? '#ffffff' : '#000000';
    }

    function tokens(input) {
        const theme = validate(input), dark = luminance(theme.surface) < .2, office = theme.preset === 'office',
            fg = dark ? '#e5e6eb' : office ? '#1f2329' : '#24332c';
        return {
            '--paper': theme.background,
            '--paper-ink': office ? fg : foreground(theme.background),
            '--paper-muted': office ? '#646a73' : luminance(theme.background) < .2 ? '#a7b4ad' : '#718077',
            '--surface': theme.surface,
            '--sidebar': theme.sidebar,
            '--sidebar-fg': office ? '#1f2329' : foreground(theme.sidebar),
            '--ink': fg,
            '--accent': theme.accent,
            '--accent-fg': foreground(theme.accent),
            '--accent-text': contrast(theme.accent, theme.surface) >= 4.5 ? theme.accent : fg,
            '--muted': dark ? '#a7b4ad' : office ? '#646a73' : '#718077',
            '--subtle': dark ? '#7f9188' : office ? '#8f959e' : '#8a978e',
            '--line': dark ? '#3c4943' : office ? '#e4e7ed' : '#e1e6df',
            '--radius': `${theme.radius}px`,
            '--card-padding': theme.density === 'compact' ? '18px' : '23px',
            '--card-height': theme.density === 'compact' ? '195px' : '218px',
            '--motion': theme.motion ? '180ms' : '0ms',
            '--hover-y': theme.motion ? '-2px' : '0px',
            'color-scheme': dark ? 'dark' : 'light'
        };
    }

    function apply(input, target = document.documentElement) {
        const theme = validate(input);
        Object.entries(tokens(theme)).forEach(([name, value]) => target.style.setProperty(name, value));
        target.dataset.motion = String(theme.motion);
        target.dataset.density = theme.density;
        target.dataset.theme = theme.preset;
        target.dataset.widgetMaterial=theme.widgetMaterial;
        target.style.setProperty('--glass-opacity',`${theme.glassOpacity}%`);
        return theme;
    }

    const api = {PRESETS, validate, tokens, contrast, apply};
    if (typeof module !== 'undefined') module.exports = api;
    else root.ShiyueTheme = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// 原创 24px 线性 SVG，沿用工作台的圆角、1.7px 笔画和 currentColor。
const SEARCH_ICONS = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    settings:
        '<path d="m9 3-1 3-3 1-2 3 2 2v3l3 1 1 3h5l1-3 3-1v-3l2-2-2-3-3-1-1-3Z"/><circle cx="11.5" cy="11" r="3"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    'file-text':
        '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 9v12M15 9v12"/>',
    video: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
    music: '<path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    archive: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 3v3h4V3m-4 6h4m-4 3h4m-4 4h4v3h-4Z"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 18"/>',
    external: '<path d="M14 3h7v7M21 3 11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'
};
function searchIcon(name) {
    const node = document.createElement('span');
    node.className = 'search-icon';
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${SEARCH_ICONS[name] || SEARCH_ICONS['file-text']}</svg>`;
    return node;
}
document.querySelectorAll('[data-icon]').forEach((node) => node.replaceChildren(searchIcon(node.dataset.icon)));

const { isIP, BlockList } = require('node:net');
const defaults = require('./defaults.json');
// 只接受 IP 字面量，禁止把用户输入当成 URL、主机名或路径访问。
function address(value) {
    if (typeof value !== 'string') throw Error('请输入 IPv4 或 IPv6 地址');
    const text = value.trim();
    if (!text) return '';
    if (text.length > 45 || text.includes('%') || !isIP(text))
        throw Error('请输入有效的 IPv4 或 IPv6 地址，不包含协议、端口或域名');
    return isIP(text) === 6 ? new URL(`http://[${text}]/`).hostname.slice(1, -1) : text;
}
const reserved = new BlockList();
for (const [ip, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 3]
])
    reserved.addSubnet(ip, prefix, 'ipv4');
for (const [ip, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
    ['2001:db8::', 32]
])
    reserved.addSubnet(ip, prefix, 'ipv6');
function localReason(ip) {
    if (!ip) return '';
    // IPv4 映射 IPv6 必须按内嵌 IPv4 同样判断，避免将内网地址发送给数据源。
    if (ip.startsWith('::ffff:')) {
        const tail = ip.slice(7).split(':');
        if (tail.length === 2) {
            const value = (parseInt(tail[0], 16) * 65536 + parseInt(tail[1], 16)) >>> 0;
            return localReason([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'));
        }
    }
    return reserved.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4')
        ? '这是内网、保留或特殊用途地址，没有可查询的公网归属地；未向外部服务发送请求。'
        : '';
}
const text = (value) => (typeof value === 'string' ? value.slice(0, 300) : '');
function normalize(provider, input, requested) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('数据源返回格式不正确');
    if (input.success === false || input.error || input.bogon) throw Error('数据源未找到该地址的公网信息');
    const ip = address(input.ip);
    if (!ip || (requested && ip !== requested)) throw Error('数据源返回的 IP 与查询地址不一致');
    const asn = provider === 'ipwhois' ? input.connection?.asn : input.asn;
    const latitude = provider === 'ipwhois' ? input.latitude : undefined;
    const longitude = provider === 'ipwhois' ? input.longitude : undefined;
    return {
        ip,
        type: isIP(ip) === 6 ? 'IPv6' : 'IPv4',
        country: text(provider === 'ipwhois' ? input.country : input.country_name),
        region: text(input.region),
        city: text(input.city),
        countryCode: text(provider === 'ipwhois' ? input.country_code : input.country),
        isp: text(provider === 'ipwhois' ? input.connection?.isp : input.as_name),
        organization: text(provider === 'ipwhois' ? input.connection?.org : input.as_name),
        asn: typeof asn === 'number' && Number.isSafeInteger(asn) ? `AS${asn}` : text(asn),
        timezone: text(provider === 'ipwhois' ? input.timezone?.id : undefined),
        latitude: Number.isFinite(latitude) && Math.abs(latitude) <= 90 ? latitude : null,
        longitude: Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? longitude : null,
        provider,
        source: defaults.providers[provider].label
    };
}
module.exports = { address, localReason, normalize };

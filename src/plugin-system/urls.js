function validUrl(value) {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
        return false;
    }
}
module.exports = { validUrl };

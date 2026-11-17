const { parentPort, workerData } = require('node:worker_threads'),
    fs = require('node:fs'),
    path = require('node:path'),
    { gunzipSync } = require('node:zlib');
(async () => {
    const core = await require(path.join(__dirname, 'ocr-core.cjs'))({ print: () => {}, printErr: () => {} });
    const languages = workerData.data.language === 'eng' ? ['eng'] : ['eng', 'chi_sim'];
    for (const language of languages)
        core.FS.writeFile(
            language + '.traineddata',
            gunzipSync(fs.readFileSync(path.join(__dirname, 'ocr-' + language + '.txt')))
        );
    const api = new core.TessBaseAPI();
    try {
        if (api.Init(null, languages.join('+'), 1) !== 0) throw Error('离线字库初始化失败');
        core.FS.writeFile('/input', Buffer.from(workerData.data.image, 'base64'));
        if (api.SetImageFile(1, 0) === 1) throw Error('无法读取识别图片');
        api.SetVariable('preserve_interword_spaces', '1');
        api.SetPageSegMode(3);
        api.Recognize(null);
        const text = api.GetUTF8Text(),
            tsv = api.GetTSVText();
        const words = tsv
            .split('\n')
            .slice(1)
            .map((line) => line.split('\t'))
            .filter((c) => Number(c[0]) === 5 && c.slice(11).join('\t').trim())
            .slice(0, 20000)
            .map((c) => ({
                text: c.slice(11).join('\t'),
                x: Number(c[6]),
                y: Number(c[7]),
                width: Number(c[8]),
                height: Number(c[9]),
                confidence: Number(c[10])
            }));
        parentPort.postMessage({ result: { text, words, confidence: api.MeanTextConf() } });
    } finally {
        api.End();
        core.destroy(api);
    }
})().catch((error) => parentPort.postMessage({ error: error.message }));

const assert = require('node:assert/strict');
exports.run = async ({ win, runtime, services, hostAction }) => {
    await win.webContents.executeJavaScript('shellReady');
    await hostAction('plugin-open', { id: 'collectify.bookmarks' });
    const page = (code) => runtime.views.get('collectify.bookmarks').view.webContents.executeJavaScript(code);
    await page(
        "showEditor().then(()=>{const f=document.querySelector('#entry-form');f.elements.type.value='credential';updateResourceFields();f.elements.name.value='SVN 资料回归';f.elements.url.value='svn://svn.example.com/project-svn';f.elements.username.value='test-user';f.elements.password.value='test-password';f.requestSubmit();})"
    );
    const store = services.providers.get('collectify.bookmarks').store;
    let entry;
    for (let i = 0; i < 100; i++) {
        entry = store.entries.find((e) => e.name === 'SVN 资料回归');
        if (entry) break;
        await new Promise((r) => setTimeout(r, 30));
    }
    assert.ok(entry, '账号资料的 SVN 地址应保存成功');
    assert.equal(entry.url, 'svn://svn.example.com/project-svn');
    assert.equal(entry.password, 'test-password');
    await page(`refresh().then(()=>showCredentials(state.entries.find(e=>e.id===${JSON.stringify(entry.id)})))`);
    assert.equal(await page("document.querySelector('#credential-reference').value"), entry.url);
    assert.equal(await page("document.querySelector('#credential-password').value"), 'test-password');
    await page("document.querySelector('#credential-dialog').close()");
    const text = await services.call('collectify.bookmarks', 'save', {
        type: 'text',
        name: '带账号的文本',
        content: 'svn://svn.example.com/repo',
        username: 'text-user',
        password: 'text-password'
    });
    assert.equal(text.username, 'text-user');
    assert.equal(text.password, 'text-password');
    assert.equal(await services.call('collectify.bookmarks', 'password', text.id), 'text-password');
    console.log(
        'BOOKMARK RESOURCES PASS：真实表单保存 SVN 账号资料、关联地址展示、密码查看和文本附带凭据通过；使用隔离测试数据。'
    );
};

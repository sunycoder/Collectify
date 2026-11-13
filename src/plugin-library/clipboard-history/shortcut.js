const button = document.querySelector('#open');
button.onclick = async () => {
    try {
        await collectify.windows.reveal();
    } catch (error) {
        button.title = error.message;
    }
};
document.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    try {
        await collectify.background.request({ action: 'shortcut', enabled: false });
    } catch (error) {
        button.title = error.message;
    }
});

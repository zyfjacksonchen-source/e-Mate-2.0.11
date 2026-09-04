export function projectComputerUseStatus(status) {
    if (!status.ready) {
        return status.lastError === undefined
            ? { state: 'blocked', detail: 'Computer Use 原生 provider 尚未就绪。', action_ids: [] }
            : { state: 'failed', detail: status.lastError.slice(0, 240), action_ids: [] };
    }
    const windows = status.provider === 'windows-uia' || status.platform === 'win32';
    if (status.accessibility === 'unavailable' || status.screenRecording === 'unavailable') {
        return { state: 'blocked', detail: windows
                ? 'Computer Use 无法取得 Windows UI Automation 或窗口捕获权限。'
                : 'Computer Use 无法读取所需的 macOS 权限状态。', action_ids: [] };
    }
    const action_ids = [];
    if (!windows && status.accessibility !== 'granted')
        action_ids.push('open-accessibility-settings');
    if (!windows && status.screenRecording !== 'granted')
        action_ids.push('open-screen-recording-settings');
    if (windows && (status.accessibility !== 'granted' || status.screenRecording !== 'granted')) {
        return { state: 'blocked', detail: 'Windows UI Automation、窗口捕获或输入权限不可用。', action_ids: [] };
    }
    if (action_ids.length !== 0) {
        return { state: 'setup-required', detail: '需要在 macOS 系统设置中开启对应权限。', action_ids };
    }
    const access = status.applicationAccess;
    if (access?.allowAllApps !== true && !(Number.isSafeInteger(access?.controlGrants) && access.controlGrants > 0)) {
        return {
            state: 'setup-required',
            detail: windows ? 'Windows 原生权限已就绪，但尚未在 Computer Use 设置中授权任何应用操作。' : 'macOS 权限已就绪，但尚未在 Computer Use 设置中授权任何应用操作。',
            action_ids: [],
        };
    }
    return { state: 'ready', detail: windows ? '原生 helper、Windows UI Automation、窗口捕获和应用操作授权均已就绪。' : '原生 helper、macOS 权限和应用操作授权均已就绪。', action_ids: [] };
}

export function installComputerUseCapability(ctx, service) {
    return ctx.effect(() => ctx.emateCapabilities.register({
        id: 'computer-use',
        title: '电脑操控',
        summary: '通过平台原生辅助功能和窗口捕获，在用户显式选择 @电脑操控 后操作本机应用。',
        icon_key: 'collaboration',
        order: 35,
        actions: process.platform === 'darwin' ? [
            { id: 'open-accessibility-settings', label: '打开辅助功能设置', kind: 'primary' },
            { id: 'open-screen-recording-settings', label: '打开屏幕录制设置', kind: 'primary' },
        ] : [],
        invoke: async (actionId, _data, signal) => {
            if (actionId === 'open-accessibility-settings')
                await service.openPermissionSettings('accessibility', signal);
            else if (actionId === 'open-screen-recording-settings')
                await service.openPermissionSettings('screen-recording', signal);
            else
                throw new Error('unknown Computer Use capability action');
            return { opened: actionId };
        },
        status: async () => projectComputerUseStatus(service.status()),
    }), 'dsh-computer-use: e-Mate capability metadata');
}

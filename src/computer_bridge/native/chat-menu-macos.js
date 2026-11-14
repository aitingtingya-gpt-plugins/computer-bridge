// A visible, short-lived AppKit copy panel owns its own keyboard shortcuts.
// No global event tap, input monitoring, or clipboard access lives here.
ObjC.import('AppKit');

function run(argv) {
    const app = $.NSApplication.sharedApplication;
    app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
    const previous = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    const owner = Number(argv[0]);
    if (previous.isNil() || Number(previous.processIdentifier) !== owner) return '';
    const canCopy = argv[3] === '1';
    let choice = '', tracking = false;
    function finish(value) {
        choice = value;
        if (tracking) app.stopModal;
    }
    ObjC.registerSubclass({
        name: 'ComputerBridgeCopyPanel', superclass: 'NSPanel', methods: {
            canBecomeKeyWindow: {types: ['bool', []], implementation: () => true},
            'performKeyEquivalent:': {types: ['bool', ['id']], implementation: event => {
                const modifiers = Number(event.modifierFlags) & (
                    Number($.NSEventModifierFlagCommand) | Number($.NSEventModifierFlagControl) |
                    Number($.NSEventModifierFlagOption) | Number($.NSEventModifierFlagShift));
                if (modifiers !== Number($.NSEventModifierFlagCommand)) return false;
                const key = ObjC.unwrap(event.charactersIgnoringModifiers).toLowerCase();
                if (key === 'c' && canCopy) { finish('copy'); return true; }
                if (key === 'v') { finish('paste'); return true; }
                return false;
            }},
            'keyDown:': {types: ['void', ['id']], implementation: event => {
                if (Number(event.keyCode) === 53) finish('');
            }},
        },
    });
    ObjC.registerSubclass({
        name: 'ComputerBridgeCopyTarget', superclass: 'NSObject', methods: {
            'choose:': {types: ['void', ['id']], implementation: item => finish(Number(item.tag) === 1 ? 'copy' : 'paste')},
            'windowDidResignKey:': {types: ['void', ['id']], implementation: () => { if (tracking) finish(''); }},
            'applicationDidResignActive:': {types: ['void', ['id']], implementation: () => { if (tracking) finish(''); }},
            'cancelIfRequested:': {types: ['void', ['id']], implementation: () => {
                if (argv[4] && $.NSFileManager.defaultManager.fileExistsAtPath(argv[4])) finish('');
            }},
            'expire:': {types: ['void', ['id']], implementation: () => finish('')},
        },
    });
    const target = $.ComputerBridgeCopyTarget.alloc.init;
    const width = 224, height = 76;
    const screens = $.NSScreen.screens;
    const mouse = $.NSMakePoint(Number(argv[1]), screens.objectAtIndex(0).frame.size.height - Number(argv[2]));
    let visible = screens.objectAtIndex(0).visibleFrame;
    for (let i = 0; i < screens.count; i++) {
        const frame = screens.objectAtIndex(i).frame;
        if (mouse.x >= frame.origin.x && mouse.x < frame.origin.x + frame.size.width &&
                mouse.y >= frame.origin.y && mouse.y < frame.origin.y + frame.size.height) visible = screens.objectAtIndex(i).visibleFrame;
    }
    const x = Math.max(visible.origin.x, Math.min(mouse.x + 3, visible.origin.x + visible.size.width - width));
    const y = Math.max(visible.origin.y, Math.min(mouse.y - height - 3, visible.origin.y + visible.size.height - height));
    const panel = $.ComputerBridgeCopyPanel.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(x, y, width, height), $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false);
    panel.level = $.NSPopUpMenuWindowLevel;
    panel.hasShadow = true;
    panel.opaque = false;
    panel.backgroundColor = $.NSColor.clearColor;
    panel.delegate = target;
    app.delegate = target;
    const surface = $.NSVisualEffectView.alloc.initWithFrame($.NSMakeRect(0, 0, width, height));
    surface.material = $.NSVisualEffectMaterialMenu;
    surface.blendingMode = $.NSVisualEffectBlendingModeBehindWindow;
    surface.state = $.NSVisualEffectStateActive;
    surface.wantsLayer = true;
    surface.layer.cornerRadius = 8;
    panel.contentView = surface;
    for (const [label, tag, enabled, row, key] of [['复制', 1, canCopy, 1, 'c'], ['粘贴', 2, true, 0, 'v']]) {
        const button = $.NSButton.alloc.initWithFrame($.NSMakeRect(8, 8 + row * 30, width - 16, 30));
        button.title = label + '                         ⌘' + key.toUpperCase();
        button.font = $.NSFont.menuFontOfSize(14);
        button.bordered = false;
        button.alignment = $.NSTextAlignmentLeft;
        button.enabled = enabled;
        button.keyEquivalent = key;
        button.keyEquivalentModifierMask = $.NSEventModifierFlagCommand;
        button.target = target;
        button.action = 'choose:';
        button.tag = tag;
        surface.addSubview(button);
    }
    const timer = $.NSTimer.timerWithTimeIntervalTargetSelectorUserInfoRepeats(30, target, 'expire:', $(), false);
    $.NSRunLoop.currentRunLoop.addTimerForMode(timer, $.NSModalPanelRunLoopMode);
    const cancellation = $.NSTimer.timerWithTimeIntervalTargetSelectorUserInfoRepeats(.05, target, 'cancelIfRequested:', $(), true);
    $.NSRunLoop.currentRunLoop.addTimerForMode(cancellation, $.NSModalPanelRunLoopMode);
    try {
        if (argv[4] && $.NSFileManager.defaultManager.fileExistsAtPath(argv[4])) return '';
        app.finishLaunching;
        if (Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier) !== owner) return '';
        app.activateIgnoringOtherApps(true);
        panel.makeKeyAndOrderFront($());
        tracking = true;
        app.runModalForWindow(panel);
    } finally {
        tracking = false;
        timer.invalidate;
        cancellation.invalidate;
        panel.orderOut($());
        if (app.isActive && !previous.isNil()) previous.activateWithOptions(0);
    }
    return choice;
}

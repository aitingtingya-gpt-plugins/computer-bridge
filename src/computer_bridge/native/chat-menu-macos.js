// AppKit tracks the native menu until it is dismissed or an item is chosen.
ObjC.import('AppKit');

function run(argv) {
    const app = $.NSApplication.sharedApplication;
    app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
    let choice = '';
    ObjC.registerSubclass({
        name: 'ComputerBridgeMenuTarget',
        superclass: 'NSObject',
        methods: {
            'choose:': {
                types: ['void', ['id']],
                implementation: (item) => { choice = Number(item.tag) === 1 ? 'copy' : 'paste'; },
            },
        },
    });
    const target = $.ComputerBridgeMenuTarget.alloc.init;
    const menu = $.NSMenu.alloc.initWithTitle('');
    menu.autoenablesItems = false;
    for (const [label, tag, enabled] of [['复制', 1, argv[2] === '1'], ['粘贴', 2, true]]) {
        const item = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(label, 'choose:', '');
        item.target = target;
        item.tag = tag;
        item.enabled = enabled;
        menu.addItem(item);
    }
    const screen = $.NSScreen.screens.objectAtIndex(0);
    const point = $.NSMakePoint(Number(argv[0]), screen.frame.size.height - Number(argv[1]));
    menu.popUpMenuPositioningItemAtLocationInView($(), point, $());
    return choice;
}

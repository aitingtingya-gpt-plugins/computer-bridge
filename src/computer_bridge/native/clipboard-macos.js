// Read only. The TUI owns the destination and removes temporary image files.
ObjC.import('AppKit');

function run(argv) {
    const board = $.NSPasteboard.generalPasteboard;
    const items = board.pasteboardItems;
    const paths = [];
    for (let i = 0; i < items.count; i++) {
        const value = items.objectAtIndex(i).stringForType('public.file-url');
        if (!value.isNil()) {
            const url = $.NSURL.URLWithString(value);
            if (url.isFileURL) paths.push(ObjC.unwrap(url.path));
        }
    }
    if (paths.length) return JSON.stringify({kind: 'files', paths: paths});

    const png = board.dataForType($.NSPasteboardTypePNG);
    if (!png.isNil()) {
        if (!png.writeToFileAtomically(argv[0], true)) throw new Error('无法保存剪贴板图片。');
        return JSON.stringify({kind: 'image', paths: [argv[0]]});
    }
    const image = $.NSImage.alloc.initWithPasteboard(board);
    if (!image.isNil()) {
        const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
        const data = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
        if (data.isNil() || !data.writeToFileAtomically(argv[0], true)) throw new Error('无法转换剪贴板图片。');
        return JSON.stringify({kind: 'image', paths: [argv[0]]});
    }
    const text = board.stringForType($.NSPasteboardTypeString);
    return JSON.stringify(text.isNil() ? {kind: 'empty'} : {kind: 'text', text: ObjC.unwrap(text)});
}

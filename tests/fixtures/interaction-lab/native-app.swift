import AppKit

func recordNativeEvent(_ value:[String:Any]) {
    guard CommandLine.arguments.count == 2,
          let data = try? JSONSerialization.data(withJSONObject:value) else { return }
    let url=URL(fileURLWithPath:CommandLine.arguments[1]).appendingPathComponent("native-events.jsonl")
    if !FileManager.default.fileExists(atPath:url.path) {FileManager.default.createFile(atPath:url.path,contents:nil)}
    if let file=try? FileHandle(forWritingTo:url) {defer{try? file.close()};try? file.seekToEnd();try? file.write(contentsOf:data+Data([10]))}
}
final class LabApplication:NSApplication {
    override func sendEvent(_ event:NSEvent) {
        if [.leftMouseDown,.leftMouseDragged,.leftMouseUp].contains(event.type) {
            recordNativeEvent(["event":event.type.rawValue,"x":event.locationInWindow.x,"y":event.locationInWindow.y,"window":event.windowNumber])
        }
        super.sendEvent(event)
    }
}

// Dedicated acceptance app. Its only write target is the new directory passed
// by the test launcher; it never opens or modifies an existing user document.
final class DropZone: NSView {
    var onDrop: (() -> Void)?
    override init(frame: NSRect) {super.init(frame: frame);registerForDraggedTypes([.string]);setAccessibilityLabel("原生拖拽目标")}
    required init?(coder: NSCoder) {fatalError()}
    override func draw(_ dirtyRect: NSRect) {NSColor.systemPurple.withAlphaComponent(0.15).setFill();NSBezierPath(roundedRect:bounds,xRadius:10,yRadius:10).fill();("把测试卡片拖到这里" as NSString).draw(at:NSPoint(x:18,y:30),withAttributes:[.foregroundColor:NSColor.labelColor])}
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {recordNativeEvent(["event":"drag-enter"]);return .copy}
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard sender.draggingPasteboard.string(forType:.string)=="enigma-new-native-card" else {return false}
        recordNativeEvent(["event":"drop"]);onDrop?();return true
    }
}
final class DragCard: NSView, NSDraggingSource {
    override func draw(_ dirtyRect: NSRect) {NSColor.systemPurple.withAlphaComponent(0.3).setFill();NSBezierPath(roundedRect:bounds,xRadius:8,yRadius:8).fill();("原生测试卡片" as NSString).draw(at:NSPoint(x:12,y:15),withAttributes:[.foregroundColor:NSColor.labelColor])}
    override func mouseDown(with event: NSEvent) {
        recordNativeEvent(["event":"card-down"])
        let value=NSPasteboardItem();value.setString("enigma-new-native-card",forType:.string)
        let item=NSDraggingItem(pasteboardWriter:value);item.setDraggingFrame(bounds,contents:NSImage(size:bounds.size));beginDraggingSession(with:[item],event:event,source:self)
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {.copy}
}
final class NativeFixture: NSObject, NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate {
    var window:NSWindow!
    let name=NSTextField(string:""),note=NSTextView(),color=NSPopUpButton(),confirmed=NSButton(checkboxWithTitle:"确认新建测试",target:nil,action:nil),status=NSTextField(labelWithString:"尚未保存")
    let table=NSTableView(),drop=DropZone(frame:.zero)
    var dragDone=false,doubleClicks=0
    var output:URL!
    func applicationDidFinishLaunching(_ notification:Notification) {
        guard CommandLine.arguments.count==2 else {NSApp.terminate(nil);return}
        output=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        guard FileManager.default.fileExists(atPath:output.path) else {NSApp.terminate(nil);return}
        let menu=NSMenu(),appItem=NSMenuItem(),editItem=NSMenuItem()
        menu.addItem(appItem);menu.addItem(editItem)
        let appMenu=NSMenu();appMenu.addItem(withTitle:"退出测试窗口",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");appItem.submenu=appMenu
        let editMenu=NSMenu(title:"编辑")
        for (title,action,key) in [("剪切",#selector(NSText.cut(_:)),"x"),("拷贝",#selector(NSText.copy(_:)),"c"),("粘贴",#selector(NSText.paste(_:)),"v"),("全选",#selector(NSText.selectAll(_:)),"a")] {
            editMenu.addItem(withTitle:title,action:action,keyEquivalent:key)
        }
        editItem.submenu=editMenu;NSApp.mainMenu=menu
        window=NSWindow(contentRect:NSRect(x:200,y:100,width:650,height:760),styleMask:[.titled,.closable,.resizable,.miniaturizable],backing:.buffered,defer:false)
        window.title="Enigma 新建原生验收窗口";window.isReleasedWhenClosed=false
        let stack=NSStackView();stack.orientation = .vertical;stack.alignment = .leading;stack.spacing=12;stack.translatesAutoresizingMaskIntoConstraints=false
        window.contentView!.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:window.contentView!.leadingAnchor,constant:24),stack.trailingAnchor.constraint(equalTo:window.contentView!.trailingAnchor,constant:-24),stack.topAnchor.constraint(equalTo:window.contentView!.topAnchor,constant:24)])
        func add(_ view:NSView,_ height:CGFloat?=nil){stack.addArrangedSubview(view);view.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive=true;if let height{view.heightAnchor.constraint(equalToConstant:height).isActive=true}}
        let title=NSTextField(labelWithString:"仅使用此窗口及新建测试文件");title.font = .boldSystemFont(ofSize:20);add(title)
        add(NSTextField(labelWithString:"姓名"));name.placeholderString="填写中文姓名";name.setAccessibilityLabel("原生姓名输入");add(name,30)
        add(NSTextField(labelWithString:"备注（多行）"));note.setAccessibilityLabel("原生备注输入");note.isRichText=false
        note.frame=NSRect(x:0,y:0,width:580,height:100);note.minSize=NSSize(width:0,height:100);note.maxSize=NSSize(width:CGFloat.greatestFiniteMagnitude,height:CGFloat.greatestFiniteMagnitude);note.isVerticallyResizable=true;note.isHorizontallyResizable=false;note.autoresizingMask=[.width];note.textContainer?.widthTracksTextView=true
        let scroll=NSScrollView();scroll.documentView=note;scroll.hasVerticalScroller=true;scroll.borderType = .bezelBorder;add(scroll,100)
        color.addItems(withTitles:["请选择颜色","蓝色","绿色"]);color.setAccessibilityLabel("原生颜色选择");add(color,28);add(confirmed,24)
        let col=NSTableColumn(identifier:NSUserInterfaceItemIdentifier("name"));col.title="双击目标";col.width=560;table.frame=NSRect(x:0,y:0,width:580,height:95);table.addTableColumn(col);table.dataSource=self;table.delegate=self;table.target=self;table.doubleAction=#selector(doubleClick);table.setAccessibilityLabel("原生列表")
        let list=NSScrollView();list.documentView=table;list.hasVerticalScroller=true;add(list,95)
        let card=DragCard(frame:.zero);card.setAccessibilityLabel("原生测试卡片");add(card,45);add(drop,72);drop.onDrop={[weak self] in self?.dragDone=true;self?.status.stringValue="原生拖拽成功"}
        let save=NSButton(title:"保存新建回执",target:self,action:#selector(saveReceipt));save.bezelStyle = .rounded;add(save,32);add(status,24)
        window.center();window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
    }
    func numberOfRows(in tableView:NSTableView)->Int {40}
    func tableView(_ tableView:NSTableView,objectValueFor tableColumn:NSTableColumn?,row:Int)->Any? {"新建测试条目 \(row+1)"}
    @objc func doubleClick(){doubleClicks+=1;status.stringValue="已双击条目 \(table.clickedRow+1)"}
    @objc func saveReceipt(){
        let data:[String:Any]=["name":name.stringValue,"note":note.string,"color":color.titleOfSelectedItem ?? "","confirmed":confirmed.state == .on,"selectedRow":table.selectedRow,"doubleClicks":doubleClicks,"dragDone":dragDone]
        do {let bytes=try JSONSerialization.data(withJSONObject:data,options:[.prettyPrinted,.sortedKeys]);try bytes.write(to:output.appendingPathComponent("native-receipt.json"),options:.atomic);status.stringValue="回执已保存到新建测试目录"}
        catch {status.stringValue="保存失败：\(error.localizedDescription)"}
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
}
let app=LabApplication.shared
app.setActivationPolicy(.regular)
let delegate=NativeFixture();app.delegate=delegate;app.run()

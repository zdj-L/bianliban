# 便利板

一块始终置顶的浮动看板。窗口可以在屏幕上自由拖动、拉大缩小，用来留下文字和图片。数据只在这台电脑上，没有账号，也不会上传。

看板里是已有的卡片，加上一张虚线框，用来写新笔记。点虚线框进入空白编辑页，保存时再起名字。名字留空就叫「文字」加序号，例如文字1、文字2。序号取还没被占用的最小正整数。

每张卡片显示名字，以及缩略后的正文或图片缩略图。卡片正面只有「复制」：文字复制全文，图片复制整张图。要删除需先打开卡片，再确认一次。

工具栏上的「截图」用来框选屏幕。选区会直接成为一张图片卡片，名字是「截图」加序号，不再额外询问。截图时看板和遮罩会先让开，避免挡在选区上。把图片粘贴或拖到看板上，也会变成卡片，未命名时叫「图片」加序号。

## Windows 上运行

需要：

- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 11 一般已经带了）
- Node.js 20 或更新
- Rust stable 1.85 或更新（[rustup](https://rustup.rs/)）
- Visual Studio 生成工具，勾选「使用 C++ 的桌面开发」。打包的 SQLite 和 Tauri 都要 C++ 工具链

在仓库根目录：

```bash
npm install
npm test
npm run tauri dev
```

打包：

```bash
npm run tauri build
```

只检查 Rust 能否编译：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

`npm test` 跑窗口摆放、截图选区和卡片预览。`cargo test` 跑数据库、命名、路径、图片，以及不依赖显示器的截图像素拼接。

窗口没有系统标题栏，始终置顶。拖标题栏或看板空白处可以移动，展开后拖边缘可以改变大小。点「收起」会变成桌面上的「便利」胶囊按钮，再点一下展开。两个状态都会记住位置。要退出程序，在收起后的胶囊上右键点「退出」，或用 Alt+F4，或在任务栏里关掉。


## 版本与发布

当前版本是 **1.0.0**，这是第 1 版。源码仓库：[zdj-L/bianliban](https://github.com/zdj-L/bianliban)。

安装包发布在 [GitHub Releases](https://github.com/zdj-L/bianliban/releases)。请下载对应版本的 Windows 安装包（NSIS `.exe` 或 MSI）。

版本用 Git 标签管理。给一次发布打上 `v*` 标签（例如 `v1.0.0`）并推送到 GitHub 后，GitHub Actions 会在 Windows runner 上执行 `tauri build`，并把安装包附加到同名 Release。Release 标题形如「便利板 v1.0.0」。

本地打包：

```bash
npm install
npm run tauri build
```

产物一般在 `src-tauri/target/release/bundle/` 下的 `nsis/` 和 `msi/` 目录。当前版本未配置代码签名证书，安装时 Windows 可能提示未知发行者，属预期情况。

## 数据放在哪

- Windows：`%APPDATA%\com.bianliban.desktop\`
- Linux：`~/.local/share/com.bianliban.desktop\`（按这个固定路径，不看 `XDG_DATA_HOME`）

目录里有：

- `cards.db`：卡片和上次的窗口位置
- `images/{卡片id}.png`：整张图，存成 PNG，动图只留第一帧
- `images/{卡片id}.thumb.png`：缩略图，最长边 480

`window_state` 表存展开后看板的物理像素 `x`、`y` 和逻辑像素 `width`、`height`，以及是否收起（`collapsed`）和胶囊位置（`chip_x`、`chip_y`）。`cards` 表仍是 id、kind、title、body、image_file、thumb_file、zone、sort_order、created_at、updated_at。新卡片的 zone 固定写成 `inbox`，列表只按 sort_order 排。第一版留下的 `settings` 表不再读取。

如果这台电脑上已经有第一版的数据库，打开时不会清空。原来钉在「常用」里的卡片会排到「收件」前面，然后合成一个列表。没有名字的旧卡片显示为「未命名」，直到自己改名。

前端只发命令和搬窗口。数据库、自动命名和图片文件名由 Rust 决定。窗口是否还落在某块屏幕上，由前端的几何模块判断。

## 截图

点「截图」后，看板先隐藏，每块屏幕盖一层遮罩。按住拖出区域，松开后遮罩也隐藏，再抓取这块物理像素。小于 8 物理像素的拖动不算选区。Esc、右键或「取消」会回到看板，不新增卡片。

Windows 是主要目标。Linux 需要可用的 X11 会话（`DISPLAY` 已设置）。没有显示器、或在 Wayland 上，截图命令会失败，看板仍会回来，状态行写出原因。选区如何从多块屏幕的位图里裁出来，有不依赖显示器的单元测试。

## 和交互对齐时做的取舍

- 拖动过程中窗口跟着走；靠近屏幕边缘松开时会吸附成贴边标签，点标签仍可展开。
- 展开后的默认大小是逻辑像素 336×492，最小 280×360。收起后的胶囊窗口是 120×64。没有记住的位置，或记住的窗口完全离开所有屏幕时，展开的看板放到主屏工作区中央。工作区比默认高度矮时，默认高度缩小到放得下，但不小于最小高度。上一版留下的 420×640 默认尺寸会改成新的默认大小；如果窗口还停在旧的默认中央，也会重新居中。
- 按下标题栏、编辑页标题或看板空白处可以拖。卡片、按钮、输入框和图片不触发拖动。
- 保存新笔记才出现命名框。留空使用「文字」加下一个空号。粘贴、拖入的图片用「图片」，截图用「截图」，这两类不弹命名框。
- 改名时如果把名字清空，文字回到「文字」序号；原本叫「截图N」的图仍用「截图」序号，其他图片用「图片」序号。
- 正文去掉首尾空白后不能为空，最长 20 万字。名称最长 200 字。
- 复制文字只写正文。复制图片把整张 PNG 写进剪贴板。
- 拖进来的路径来自 Tauri 的拖放事件。后端把字节复制进 `images/`，不沿用原来的路径。接受 png、jpeg、gif、webp、bmp，单张最大 20MB，边长不超过 8000。
- 系统粘贴：Windows 和 Linux 是 Ctrl+V，macOS 同时认 Cmd+V。编辑页里如果剪贴板是图片，会新增图片卡片；如果是文字，就插到光标处。看板上的粘贴只接收图片。

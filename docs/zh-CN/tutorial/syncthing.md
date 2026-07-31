# 跨设备同步配置教程（Syncthing）

JimBDHub 的数据默认只保存在本机。如果你希望在家里的电脑、手机等多台设备之间自动同步数据，可以借助 [Syncthing](https://syncthing.net) 这款开源软件：它不会经过任何中转服务器，数据直接在设备之间点对点传输。

## 同步原理

JimBDHub 不直接"连接"Syncthing，而是采用"万物皆文件"的方式：

1. 本机数据有任何变动时，JimBDHub 会自动把**完整数据**写入一个同步文件（`JimBDHub.sync.json`）。
2. Syncthing 负责把这个文件同步到你的其它设备。
3. 其它设备上的 JimBDHub 检测到文件变化后，自动导入数据并覆盖本地。

所以你要做的只有两件事：**把同步文件所在的文件夹交给 Syncthing 共享**，以及**在两台设备的 JimBDHub 里打开同步开关**。

## 一、下载与安装 Syncthing

Syncthing 在 Windows / GNU/Linux / Android 等平台都有客户端：

- **官网**：<https://syncthing.net>（下载页：<https://syncthing.net/downloads/>）
- **Windows**：在官网下载 Windows 压缩包，解压后运行 `syncthing.exe`。首次运行会在托盘区出现图标。
- **GNU/Linux**：优先使用发行版软件源安装，例如：
  - Debian/Ubuntu：`sudo apt install syncthing`
  - Arch Linux：`sudo pacman -S syncthing`
  - 也可以使用官网提供的 AppImage / 二进制包
- **Android**：在应用商店搜索安装 **Syncthing**（或社区维护的 Syncthing-Fork），例如 F-Droid 或 Google Play。

安装并启动后，Syncthing 会提供一个网页管理界面，默认地址为 <http://127.0.0.1:8384>（Android 端直接在 App 内操作，界面逻辑一致）。后续操作都在这个管理界面里进行。

> 需要同步的所有设备都要安装并运行 Syncthing，且最好都能上网（两台设备可通过局域网直连，也可以走中继服务器）。

## 二、在 Syncthing 中配对设备

Syncthing 使用"设备 ID"来识别每台设备，配对步骤如下：

1. 在**设备 A** 的管理界面（右上角"操作"菜单 → "显示 ID"，或主界面顶部）找到本机的设备 ID（一串很长的随机字符）。
2. 在**设备 B** 的管理界面点击 **添加远程设备**，粘贴设备 A 的设备 ID，给它起个名字，保存。
3. 反过来，在**设备 A** 上重复同样的操作，添加设备 B 的设备 ID。
4. 两台设备互相添加后，会提示"该设备已尝试连接"，确认接受，之后两端的设备列表里彼此会显示为已连接（绿色圆点）。

## 三、在 Syncthing 中创建共享文件夹

配对完成后，需要创建一个"共享文件夹"，让两台设备交换同一个文件：

1. 在**设备 A** 的管理界面点击 **添加文件夹**：
   - **文件夹 ID**：填写一个标识，例如 `jimbdhub-sync`。**两台设备上必须填完全相同**（Syncthing 靠它识别是同一个文件夹）。
   - **文件夹路径**：设备 A 上用于存放同步文件的目录（路径可以任意，见下文"第四步"的说明）。
   - 保存。
2. 在**设备 B** 上同样点击 **添加文件夹**：
   - **文件夹 ID**：填一模一样的 `jimbdhub-sync`。
   - **文件夹路径**：设备 B 上的另一个目录。
   - 保存。Syncthing 会询问是否共享给设备 A，选择"共享"即可。
3. 等待两台设备完成首次扫描与同步（文件夹旁边会出现进度指示）。

至此 Syncthing 部分配置完成，接下来让 JimBDHub 把数据写进这个文件夹。

## 四、在 JimBDHub 中启用同步

### 桌面端（Windows / GNU/Linux）

桌面端启用同步后，JimBDHub 会自动把数据写入固定路径：`~/.JimBDHub/sync/JimBDHub.sync.json`（`~` 即你的用户主目录，注意 `.JimBDHub` 是隐藏文件夹）。

两种做法任选其一：

1. 先启用同步，再在 Syncthing 中添加文件夹：
   - 打开 JimBDHub → **设置 → Syncthing 同步**，打开"启用 Syncthing 同步"开关。
   - 回到 Syncthing 管理界面 → 添加文件夹，文件夹 ID 填 `jimbdhub-sync`，文件夹路径填 `~/.JimBDHub/sync` 对应的完整路径（例如 Linux 下为 `/home/你的用户名/.JimBDHub/sync`，Windows 下为 `C:\Users\你的用户名\.JimBDHub\sync`）。
2. 或者先建好共享文件夹，再启用同步（顺序不影响结果）。

启用成功后，JimBDHub 设置页会显示同步文件路径，并在每次数据变化时自动写入该文件。

### Android 端

1. 在 Syncthing（Android 应用）中按第三步创建一个共享文件夹，记下它的**路径**（例如 `/Syncthing/jimbdhub`）。
2. 打开 JimBDHub → **设置 → Syncthing 同步**，打开开关。
3. 此时会弹出系统文件夹选择器，请选择第 1 步创建的共享文件夹。
4. JimBDHub 会在该文件夹中自动创建 `JimBDHub.sync.json` 并开始同步。如果之后想更换文件夹，先关闭开关再重新打开即可重新选择。

### 所有设备

在每台需要同步的设备上，按平台对应步骤启用同步即可。注意：**每台设备上 JimBDHub 写入的必须是同一个共享文件夹**（文件夹 ID 相同），这样 Syncthing 才能把文件互相传过去。

## 五、验证与注意事项

- 两台设备都需保持 Syncthing 运行，JimBDHub 才能感知到对方的改动；同步有约 1~3 秒的延迟。
- 首次配置建议先执行一次 **设置 → 数据备份** 导出备份，以防误操作。
- 建议在配置同步前，先让某一台设备产生一份数据并完成首次同步，再开启另一台设备的同步，避免方向搞反。
- 避免同时大量修改两台设备的数据；同步文件里保存的是"最近一份完整数据"，如果 Syncthing 检测到版本冲突，会保留 `.sync-conflict` 后缀的冲突文件，可以自行对比处理。
- 同步仅用于多设备备份/迁移，如果想长期保存历史数据，仍建议定期手动导出备份。

## 更多资料

- Syncthing 官方文档：<https://docs.syncthing.net>
- 问题反馈（JimBDHub 相关）：QQ 群 `181336946` / [GitHub Issues](https://github.com/Jimmy32767255/JimBDHub/issues) / <jimmy32767255@outlook.com>

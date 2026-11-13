# mc-ohos-resources

AMCL 的 HarmonyOS NEXT OpenJDK 运行包、签名目录和来源记录。目标为 OHOS / aarch64 / musl，由 AMCL 的适配层加载。桌面窗口、硬件 Java Sound 与沙箱外部进程能力存在明确边界，不能宣称与桌面 JDK 的全部功能完全等价。

新版运行包集中在 [统一资产池](https://github.com/LZZLHY/mc-ohos-resources/releases/tag/ohos-runtimes)，每个 JDK 仍是独立 ZIP。旧 Release、文件名和 Gitee 分卷保留，兼容旧 AMCL 下载方式。

当前稳定目录 revision 6 提供 JDK8/17/25 的 `jdk<major>-ohos-20261027-code1` 与 JDK21 的 `jdk21-ohos-20261027-code2`，每份都有运行 ZIP 和冻结源码输入 ZIP。新包需要真实 host 2 支持；旧 App 拒绝不兼容的新推荐。App 1.0.7 的正式侧载候选尚在验收，本次没有公开 App 原件或切换 App 推荐。验收范围、公开回读与来源见 [本批发行记录](qualifications/jdk-code-20261114-publication.json)。

上一轮四代预览修复批次为 JDK8/17/21/25 的 `jdk<major>-ohos-20261022-repair12`（R12），历史原件继续保留。每代均提供独立完整运行包、冻结源码输入包和来源收据；包含应用 C++/展开器、TLS/装载生命周期、进程、字体与 JavaSound 修复，并修复原生临时目录、真实 UID 的 PerfData 命名及正常 VM 退出后的 Attach socket / PerfData 路径清理。

四份 R12 已在 API26 MRDI-W10 平板通过按精确包身份记录的基础/扩展 Java、字体、进程内工具、固定子进程命令、TCP/TLS/JFR、只读 Attach、jvmstat 共享计数与双 VM 退出清理。手机、游戏及性能、独立 CLI/JLI、真实外设 I/O、最低 API 和 desktop 尚未取得完整资格；当前仍为预览，不能据此宣称完整设备矩阵或全部 JDK 功能通过。

2026-11-11/12 对另外四份未发布的 `20261027-code` 候选补齐了同台平板的指定 Minecraft／模组新世界、保存、冷启动读档与菜单退出证据，共八次正常会话；JDK 始终保持稳定通道。该结果不移贴到 R12，也不等于完整正式发行资格。准确原件、模组依赖更正、兼容残项及 App/JDK 联合发布阻碍见 [平板游戏资格报告](docs/tablet-jdk-games-2026-11-11.md)。公开目录和推荐未变。

2026-11-13 按维护者本次确定的原版发行标准，四份 `20261027-code` 候选完成同台平板的五个原版、十次独立会话验收，并取得**记录内范围的稳定发行资格**。本地联合发布准备已核完 26 个运行包／源码包，生成未签名的同批 v1/v2 载荷；尚未上传、签名、切换推荐或发布 App。具体矩阵、不可变摘要、旧端拒绝新协议的证据与后续顺序见 [联合发布准备记录](docs/joint-release-preparation-2026-11-13.md) 和 [资格原始记录](qualifications/jdk-code-20261113-vanilla-release.json)。该资格不包含其他设备、最低 API、全部整合包或最终公开 HAP。

较早的 JDK17 + 新 HAP + Minecraft 1.20.1 + Immersive Melodies 曾收到用户通过反馈，但缺少对应精确设备日志与包摘要；这是历史反馈，不作为 R12 或全部设备/模组的验收。早期 JDK8 的完整重建、打包审计、宿主 MIDI/WAV/音序及 ARM64 Platform 叶函数验证也保留原范围。

**历史记录（2026-10-06）**：JDK8 `8-runtime-link-rc1` 预览修复了 JFR BitSet 缺少分配器模板定义引起的 JVM 装载失败。它使用新的不可变文件名、完整来源和启动根强符号审计；当时其他 JDK 推荐不变。该包与旧下载入口继续保留，当前推荐和验收状态以签名目录及对应来源记录为准。

该历史包的手机验证通过正常更新安装，真实 JVM 创建成功，目标 1.7.10 整合包进入 Forge/世界加载；后续 gl4es 绘制发生原生崩溃，因此当时仍保留 preview，不能声称该整合包或完整设备矩阵已通过。这不是 R12 的手机游戏验证记录。

## 使用目录

- [catalog/source.json](catalog/source.json)：唯一手工目录源，维护稳定/预览推荐、完整包与分卷 SHA-256、大小、URL、能力和验收证据。
- [v2 稳定目录](catalog/v2/stable.json)、[v2 预览目录](catalog/v2/preview.json)：标准 JWS JSON，固定 ES256/P-256 公钥验签；[v1 稳定兼容投影](catalog/v1/stable.json) 与 [v1 预览兼容投影](catalog/v1/preview.json) 来自同一批源，不伪造旧宿主支持。
- [可信公钥](catalog/trusted-keys.json)：只有公开验签键，私钥不在仓库或 Web 服务器。
- [来源记录](provenance/)：源码构建收据与配方/补丁源码输入包索引。
- [网页运行时列表](https://amcl.lovedhy.cn/runtimes)：消费同一签名目录，不另维护版本表。

第一次目录化需要新 HAP；以后在已有平台、布局和 loader 协议内更新或新增主版本，可只新增运行包并更新 JSON。真正新的 CPU/libc/原生装载能力仍需应用适配。增加镜像不会制造重复 JDK 更新提示。

R12 需要 `loaderProtocol 2` 宿主，包含本批装载/生命周期修复和正常 HAP 提供的 typed 音频回调；旧协议1宿主会拒绝下载这些新推荐。旧 stable 推荐继续保留协议1，不能通过降低 R12 的协议要求来兼容旧宿主。

应用默认使用既有 GitHub/Gitee 路径，自有服务器 JDK 来源**默认关闭**；启用后才参与目录、测速或包下载。用户导入项不会自动接管，必须明确选择“改用官方”。离线或下架不删除可用安装。

## 构建、验收与维护

标准构建使用主工程 docker/project.py / launch-builder.ps1，Compose 项目固定 amcl，复用 builder 和 qa。legacy-* 只作只读历史调查，不能再以 docker exec ohos-debug 作为日常构建步骤。

JDK8 使用经典 jre/lib/aarch64 / rt.jar 布局，17/21/25 使用模块化布局。打包器分别校验核心类/模块、架构、关键库、依赖和音频入口，再核对 ZIP 读回。JDK8 的全局 polling 安全点没有机械套用现代握手补丁。

R12 已实现 JavaSound 的 OHAudio PCM 播放/录音与播放时间线，保留软件 MIDI、音序器及 WAV 解析；Native MIDI 为 API24 起的可选动态后端，设备 Ports 按系统能力枚举，不将 renderer 局部音量冒充系统 Mixer Control。录音仍需麦克风授权，MIDI 外设收发、路由/焦点及完整硬件质量需分别验收；API24 可选 MIDI 不提高整个运行包的最低 API20 声明。Minecraft 常规声音继续通过 OpenAL/OHAudio。

API26 首台平板的 FAST 48 kHz 录音首段满幅已在 JDK 首次执行前复现。具体 Native 平台原因尚未确定，信号质量未取得资格；本批未用丢帧、静音或关闭 FAST 掩盖该现象，也不把它写成已修复。

维护、签名、单版本更新、统一池和回滚见 [发布操作规范](docs/publishing.md)。宿主验证与设备矩阵分开记录，稳定推荐晋级须有对应证据。旧资产摘要只用于兼容冻结，不再要求每次包更新都修改 HAP 常量。

## 许可

OpenJDK：GPLv2 with Classpath Exception，运行包保留许可文件；配套输入包提供本项目修改与重建配方。FreeType 随上游许可。OHOS SDK 与宿主工具链作为外部构建前提单独登记。

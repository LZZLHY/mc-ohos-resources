# mc-ohos-resources

AMCL 的 HarmonyOS NEXT OpenJDK 运行包、签名目录和来源记录。目标为 OHOS / aarch64 / musl，由 AMCL 的适配层加载。桌面窗口、硬件 Java Sound 与沙箱外部进程能力存在明确边界，不能宣称与桌面 JDK 的全部功能完全等价。

新版运行包集中在 [统一资产池](https://github.com/LZZLHY/mc-ohos-resources/releases/tag/ohos-runtimes)，每个 JDK 仍是独立 ZIP。旧 Release、文件名和 Gitee 分卷保留，兼容旧 AMCL 下载方式。

当前新构建进入**预览通道**。JDK17 + 新 HAP + Minecraft 1.20.1 + Immersive Melodies 已收到用户通过反馈；没有对应精确设备日志和包摘要，不能推广为全部设备或模组通过。JDK8 已补齐完整重建、打包审计、宿主 MIDI/WAV/音序测试与实际 ARM64 Platform 叶函数验证，仍待 OHOS 真机回归。

## 使用目录

- [catalog/source.json](catalog/source.json)：唯一手工目录源，维护稳定/预览推荐、完整包与分卷 SHA-256、大小、URL、能力和验收证据。
- [稳定目录](catalog/v1/stable.json)、[预览目录](catalog/v1/preview.json)：标准 JWS JSON，固定 ES256/P-256 公钥验签。
- [可信公钥](catalog/trusted-keys.json)：只有公开验签键，私钥不在仓库或 Web 服务器。
- [来源记录](provenance/)：源码构建收据与配方/补丁源码输入包索引。
- [网页运行时列表](https://amcl.lovedhy.cn/runtimes)：消费同一签名目录，不另维护版本表。

第一次目录化需要新 HAP；以后在已有平台、布局和 loader 协议内更新或新增主版本，可只新增运行包并更新 JSON。真正新的 CPU/libc/原生装载能力仍需应用适配。增加镜像不会制造重复 JDK 更新提示。

应用默认使用既有 GitHub/Gitee 路径，自有服务器 JDK 来源**默认关闭**；启用后才参与目录、测速或包下载。用户导入项不会自动接管，必须明确选择“改用官方”。离线或下架不删除可用安装。

## 构建、验收与维护

标准构建使用主工程 docker/project.py / launch-builder.ps1，Compose 项目固定 amcl，复用 builder 和 qa。legacy-* 只作只读历史调查，不能再以 docker exec ohos-debug 作为日常构建步骤。

JDK8 使用经典 jre/lib/aarch64 / rt.jar 布局，17/21/25 使用模块化布局。打包器分别校验核心类/模块、架构、关键库、依赖和音频入口，再核对 ZIP 读回。JDK8 的全局 polling 安全点没有机械套用现代握手补丁。

新包将不可用的硬件 MIDI/PCM/混音器入口安全降级，保留软件 MIDI、音序器和 WAV 解析。Minecraft 常规声音通过 OpenAL/OHAudio；软件音序器可产生事件不代表设备有硬件 MIDI 输出。

维护、签名、单版本更新、统一池和回滚见 [发布操作规范](docs/publishing.md)。宿主验证与设备矩阵分开记录，稳定推荐晋级须有对应证据。旧资产摘要只用于兼容冻结，不再要求每次包更新都修改 HAP 常量。

## 许可

OpenJDK：GPLv2 with Classpath Exception，运行包保留许可文件；配套输入包提供本项目修改与重建配方。FreeType 随上游许可。OHOS SDK 与宿主工具链作为外部构建前提单独登记。

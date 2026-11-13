用于新版 AMCL JSON 目录的统一运行时资产池。每个 JDK 仍为独立压缩包，文件只追加，不覆盖旧资产。

2026-11-14：以下四套正式运行时及对应源码输入包首次进入稳定目录 revision 6；当前 revision 7 保留全部相同原件，并恢复旧客户端的兼容下载入口：

- JDK8：`jdk8-ohos-20261027-code1`
- JDK17：`jdk17-ohos-20261027-code1`
- JDK21：`jdk21-ohos-20261027-code2`
- JDK25：`jdk25-ohos-20261027-code1`

新运行时需要支持 host 2 的 AMCL。App 1.0.7 正式侧载包目前处于验收阶段，尚未公开；旧 App 会拒绝不兼容的新推荐。该 Release 是跨批次资产池，其页面标签不代表每个 JDK 的稳定/预览通道；实际推荐、SHA-256 与资格以同批 v1/v2 签名目录及来源记录为准。

revision 7 的 v1 投影继续为原版 AMCL 1.0.6 提供四个 host1 旧正式包，v2 则优先推荐上列新包。已在 MRDI-W10/API26 上用精确 1.0.6 清装后，通过正常稳定通道页面下载四个旧包，逐槽核对收据和实际 libjvm 字节；没有手工导入 JDK 或收据。新 App 根据包内目录协议、宿主 ABI 和 ZIP/JAR 修复能力选择新包，不把旧包重新标记为具备新修复。见 `qualifications/jdk-code-20261114-continuity.json`。

本批按维护者确定的原版标准，通过 MRDI-W10/API26 上 Minecraft 1.12.2、1.16.5、1.20.1、1.21.4、26.3 的运行、保存、退出和冷读档。该范围不代表全部设备、Java SE 功能或整合包通过；Prominence 等残项继续保留，Distant Horizons 暂不列入适配清单。详见仓库 `qualifications/jdk-code-20261113-vanilla-release.json`。

Stable catalog revision 7 preserves the JDK 8/17/21/25 runtime and source-input archives first published in revision 6. Its v1 projection retains compatible legacy downloads for AMCL 1.0.6, while v2 prefers the new host-protocol-2 runtimes. All four legacy packages were downloaded through the normal stable UI on an exact 1.0.6 installation, with receipts and installed libjvm bytes verified. The final AMCL 1.0.7 sideload app is still being validated and has not been published. Runtime qualification remains limited to the recorded vanilla Minecraft matrix on the MRDI-W10/API26 tablet; it does not certify every device, Java SE feature or modpack. Channel status comes from the signed catalogs, not the label of this shared asset-pool release.

旧版 AMCL 使用的历史 Release、文件名和分卷继续保留。包更新、通道推荐和镜像维护步骤见仓库 README。

2026-10-06：新增 JDK8 `8-runtime-link-rc1` 预览包及对应源码输入包。补齐 HotSpot JFR BitSet 的分配器模板定义，修复创建 JVM 前的必需符号装载失败；完整干净构建、启动依赖强符号审核、ZIP 读回和 Java Sound 宿主/实际 AArch64 叶函数检查通过。真机矩阵尚在验证，其他 JDK 推荐保持原代次。

The JDK 8 `8-runtime-link-rc1` preview fixes a missing HotSpot allocator template definition that prevented JVM loading. The complete clean build, required-symbol audit, archive verification, and Java Sound host and AArch64 leaf checks passed. Existing assets and other JDK recommendations are preserved.

手机通过正常JDK更新安装了同一制品，JNI_CreateJavaVM返回0，JVM初始化164ms，目标1.7.10整合包进入Forge与世界加载。之后在Angelica/Sodium→LWJGL2→gl4es多重绘制路径发生原生崩溃；不将其记为整包通过。该包保持预览，完整设备/游戏矩阵仍待闭合。

The matching artifact was installed through the normal device updater. JVM creation succeeded in 164 ms and the target 1.7.10 pack reached Forge and world loading. A later native crash occurred in the Angelica/Sodium, LWJGL 2, and gl4es draw path. The pack has not passed full gameplay validation, and the runtime remains in preview.

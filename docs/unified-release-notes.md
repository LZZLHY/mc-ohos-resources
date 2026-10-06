用于新版 AMCL JSON 目录的统一运行时资产池。每个 JDK 仍为独立压缩包，文件只追加，不覆盖旧资产。

当前新构建在预览通道提供；验收范围与 SHA-256 以仓库签名目录及来源清单为准。JDK17 的目标模组场景已收到用户通过反馈，不能据此宣称全部设备或模组均通过。

旧版 AMCL 使用的历史 Release、文件名和分卷继续保留。包更新、通道推荐和镜像维护步骤见仓库 README。

2026-10-06：新增 JDK8 `8-runtime-link-rc1` 预览包及对应源码输入包。补齐 HotSpot JFR BitSet 的分配器模板定义，修复创建 JVM 前的必需符号装载失败；完整干净构建、启动依赖强符号审核、ZIP 读回和 Java Sound 宿主/实际 AArch64 叶函数检查通过。真机矩阵尚在验证，其他 JDK 推荐保持原代次。

The JDK 8 `8-runtime-link-rc1` preview fixes a missing HotSpot allocator template definition that prevented JVM loading. The complete clean build, required-symbol audit, archive verification, and Java Sound host and AArch64 leaf checks passed. Existing assets and other JDK recommendations are preserved.

手机通过正常JDK更新安装了同一制品，JNI_CreateJavaVM返回0，JVM初始化164ms，目标1.7.10整合包进入Forge与世界加载。之后在Angelica/Sodium→LWJGL2→gl4es多重绘制路径发生原生崩溃；不将其记为整包通过。该包保持预览，完整设备/游戏矩阵仍待闭合。

The matching artifact was installed through the normal device updater. JVM creation succeeded in 164 ms and the target 1.7.10 pack reached Forge and world loading. A later native crash occurred in the Angelica/Sodium, LWJGL 2, and gl4es draw path. The pack has not passed full gameplay validation, and the runtime remains in preview.

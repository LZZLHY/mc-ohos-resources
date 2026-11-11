# 四代 JDK 平板游戏与联合发布资格核验

记录时间：2026-11-12 00:04:47，Asia/Shanghai（系统实取）。测试执行时间为
2026-11-11 22:03:55 至 2026-11-12 00:03:38；具体动作与会话以原始收据时间为准。

## 结论与适用范围

四份精确候选在 MRDI-W10／API26／OpenHarmony-7.0.0.111 上，完成了各自指定的
Minecraft／模组新世界运行、保存、独立游戏 JVM 冷启动读档和菜单正常退出，共八次
正常会话。JDK 通道始终保持 stable。JDK25 首次选入的模组组合有依赖冲突，保留该
失败现场；更正 Fabric API 后使用另一个隔离实例完成两次正常会话。

**这是单台设备的具名场景证据，四份包尚未获得完整正式发行资格。** 本轮没有修改
运行 ZIP、应用源码、签名目录、公开推荐或生产信任根，也没有发布、上传或推送。
没有把 `artifact-audited` 手改成 `device-matrix-tested`。

本次实装仍为 `default/debug` 的 `1.0.7-pre1 / 1000910`：

- sourceRevision：`4d5046e202712af04baf98631700f0dcdadb0cf9`；它已进入主线
  `54e81546e12381e092e4234946b5b607488bc8b4`，后者只补开发日志。
- signed HAP SHA256：`98176d1d4cca26022fddaa3b25ccd874c6066f9ae6a91120dcc0b1bd5b695421`。
- 实际 host protocols `[1,2]`、恢复 reader `2`、所需能力 `zipfs-transaction-v1`、
  majors `[8,17,21,25]`；产品 `publishable=false`。
- 本轮没有重新装机；BMS 的 UID、安装时间、更新时间、版本及 AppId 摘要前后相同。
  游戏始终使用离线测试身份，不构成正版在线、Realms 或多人联机验收。

## 运行时与模组原件

运行包来自既有 `jdk-complete-1026/candidates`，没有重新打包。开始及结束均实取
四个安装收据和设备上的 `libjvm.so` SHA，逐项匹配完整 ZIP 内清单，前后完全一致。
Java 版本还分别从每次实际 JVM 的 `System.getProperty` 观测取得。

| JDK | buildId | 实际 Java 版本 | 完整运行 ZIP SHA256 |
| --- | --- | --- | --- |
| 8 | jdk8-ohos-20261027-code1 | 1.8.0_452-internal | `a50d049bebdbc07c1a678d51cd078e68e6b6b1533035d18693e36d7b493174c5` |
| 17 | jdk17-ohos-20261027-code1 | 17.0.19-internal | `6f8503d4d85c0bc8228b979a6a5827ad8a3960ad0a231384e76531ca0576f6cf` |
| 21 | jdk21-ohos-20261027-code2 | 21.0.5-internal | `a9765c3c8779f696f5d37a112108e3ae760a3b123d781640dcd29126e66c66ce` |
| 25 | jdk25-ohos-20261027-code1 | 25.0.4-internal | `4a80ab45c7ff879d8c80ff5c8179d27a487de688649acd67ccc9e76bd0d857cd` |

每个模组 JAR 均与官方 Modrinth 元数据的大小、SHA1、SHA512 核验，并另外记录 SHA256。
测试通过已有 default/TestHooks 的私有 mrpack 入口执行产品安装器，真实下载／处理
Minecraft 与 loader，并执行文件完整性核验；这不是公开整合包发行。

| JDK | Minecraft / loader | 模组组合 | 安装后完整性核验 |
| --- | --- | --- | --- |
| 8 | 1.12.2 / Forge 14.23.5.2864 | JEI 4.24.0.1042 | 1352 项，缺失／损坏均为空 |
| 17 | 1.20.1 / Forge 47.4.20 | Immersive Melodies 0.8.2+1.20.1 | 3668 项，缺失／损坏均为空 |
| 21 | 1.21.8 / Forge 58.1.18 | Xaero Minimap 25.3.12 + ForgeConfigAPIPort 21.8.2 | 4365 项，缺失／损坏均为空 |
| 25 | 26.1.1 / Fabric Loader 0.19.3 | Sodium 0.8.9 + Fabric API 0.145.4+26.1.1 | 4798 项，缺失／损坏均为空 |

25 的第一份夹具使用已有的 Fabric API 0.144.4+26.1，但 Sodium 的准确
`fabric.mod.json` 声明 `breaks fabric-api <0.145.1`，Fabric 因此请求退出 1。
失败活动 `1794411904480` 没有改写为成功。更正使用官方版本 `E1uEPd5j`，API JAR
SHA256 为 `e4f2cb1d89efb61896eb407c3c02a46d4931e5aad64350e2d8ba2981e3f95a79`；
新建 `AMCL-QA-jdk25-games-1111-r2`，保持 App、JDK 和启动策略原件不变。

17 的安装还出现过 DNS／镜像冷却导致的两项依赖获取失败；产品正常重试后下载完成，
六个 Forge processor 均正常结束。该失败发生在游戏 JVM 启动前，不归为 JDK 崩溃。

## 实际操作及退出证据

四套均新建创造模式普通地形世界，随后从标题页退出，再从 AMCL 重新启动到新的独立
游戏进程，进入同一存档。以下不是仅启动标题页的冒烟测试。

| JDK | 实际模组／运行操作 | 冷启动后观察 | 首轮／重载活动 ID |
| --- | --- | --- | --- |
| 8 | 森林世界移动、转向，打开 JEI 物品与配方界面 | 同一存档和位置可继续使用 | 1794407668005 / 1794408498143 |
| 17 | 世界运行、取得鲁特琴，打开曲目菜单，选 `1st turks march` 并操作播放／暂停 | 同一存档，鲁特琴仍在手中及快捷栏 | 1794408762695 / 1794410304828 |
| 21 | 世界移动、转向，小地图显示地形／实体，打开设置及路径点页，将小地图改为圆形 | 同一位置与圆形小地图设置保留 | 1794410704916 / 1794411725870 |
| 25 | 沙漠世界移动、转向，F3 确认 Sodium renderer，打开设置，关闭 VSync 并 Apply，继续游戏 | 同一存档与 VSync 关闭状态保留 | 1794412211660 / 1794412528720 |

八次正常会话均通过游戏内“保存并退回标题屏幕”，再点击“退出游戏”。账本有世界保存、
server/client 停止记录，JVM 请求退出码为 0，HDC 进程列表证明对应游戏进程已经消失。
**这不是独立的操作系统 wait 退出状态证明**，也没有通过强杀游戏获得“成功”。最后主
应用 PID 44514 保留，没有游戏进程；采集器正常关闭，无 64 MiB 截断记录。

JDK25 实际最终参数继续包含：

```text
-XX:CompileCommand=exclude,java/util/concurrent/CompletableFuture.*
```

Native 日志的 `broad=1` 和 JVM 的 `exclude=true` 回显共同证明该项生效。本轮只能
认定带现有兼容项的组合通过，不能宣布已解除 CompletableFuture 的广泛编译排除。

F3 的帧率只是截图时刻，未做持续帧时间、温度、功耗、大整合包或长时间压力对照。
21 没有创建命名路径点，不能把圆形设置持久化写成路径点持久化通过。

## 留存的兼容问题与未验收能力

1. **现代 LWJGL 外部 provider 的交付元数据未闭合。** 准确 HAP 中 GLFW／OpenAL
   JAR 仍带上游 Linux ARM64 native SHA1，实际 HAP 的 OHOS provider 摘要不同。
   现有 finalize 覆盖的八个生成 JNI 模块均匹配；问题集中在未纳入该重绑流程的外部
   provider。两条通用 `Incompatible Java and native library versions detected`
   与 `Library.checkHash` 路径相符，但日志没有逐条模块／调用栈，顺序归属保留为推断。
   应按最终产品 HAP 字节补齐 provider 身份与验证，不通过禁用检查或删掉所有 hash
   资源消音。这是 App 交付一致性待修项，不是已证明的 JDK21／25 崩溃。
2. **JDK8 图形／JEI 告警未完全定位。** GL1282 首轮三次、重载四次，不能只称首帧
   残留。准确 JEI JAR 的 RecipesGui 几何校验可能返回 null 并记 ERROR，当前没有坏
   字段具体值。已测配方、世界和保存通过，不能据此宣称所有图形／GUI 路径合格。
3. **17 的可听演奏质量未验收。** 准确模组源码和字节码证明 MIDI 用于解析／输入扫描，
   曲目声音走自有音符对象 → Minecraft SoundManager → OpenAL/OHAudio。系统音频
   流在演奏前已经存在，非零样本不能独立归因于指定曲目。UI、资源、软件 MIDI 设备
   初始化与保存通过，不授予 Synthesizer、独立 JavaSound PCM、硬件 MIDI 或人工听音资格。
4. **其他真实边界保留。** Xaero 及其内嵌库的六份 mixin 配置引用包内缺失 refmap；
   当前小地图操作可用不覆盖所有 mixin 路径。现代游戏的 libflite 旁白缺库、硬件探测／
   `/proc/stat` 访问限制、离线 401／Realms 和外部版本查询超时分别归类。Sodium
   启用 `NO_ERROR_CONTEXT_UNSUPPORTED` 保护。本轮没有把这些日志统一列为无害噪声。

## 联合发布门禁复核

2026-11-11 22:30:02（Asia/Shanghai）实际只读回取官网事实：sideload 稳定 App 为
1.0.6，host `[1]`、reader `0`；公开历史覆盖完整，包含 1.0.5／1.0.6。
desktop 当前没有稳定头，不推断为可直接发 desktop preview。
v1 stable／preview 均为 revision 4，固定生产公钥验签通过；v2 双通道均返回 404。

使用当前生产纯门禁和真实 HAP／线上原件运行，结果如下：

| 检查 | 实际结果 |
| --- | --- |
| 本批候选晋级 stable | 拒绝：`stable promotion requires device matrix: jdk8-ohos-20261027-code1` |
| 新 App 被真实线上稳定运行时覆盖 | 拒绝：`APP_STABLE_RUNTIME_PAIR_REQUIRED` |
| 当前测试 HAP 的稳定离线引导目录 | 拒绝：`HAP runtime bootstrap must use v2` |
| 四代新候选的公开宿主状态 | 均为 `waiting-host`，没有伪造已发布协议2 App |
| 当前 reader2 预览包的稳定返回读取能力 | 不满足：线上 stable reader0，不能覆盖 reader2 |

00:00:59 的实际 JDK 页面仍为“JDK · 稳定通道”，四槽“已安装”。刷新真实目录后
明确提示没有本应用需要的兼容修复包，不会重复拉取不兼容旧包。已安装的新四槽可用，
**真实公网重新下载尚未就绪**；不能把前轮私有夹具的下载验收冒称为线上正式供给。

前轮全新安装、官方 1.0.6 旧四槽覆盖升级、四槽稳定修复及 ZIPFS 证据仍保留原候选／
HAP 绑定，本轮不把它们改贴到其他产物。发布 `sideload`／其他实际产品前，须用最终
原件再完成适用成品门及安装／升级组合验收；default 成功不能代替公开产品资格。

## 后续放行顺序与明确阻碍

以下是待获发布授权后的依赖顺序，本轮没有执行公开步骤：

1. 先闭合目标发行设备／API 矩阵和上述交付问题。当前只覆盖 API26 平板，不能代表
   最低 API20、手机或其他声明范围。 optional 音频／CLI 等能力按实际承诺分别给资格，
   不能因为启动 Minecraft 成功就把全部 Java SE、外设和性能写成 PASS。
2. 冻结四份 JDK 的完整运行／源码／SDK 来源和准确资格记录，完成不可变资产的完整
   远端读回。用真实公开宿主历史生成同批 stable／preview 的 v1/v2 签名目录；允许
   符合条件的新宿主依赖为 `waiting-host`，不能把新包降为协议1。
3. 按 [发布操作规范](publishing.md#稳定运行时与app双向准入2026-11-11) 部署具备
   双向覆盖与互斥保护的服务，先真实 v1＋同批 receipt，再同批 v2，核所有公开下载源。
   保留历史资产与旧端拒绝新协议包的行为。旧版手动导入不能由目录远程补丁修复。
4. 将同批正式稳定目录导出进实际 App 的 v2 离线引导，冻结并构建实际公开产品原件，
   完成成品／签名／设备验收。离线构建可以在目录公开前准备，但 App 对外推荐必须等
   真实稳定供给通过反向覆盖门。
5. 先交付具备 `[1,2]` 和 reader2 的稳定 App，核实际公开头和历史；再安排其能覆盖的
   预览版。当前 1.0.6 reader0 下，不能直接强行公开现有 1.0.7-pre1。
   正式桥接版及之后 preview 的版本／code 在获授权时按实际发行序列核定，本轮不升码。
6. 发布当轮重新执行联合门、完整资产回读、离线引导核验，以及保持 JDK stable 的
   全新安装／覆盖升级／修复／重新下载。每个实际产品分别验证，不用本轮 default 收据替代。

仍阻止放行的具体事项是：四套完整矩阵资格未取得；现代 provider 交付一致性尚未修复
并重验；公开新运行时原件和同批签名 v1/v2 尚未就绪；实际公开产品 App 的 v2 引导与
成品资格尚未形成；公开 stable 的 host／reader 返回能力不足。JDK8 图形／JEI 残项及
音频等未验能力应在放行前逐项定位、限定支持范围或补验，不能由一个布尔标志消除。

旧发布 skill 中“先公开 App，再激活依赖新宿主 JDK”的绝对顺序与当前双向门会构成循环。
本规范的同批 JDK `waiting-host` → 稳定供给 → App 反向门是本次代码已实现的顺序；
正式执行前还须对齐维护者发布 SOP，不能照旧描述绕过任一门。

## 原始证据与恢复入口

维护工作区证据根：`D:/dhao1/desktop/AMCL/.workspace/run/jdk-games-1111/`。
公开克隆只包含本报告；本机绝对路径不是公开下载地址。

- `qualification.json`：八次正常会话、失败更正、精确原件和边界。
  SHA256 `0d37310bd6d8ad04454db79dba1ad5c2b2ad20170ad5c6622f80063f41ca6d65`。
- `evidence-index.json`：698 份证据的逐文件大小／摘要。
  SHA256 `70e2d97db8139795747fc2ba3ba0cefbfe95536db9fb45383e64565028670189`。
- `games/<case>/ledger-final/` 与截图：真实游戏账本、JVM 请求、世界保存和模组操作。
- `runtime-identities{,-final}/`：两次四槽安装收据与实际 libjvm 摘要。
- `matrix-inputs.json`、`matrix-inputs-r2.json`、`mod-inputs/`、`install-observations/`：
  原始／更正输入、官方摘要、真实安装任务及完整性结果。
- `diagnosis-network/`、`diagnosis-melodies/`、`diagnosis-legacy8/`、`diagnosis-modern/`：
  失败分类、准确源码／字节码和 HAP 元数据核查。
- `live-release-audit/gate-results.json`：真实公开事实和生产门拒绝原因。
- `acceptance.json`、`acceptance-record.json`：通过统一设备门登记的具名场景，
  `publicReleaseQualified=false`。
- `game-hilog/receipt.json`、`collector-closure-check.json`、
  `device-matepad-closure-50.json`：采集和设备资源闭环；没有遗留测试游戏进程。

平板保留四套新 JDK 与隔离 QA 存档。游戏数据位置本轮切为外部目录以复用已有库／资源，
没有复制或改写原有游戏实例；另保留一个名称错误的 1.12.2 初始下载实例和 JDK25 首次
依赖冲突实例作为现场，不将其混入通过矩阵。没有写新的恢复协议或升级 App 数据格式。

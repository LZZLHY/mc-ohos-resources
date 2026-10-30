# 目录与资产发布

`catalog/source.json` 是唯一手工维护的运行时目录。`catalog/v1/*.json` 是签名成品，不能手改；应用、网站、自有存储都复制同一来源。`provenance/` 保存构建收据和生成的源码输入包索引。

## 身份规则

- runtimeId 固定主版本、平台和布局；buildId 固定 Java 版本、文件名、大小与 SHA-256。修改包字节使用新 buildId/文件名，不 `--clobber` 旧资产。
- `catalogRevision` 每次目录变化增加；只改变某个 JDK 推荐时只增加该项 `recommendationRevision`。镜像变化不增加推荐代次。
- 撤回将 build 设为 `withdrawn` 并提供其它推荐。回滚指向仍登记的旧 build，但推荐代次继续增加，不能回退 JSON 代次。
- 需要精确回退时，在该通道 recommendations 中增加 `rollback: { "fromBuildIds": ["坏构建ID"], "reason": "已定位的回归与回退原因" }`，生成后位于 runtime.rollback。fromBuildIds 必须属于同一 runtime 且全部标记 withdrawn；两个通道都不能继续推荐撤回构建。修改回退范围/原因也增加 recommendationRevision。撤回 ID 不可复活，修复或更正使用新的 buildId。
- 新平台/adapter 可以进入结构合法的目录，当前不支持的 HAP 不安装。新主版本须经过构建与验收，不能只修改主版本号。
- 预览需要新宿主时，可以仅在该槽的 `recommendations.preview` 覆盖 `loaderProtocol`、`minimumApi`、`minimumCatalogProtocol`。通道不能覆盖 runtime 的平台/布局身份；准入下限改变也必须增加该槽推荐代次。宿主协议尚未取得资格时保持不支持，不因目录准备完成就开启新协议。
- 推荐构建的已验证来源收据含 `0025-ohos-javasound-duplex-host-callbacks.patch` 时，该通道实际投影的 `loaderProtocol` 必须至少为2。共享闭包在上传、签名和激活之前检查这一条件，不能将新宿主回调依赖错误标成旧协议1；只检查通道各自的推荐，旧stable推荐仍可保持1，未推荐的新包不会使stable被迫升级。
- `0026-ohos-javasound-native-midi.patch` 同样依赖正常加载宿主的typed回调，即使单独推荐该实现也必须协议2。该约束不授权旧HAP调用新回调表。
- 稳定通道新源码构建必须达到 `device-matrix-tested`，legacy 为兼容迁移例外。当前新包均在预览通道，用户单场景反馈不能冒充设备矩阵。

## 标准步骤

要求 Node 22+、已登录有写权限的 `gh`、主工程 Docker 构建环境。签名私钥和 HAP 证书分离，由维护者保管，不能上传网页服务器。初次 keygen 只运行一次；信任根轮换需客户端迁移，不能覆盖现用键。

```powershell
# 先完整构建候选与 manifest，再更新 source.json 的相应 build/推荐与真实验收证据。
node tools/catalog.mjs check
node tools/publish.mjs check
node --test tests/*.test.mjs

# assets-map 为仓外“文件名: 本地绝对路径”JSON，含已登记包与源码输入 ZIP。
# 只上传不存在的文件，不覆盖旧项；完整远端回读后生成收据。
node tools/publish.mjs assets --assets-map <assets-map.json> --receipt <new-github-receipt.json>

# 首次可省略 previous；后续指向已发布目录。激活也会校验现有目录的代次/身份。
node tools/catalog.mjs generate --key <private-key.pem> --kid amcl-runtime-2026-01 --out <new-candidate-dir> --previous catalog/v1
node tools/publish.mjs activate --catalog-dir <new-candidate-dir> --receipt <new-github-receipt.json> --transaction-dir <new-external-transaction-dir>

# 首次接入或更新随包离线快照；日常更新远程目录无需再构建 HAP。
node tools/export-clients.mjs --catalog-dir catalog/v1 --app <MyApplication> --web <AMCL-web>
```

提交源、签名目录、来源收据和文档，推送 GitHub 后取回两个通道 JSON，核对原字节和验签。自有服务器用 `AMCL-web/deploy/deploy-runtimes.ps1` 上传相同成品，先包后目录。只改一个版本时，其余 ZIP 继续复用。预览更新允许全局目录代次和共享构建列表前进，但不借此改变 stable 的推荐或降低其验收要求。

`check`、签名和激活共用来源闭包：每个 `source-build` 必须在 `provenance/build-inputs.json` 有且仅有一个源码输入 ZIP，并具有 `provenance/<buildId>.json` 原始构建收据；收据摘要、运行 ZIP 身份、上游仓库/提交必须匹配 catalog。源码输入索引的原字节也被纳入发布收据，不能在资产验完后更换索引而继续激活。

上传前完整读取所有本地运行包与源码包。源码 ZIP 另核规范路径、唯一条目、普通文件、中央目录/本地头、CRC、有界展开、每个源文件摘要、内层索引精确集合及嵌入构建收据。新完整构建必须使用冻结输入 schema2；旧已发布 schema1 只保留导出器当时未纳入摘要的 README 例外。源码、运行包都必须全量远端读回，新的 schema2 发布收据缺任一项、重复项、内容校验记录或精确来源身份都会拒绝激活。旧 schema1 发布收据不能直接拿来激活新目录，应重新只读回验并生成新收据。

来源含 `0023-ohos-javasound-daudio-playback.patch` 的新音频包，在首次远端操作前还须通过
独立运行 ZIP 门。该门从实际 ELF 读取 `.amcl.daudio` 标记、只读加载映射、强导入、
`DT_NEEDED` 和全部原生库清单，逐项核对包内能力声明。只有 `libjsound.so` 可新增
`libohaudio.so` 依赖；未知系统依赖、包内同名 SDK 库、普通字符串冒充标记、弱化的必需导入
以及录音或设备资格虚报均拒绝。旧包不因新功能加入而重写其原能力或来源记录。

这类包的 `assets` 命令另传 `--sdk-provider-map <sdk-providers.json>`。映射在仓外保存，格式为
`{"schemaVersion":1,"providers":[{"name":"libohaudio.so","sha256":"<SHA-256>","path":"<绝对路径>"},{"name":"libc.so","sha256":"<SHA-256>","path":"<绝对路径>"}]}`。
每份 SDK 实物的 SHA 必须命中原完整构建收据的
`inputClosure.nativeSdk.files["sysroot/usr/lib/aarch64-linux-ohos/libohaudio.so"]`，
且其实际 SONAME、可解析导出必须供应该包全部 `OH_Audio*` 导入。可列多个已冻结 SDK，
不能用当前安装目录的同名文件自动替代历史 SDK，也不把 SDK 二进制公开到源码包。
音频强引用另沿实际 `DT_NEEDED` 递归核对；`JNU_*`、`JVM_*`、`JNI_*` 及其余强导入都
必须在该闭包内找到真实可解析定义。包中存在但没有依赖边的 `libjava.so` 不构成供应者。
provider map 还需提供闭包中实际使用的既有系统库（当前四代包括 `libc.so`），每项仍按
原 `nativeSdk.files` 摘要核验；系统依赖允许列表不因本门扩大。合法 weak 引用和可选
MIDI 的动态查询名称不被提升为强依赖。新审计包含 `symbolClosure` 的精确符号和供应者
身份，激活拒绝缺少此字段的旧审计；历史有效包保持原字节，通过新工具重新读回生成新报告。
静态记录绑定 buildId、完整 ZIP 摘要、libjsound/内层清单摘要、SDK 摘要和实际符号集合；
完整远端 ZIP 读回成功后才写入发布收据，激活条件门会重新核对这些身份。

含0026的包另要求同一SDK冻结输入中的`libohmidi.so`实物加入上述显式provider map。
MIDI为API24可选动态供应者，JDK最低API仍为20；禁止运行包`DT_NEEDED`或直接强/弱导入
OH_MIDI。独立门读取真实只读`.amcl.midi`标记、只读PT_LOAD内14个动态API名，以及14个
可执行JNI/生命周期函数和一个身份对象；SDK各函数也必须是实际PF_X函数定义。能力为
`ohmidi-api24-optional-midi1`，不授予外设收发或蓝牙授权资格。

含0027的包要求真实只读`.amcl.ports`标记、8个强音频SDK入口和15个JNI导出。
能力为`device-ports-requires-device-test`，合同明确`controlsExposed=false`、
`systemControlWrites=not-public-api`；不能以renderer局部音量伪造系统Control。MIDI与Ports
各自的精确Backend子记录绑定同一运行ZIP/来源/SDK，并在激活时复核；不接受任意附加的
device-tested声明。没有对应补丁的历史包保持原字段和无设备范围。

只做本地验证时使用
`node tools/verify-runtime-audio.mjs --archive <运行ZIP> --receipt <原始manifest.json> --sdk-provider-map <映射> --output <新报告>`。
该命令不上传或激活。后端静态状态限定为 API 20 起的
`implemented-requires-device-test` 播放实现，capture 为 `not-implemented`；
真机播放、关闭恢复、默认 ProcessBuilder 和整套性能仍须各自的实际证据，不能由静态门授予资格。

同时记录 `0025-ohos-javasound-duplex-host-callbacks.patch` 的构建必须使用真实
`AMCL_DAUDIO_OHOS_API20_DUPLEX_V2` 只读标记，不能退回 V1 通过。除播放入口外，
门禁逐项要求原 SDK 供应 Capturer 创建/配置/读回调/错误及中断回调、开始/暂停/清空/释放、
实际格式查询等全部必需强入口。其实际 capability 必须精确声明
`duplex-requires-permission-and-device-test`；capture 为
`implemented-requires-permission-and-device-test`，并保留
`embeddedCallbacks: signed-host-data-abi-v1-required` 的宿主合同。
来源进一步含 `0028-ohos-javasound-presentation-timeline.patch` 时，必须使用V3只读标记
`AMCL_DAUDIO_OHOS_API20_DUPLEX_V3`、backend `ohos-daudio-duplex-v3` 与
`embeddedCallbacks: signed-host-data-abi-v2-required`；缺少0025前置来源仍拒绝。
V3逐项要求真实 `OH_AudioRenderer_GetAudioTimestampInfo` 强导入及SDK供应者，旧
`GetTimestamp` 和累计 `GetFramesWritten` 不再是V3必需项。V1/V2继续自己的历史规则。
这些静态条件不替代实际用户帧、静音尾部、Flush坐标、关闭/重开的目标设备验证。
这些字段随相同完整 ZIP 身份写入并在激活收据中再次核验；它们不证明当前 HAP 已供应
合格回调，不证明 CFI、麦克风授权或真实录音已通过。V1 的旧播放包仍保持原字段与静态规则，
不追改为已有 capture；Native MIDI 和 Ports 也不因 duplex 标记而自动获得支持。

激活先验证两个候选签名、源投影、完整资产收据和前后代次，再保存外置事务的旧/新原件，并逐文件原子替换。`catalog/.activation-pending.json` 存在时禁止签名、常规检查及消费者导出。若第一文件替换后中断，用完全相同的 `activate` 参数重跑；只有当前文件分别等于已记旧件或新件、输入闭包和候选没有变化，才能补齐同批并清除标记。不要手工删标记或将半批推送。日志准备阶段失败且尚无 pending 标记时旧目录未被更改，保留失败目录并使用新的事务目录。文件同步和恢复测试不是硬件断电持久化或两个远程 URL 同时切换的保证，最终仍须 Git 同批提交与远端读回。

自有源验收用 `node tools/publish.mjs verify-web --receipt <new-web-receipt.json>` 完整读回所有 web 包；同时检查 HEAD 长度、Range 206、ETag/304 和签名 JSON 一致。上传成功不等于读回验收。

## 统一 Release 与来源

活跃池为 `ohos-runtimes`，所有新版 JDK 的独立 ZIP 与源码输入 ZIP 集中其中，稳定/预览推荐由签名目录决定。历史独立 Release 与 Gitee 分卷保留。

若开启 GitHub immutable releases，已发布池不能再追加。工具会在第一次上传前核所有现有同名资产，缺新件的 immutable 池立即拒绝。需要新批次时，为新运行包与对应源码包登记同一 `ohos-runtimes-<批次>` URL；上传器从已核 URL 选择实际批次并创建缺失池，不再上传固定旧池却验证另一地址。旧包、旧 URL、旧批次保留，不因配额删除仍被旧客户端引用的资产。

每个新包的 `*-build-inputs.zip` 经导出器逐项核对收据中的核心配方、源码锁定和 patch SHA。Git blob 与旧 Windows checkout 的 CRLF/LF 差异只有在能精确命中原收据摘要时才物化，并记录在 source-inputs.json 中。

源码包包含配方、补丁、Docker 项目入口与路径工具；OpenJDK/FreeType 由固定 commit 取源。OHOS SDK 和宿主镜像是单独前提，不公开凭据、不冒称任意机器仅克隆 Git 就能恢复历史 apt 供应链。新机器须取得同身份输入，或重建工具链并登记新身份后重新验收。

新完整构建从主工程 `scripts/export-runtime-build-inputs.py` 显式指定 `--build-manifest` 和 `--frozen-inputs <本轮 inputs/project>` 导出。外层 completed/exit0 收据必须与运行包 `build.inputClosure` 完全相同，每个冻结源码项均逐字节核验；重建入口另需的 Compose/路径工具在 `supplementaryFiles` 单列，不冒称本次编译输入。完整 SDK/boot/compiler 身份保留在原收据，不把受许可限制的 SDK 二进制打入公开源码包。

若仅以已审核的兼容 provider 更新 CLI，用主工程 `scripts/repack-runtime-provider.py` 生成新的 buildId/文件名：原 ZIP 和内外收据、完整文件集/模式、ELF/依赖先校验，替换后再跑完整 image 门。派生收据同时绑定原 ZIP、原 manifest、provider 来源及再封包配方。HAP 二次 strip 后的摘要与 CLI 使用的已审核输入摘要分开；不能机械要求相等，也不能放宽到只看库名。源码导出时再给 `--derivation-inputs` 和 `--provider-build-root`，补入原始收据、provider 源码/补丁、精确 SDK 输入清单及配方。任何尚未完成的功能、设备许可或性能项不能由该静态重打包门授予 PASS。

增加字体 provider 时使用主工程的显式 `--font-bundle` 输入，派生类型为
`compatible-cxx-font-provider-repack`。每份包只新增对应 classic/modern 依赖名的
`libfontconfig.so`、Fontconfig 与静态 Expat 两份原始许可；现代 FreeType 必须来自
该 JDK 的完整重建，不允许用参考 FreeType 替换。来源收据绑定实际 23 个 FT 导入、
原包 FT 摘要、SONAME 与依赖供应者。它没有授予独立 CLI 或缓存性能资格。

字体源码导出另给 `--fontconfig-build-root`，把同次成功构建的冻结配方、完整 SDK
身份索引、Fontconfig/Expat/参考 FreeType 原归档、Meson/gperf 工具归档及许可放在
独立 `font-provider/` 空间，避免覆盖 JDK 构建当时消费的同名共享脚本。参考 FreeType
源码是构建参考材料，运行包不交付其二进制。源码验证器检查完整命名空间、内外收据、
归档 SHA、Git TAR 的提交注记和许可原文；现代 JDK 还要求对应 FT 补全清单、patch
及许可证属于该次真实冻结输入。只放宽派生 kind、补一份无来源的许可、把补充材料
冒称冻结输入或遗漏依赖供应者均不能通过。

新默认字体/缓存适配带 `sourceAdaptation` 时，原 Fontconfig Git TAR 继续保留上游字节。
主工程和发布端分别从该 TAR 读取两个原源文件，按冻结 series/patch 精确重放每个 hunk
的路径、位置、上下文与计数，再核补后 SHA 及生成 generic 头。实际 provider 的编译标记
同时绑定宏头和默认缓存逻辑；主工程再用真实 ELF 字节检查标记与硬导入。缺任一新字段
不能退回旧路径通过，原本没有默认适配的历史 provider 仍沿用原来源链。槽外缓存不进入
运行包或源码文件清单；这组静态来源验证不代替真实设备的默认配置、持久缓存或热开销资格。

旧 `compatible-cxx-provider-repack` 继续兼容。新派生保存执行时的再封包配方原件；
历史派生缺该副本时，可用主工程导出器的 `--repack-recipe` 显式指定原配方，必须
精确命中旧收据 SHA。当前脚本演进不要求重写旧 ZIP、旧收据或旧资产身份。

现代新增 BDF/PCF 等源文件的 notice 使用字体 bundle schema2 和显式
`--compiled-inputs <原完整构建的 inputs/project>`。工具从原冻结补丁恢复全部新增
文件、核对每文件上游 SHA，复制完整原版权/许可注释及匹配版本许可正文，加入
`legal/amcl-freetype-completion/NOTICE.txt`。这只是原文保全，不代替法律意见。
已存在的旧包不覆写；补充 notice 后生成新的不可变 buildId/文件名。

notice、其来源清单及生成器在公开源包的 `derivedNoticeFiles` 单列，且必须与
原 `frozenFiles` 不相交。发布端直接用原冻结补丁与许可逐字节重算 notice，不执行
源包内脚本；仅更新派生哈希不能掩盖作者、许可、文件清单或版本的改变。源包另带
可重建的生成器入口 `scripts/freetype-notices.py`；单代源包以 `--major <主版本>`
只重建该代材料。旧 schema1 字体审计仍保留，不追改其来源为“已有新 notice”。

旧客户端准入可用 `tools/verify-client-admission.mjs --app <MyApplication> --client-ref <真实旧提交> --required-loader-protocol 2 --receipt <外置证据>` 检查。该工具加载指定提交的生产验证器和 Repository，实际验签更高协议目录后核 `supportsRuntime` / `buildFor` 拒绝下载，并先证明旧协议基线仍可用；其结果是宿主协议证据，不能替代旧 HAP 真机安装行为。

## 回滚与恢复

客户端拒绝未验签、未知 schema、重复身份、内容漂移和降代次。目录失败不删除安装；新包和 receipt 在 staging 验证后一起切换，在用时受租约保护。

服务器包只追加，每次发布保留旧目录/网页和 nginx include。正常业务回滚发布更高代次的旧 build 推荐；紧急恢复旧文件只是临时可用性措施，新客户端不会接受低代次覆盖已接受高代次。每次 receipt 的 archive 字段给出恢复资料，不能靠清空客户端缓存绕过规则。


## v2 候选与旧端兼容

`tools/catalog-v2.mjs` 消费显式 schemaVersion 2 的源：每 build 必填
`requiredHostProtocol`，runtime 不再携带 loaderProtocol/recommendedBuildId，而在每通道
recommendations 中维护有序 `recommendedBuildIds`（最多八项，可以为空）。宿主要求为
不可变身份，修改必须新 buildId。空 v2 推荐可以停止新下载；旧端 v1 不能表达同一语义，
没有安全协议 1 替代时生成器报 `V1_NO_SAFE_RECOMMENDATION`，不能假标协议/复活撤回包。

普通生成按 `--source <v2-source.json>` 指定输入，不改当前 source.json 或 catalog/v1 原件。
先用 `publish.mjs assets --source <同一v2源> ...` 完整读回不可变资产；再运行：

```powershell
node tools/catalog-v2.mjs generate --source <v2-source.json> --asset-receipt <readback.json> --key <仓外私钥> --keys catalog/trusted-keys.json --kid amcl-runtime-2026-01 --previous <含v1/v2的上代目录> --out <全新候选目录>
```

生成器直接读取官网已发布 App stable/preview 的 runtime-host 审计接口，要求每个推荐
都有可达的公开宿主；JDK stable 必须有 App stable，不接受 developer 或 staged 收据。
输出 v1/v2 各两个签名目录和 projection-receipt.json（sourceSha256、逻辑代次与四文件
SHA/大小）。收据用于同批对账，不能替代 JWS 固定公钥验签。旧 activate 明确拒绝 v2，
后续部署使用显式格式命名空间及该批收据，不用旧工具覆盖新目录。

离线测试仅允许 `--fixture --hosts <隔离宿主夹具>`，回执 fixtureOnly 为 true；不能把
这些测试候选作为公开发行证明。测试通过不等于当前宿主已实现协议 2。
`export-clients.mjs --web` 也复制独立 Node 验证所需的 tools/protocol.mjs 与两个纯验证
模块，并记录逐文件摘要，官网 clean clone 不依赖维护者相邻仓。

验证器来源记录为 `sourceRepository`、真实 `sourceCommit`、`hashBasis:git-blob-lf` 和三份
Git blob SHA。导出先绑定同一个 HEAD 与 index，再逐字证明工作副本仅有允许的 CRLF→LF
差异；正文/暂存区漂移、assume-unchanged 隐藏差异或读取期间 HEAD 变化均拒绝。输出
直接使用固定提交的规范 LF 字节，不能将未提交的新验证逻辑归因于旧 HEAD。
`normalizationEvidence` 保存实际换行归一化文件及原 Git status；不将 Windows 的 stat
缓存或纯换行差异伪称为全工作树洁净。该记录仅说明冻结的验证模块，不能代替官网公钥
或签名目录的独立信任身份。

本轮仅实现并验证候选工具，没有更换线上 revision、推荐、JDK ZIP 或生产私钥。旧稳定
JDK8 的合格替代、旧 Native/协议2候选整合与组合设备资格仍需分别闭合后再授权发行。

## 2026-10-30 协议2组合与发行闭包

R12的实际来源ZIP、Fontconfig/FreeType、音频、MIDI、Ports、native-temp和持久激活保护
现与目录v2工具使用同一套实现。v2生产生成也验证完整`validateDeliveryReceipt`，不能
只凭运行ZIP摘要跳过源码和SDK审计；首次v2允许只有完整v1前代，已存在但残缺的v2前代
仍拒绝。导出器的激活保护在Git验证器正文冻结后才加载，未提交验证器不能提前执行。

准备未发布候选时，`publish.mjs check/assets`和`catalog-v2.mjs generate`可显式传
`--delivery-root <仓外候选根>`；该根包含`catalog/source.json`和完整`provenance/`，也可
继续显式指定`--source`。候选根不能走旧`activate`覆盖本仓，两格式公开部署仍必须验证
实际已发布App、资产完整回读、签名和同批投影收据。fixture签名始终仅限隔离验证。

应用组合分支已接入真实协议2宿主及新旧安装journal恢复，具体SDK/设备资格由应用收据
单独记录。本轮不上传、不推送、不激活推荐，也不把工具测试通过写成公共宿主已经上线。

# 2026-11-13 四套 JDK 与 AMCL 1.0.7 联合发布准备

本记录只描述已完成的本地准备及后续发布条件。**尚未发布**；没有上传资产、读取生产私钥、签生产目录、推送 Git、部署服务、切换推荐或制作新的正式 HAP。

本轮资格记录生成时间为 2026-11-13 20:47:32（Asia/Shanghai）；本地完整资产审计执行时间为 2026-11-13 21:28:25 至 21:29:12（Asia/Shanghai），均来自工具收据。后续发布必须重新读取当时线上事实，不把这些时间点的快照视作永久成立。

## 发行范围与原件

维护者本次标准是原版游戏能正常游玩；单个整合包不通过不构成严重阻碍。范围是 `sideload` 与四代 JDK，不顺带发布没有实际公开基线的 `desktop`，也不扩大到 `store`。

| JDK | 不可变 buildId | 原版验收 | 运行 ZIP SHA-256 |
| --- | --- | --- | --- |
| 8 | `jdk8-ohos-20261027-code1` | 1.12.2、1.16.5 | `a50d049bebdbc07c1a678d51cd078e68e6b6b1533035d18693e36d7b493174c5` |
| 17 | `jdk17-ohos-20261027-code1` | 1.20.1 | `6f8503d4d85c0bc8228b979a6a5827ad8a3960ad0a231384e76531ca0576f6cf` |
| 21 | `jdk21-ohos-20261027-code2` | 1.21.4 | `a9765c3c8779f696f5d37a112108e3ae760a3b123d781640dcd29126e66c66ce` |
| 25 | `jdk25-ohos-20261027-code1` | 26.3 | `4a80ab45c7ff879d8c80ff5c8179d27a487de688649acd67ccc9e76bd0d857cd` |

每份运行 ZIP 配套同 buildId 的 `-build-inputs.zip`，共 8 个新增文件；大小、源码 ZIP、manifest、libjvm 摘要及逐次 PID/时间见 [资格记录](../qualifications/jdk-code-20261113-vanilla-release.json)。不重新封包，不把 JDK21 的 code1 或旧 R12 混入本次四套推荐。

资格限定 MRDI-W10/API26、自动渲染选择、空自定义 JVM 参数、JDK 稳定通道。五个原版各完成一次运行/保存/菜单退出及一次全新 JVM 冷启动读档/退出；保存后角色状态一致，世界时间继续推进。共十次独立会话。JDK25 两次还取得操作系统退出码 0；其余会话的证据是 JVM 请求正常退出及游戏进程消失，不能冒称都取得 OS wait 状态。

验收 App 为生产代码 `5494ffdf0f60aa49fdbfa46a8c1131d0e38ea46a` 的 `default/debug`、`1.0.7-pre1/1000910`，HAP SHA 为 `42b0becfd061baf818bb7d3b38b38cc8c63ea194d49a1688fce3aa29de29427c`。它不是待公开的最终侧载原件。资格不覆盖全部设备/API、联机/Realms、长期性能、全部 Java SE/外设或整个模组生态。

Prominence、部分 MG shader/LOD 语义与辅助 SDL 线程问题继续保留；DH 已按维护者决定不列入适配清单。重负载文件堆测试曾发生非人工重启，原因仍未知，不写成已修复。它们在本次既定原版发行标准下不是否决项。

## 已冻结的准备材料

维护者工作区入口为 `.workspace/run/joint-release-1113/`。原始大包继续引用既有存储，不复制或删除；所有本轮小型结果留在该目录。

| 材料 | 本次身份或结果 |
| --- | --- |
| `delivery-candidate/catalog/source.json` | schema 2，候选 revision 6；SHA `6c3d61aa038964c5fceba19dba495da68971cbe65f3141cdf4d7c3ca1daeddcb` |
| 资格 JSON | SHA `221efd8c861602d9e3fe1c8be64d530dd62356147ea20bc66597c72828308915` |
| 完整交付闭包 | 26 项；SHA `d2534d4b4466b617eea80a15043ead1fcfbb196e53c2ab2d98730f48ca2fb96f` |
| 源码输入索引 | SHA `2dd68c5ebd002d4391a0ab7d825056b14571ac8a058a47ce20683d08416adff4` |
| `offline-audit-r1/local-assets-audit.json` | SHA `9fd983ff6239ca2df566662378fdab963909cb3f2d9548c79a23dd601761beff` |
| `offline-audit-r1/assets-map.json` | 全部 26 项绝对路径；历史 R12 引用已保留的发行恢复原件 |
| `offline-audit-r1/sdk-providers.json` | 实物 SHA 与原构建冻结 SDK 对应；未重新猜测同名供应者 |
| `offline-audit-r1/unsigned-catalogs/` | v1/v2 × stable/preview 四份 `.payload.json`，无 JWS 签名 |
| `offline-audit-r1/app-input/builtin.planned.json` | 待正式签名导出内容的预览；未写入 App，未伪造 origin 摘要 |
| `offline-audit-r1/result.json` | 完整本地演练、待上传 8 项、依赖与负控结果；不是远端收据 |
| `old-client-admission.json` | 真实 1.0.6 源码拒绝协议 2 的宿主测试；不替代旧 HAP 真机操作 |
| `deployed-guard-readback.json` | 官网服务器只读文件摘要；已确认新联合发布 guard 尚未部署 |
| `website-inputs-r1/` | 官网提交 `a976aaca30388397ac38fcf785b04f61b36f0b89` 的冻结源码归档及三组相关回归结果；不含正式部署/前端构建资格 |

完整本地审计读完 26 份 ZIP，并完成 13 份源码归档校验、8 份适用的原生音频/SDK 审计。三个负控均按预期拒绝：未获资格即稳定晋升、v1/v2 原件不一致、旧宿主消费新运行时要求。没有调整生产验证器让这些案例通过。

最新线上快照于 2026-11-13 20:50:30（Asia/Shanghai）读取：App 稳定头仍为 1.0.6/1000910，host `[1]`、reader `0`；JDK v1 为 revision 4，v2 仍为 404。本次 8 个新文件尚未交付。GitHub `ohos-runtimes` 现有 18 项，同名大小/digest 无冲突，池未设 immutable，允许在以后追加新资产。该 metadata 检查不等于完整远端内容回读。

候选推荐真实要求 host 2。当前公开事实派生的 8 条正向边全部是 `waiting-host`，不伪造已公开 host 2。候选同时满足未来 App `[1,2]`、reader 2、四代 `zipfs-transaction-v1` 的输入覆盖关系；这是未签名输入级演练，不能声称 App 上线门已过。

## 执行顺序与安全停点

1. **取得本批实际发布授权后，重新核源及公开事实。** 校验上述原件/源摘要、当前两产品公开头和完整历史、旧目录与资产池冲突。如事实变化，重新生成批次/收据；过期或已占用 revision 不复用。正式版拟为 1.0.7，code 拟为 1000911；本轮没有改实际包内 1000910，也没有制造同名正式包。
   在任何新版 App 原件公开前，先按官网全量部署流程补齐联合发布 guard、HAP 审计、包仓流程、固定验证器及其真实 OS 租约实现，并验收失败拒绝与回滚。2026-11-13 21:34:25（Asia/Shanghai）的只读检查发现线上缺少 `server/src/lib/runtime-publication-guard.js`，其余五个关联文件也不等于本地已提交版本。本轮没有更新服务器；不能直接依赖当前线上代码已具备新门禁。冻结源码归档不含构建后的前端，也不能替代最终部署/回滚验收。
2. **先交付 JDK 资产。** 用完整 26 项 map 执行发布器，只上传缺少的 8 项，然后对全部 26 项做真实远端内容回读。保存新 schema 2 receipt。不得 clobber、删旧资产、用本地审计代替远端收据，或把源包漏出公开交付。
3. **生成并交付同批目录。** 生产生成器用真实 receipt、固定公钥和现有私钥，实时核宿主后签 v1/v2 × 两通道。记录源、闭包、四文件与 projection receipt 摘要。将审核过的源/来源记录及四目录纳入资源仓同批提交；推送和官网部署均需后续发布授权。官网先部署 v1 并附同批收据，再部署 v2；全部已声明公开下载入口完整回读一致后才继续。waiting-host 在此阶段合法；旧 App 的真实协议过滤保留。
4. **正式导出 App 消费输入。** `export-clients.mjs` 只能消费上一阶段已验签目录，生成 App builtin/origin、公钥及官网验证器来源；不能把本轮 `.payload.json` 直接塞入正式 HAP。使用此输入与现有累计生产源码形成干净侧载候选，正式发版时才同步 1.0.7 的包版本、展示常量、官网日志和快照，执行选定产品的发布构建/原件门禁。
5. **补实际产品与公网验收。** 按下表在测试平板验证最终 signed sideload 与相同生产 payload 的 unsigned 原件。取得新收据前，default/debug 的旧结果不能标成最终正式包已通过。
6. **最后公开 App。** 核必要 Native 提交公开可取、干净公开源码快照和来源/产品/HAP 精确对应；先有真实 GitHub 原件与官网/镜像就绪，再切 sideload stable 和导出 feed/旧 update.json。真实 host `[1,2]`/reader 2 公开后重新计算闭包，确认 waiting-host 转为 ready。若正式收敛已有预览，再按真实基线同步 preview；不可提前发预览破坏正式返回路径。

第一阶段工具形状（以下仅为待授权执行的命令说明，本轮未执行）：

```powershell
node tools/publish.mjs assets --delivery-root <delivery-candidate> --source <delivery-candidate/catalog/source.json> --assets-map <offline-audit-r1/assets-map.json> --sdk-provider-map <offline-audit-r1/sdk-providers.json> --receipt <全新远端收据路径>
node tools/catalog-v2.mjs generate --delivery-root <delivery-candidate> --source <delivery-candidate/catalog/source.json> --asset-receipt <真实远端收据> --products sideload --key <既有私钥路径> --keys catalog/trusted-keys.json --kid amcl-runtime-2026-01 --previous <真实上代catalog根> --out <全新签名批次目录>
```

两条命令之间必须确认上条退出码为 0，不能在失败后继续。实际部署参数以官网 `deploy/deploy-runtimes.ps1` 为准：显式 `ResourcesRepository`、`CatalogDirectory`、`AssetsMap`、`OutputDirectory`、`CatalogVersion`、同批 `ProjectionReceipt` 和 `Products sideload`。生产生成/激活时仍从实时官方端点取得宿主事实，不传本轮快照绕过实时核查。

## 最终侧载验收表

| 场景 | 必需结果与证据 |
| --- | --- |
| 正式 HAP 身份 | 产品 sideload、正式版本/code、宿主/reader/四代能力、builtin 同批签名来源、ABI/最低 API、sourceRevision、signed/unsigned SHA 与签名身份全部核对 |
| 全新安装 | 正常 UI 保持 JDK 稳定通道；从公开默认源下载四套对应原件，真实验证 SHA/receipt/加载的 libjvm；不依赖测试密钥、私有端口或手工塞包 |
| 1.0.6 覆盖升级 | 先真实旧版和旧官方稳定 JDK，再相同身份覆盖最终候选；账号/实例/设置/存档与 sentinel 保留，旧包被准确识别，稳定通道内能修复，无强制切预览 |
| 游戏往返 | 按已记录路由运行五个原版，进世界、基本交互、保存、菜单退出，再用新 JVM 冷读相同世界；记录实际原件/日志/进程状态 |
| 目录与兼容 | 新端 v2 正常与 v1 回落均选择本次合格四套；旧端仍拒绝 host 2 下载；失败目录或未就绪下载不删除可用旧安装 |
| 用户可下载闭环 | GitHub 原件、官网副本、签名目录、App 内置和更新 feed 同源；抽查普通用户从稳定入口重装可成功，无仅管理员可见候选 |

2026-11-11 曾有隔离目录/测试密钥下的全新安装与 1.0.6 覆盖升级证据，继续保留其真实边界；它证明实现路径，不代替此处最终公网/正式产品验收。发生失败时保留现场、停止 App 公开，仍已上传的不可变 JDK 原件保留；新 App 已公开后不能撤掉其必需稳定供给或回滚到不支持当前恢复 reader 的正式头。

## 尚未闭合的交付项

上述公网资产/生产签名/目录部署、最终侧载包构建与公网新装覆盖验收、公开源码及必要依赖都尚待执行。2026-11-13 本轮 GitHub 只读查询还确认 MobileGL `234a95b88e8f1a5a91ae542a37b566d9631434af` 返回“该 SHA 无提交”，该本地 pin 须随发布公开，之后才能证明干净公开克隆可取得输入。不能把本地 gitlink 存在写成公开源码可重建已通过。

官网门禁部署也是明确前置项。2026-11-13 21:36:07 至 21:36:10（Asia/Shanghai）对冻结的本地实现重跑 `runtime-publication`、`runtime-host-recovery` 和 `package-depot` 三组回归并全部通过，测试夹具自行收回；源码归档 SHA 为 `56c5e04bd2a6a628a0d2de104d8b0be7f2538c408c93003f4558150be388983b`。这证明本地输入和机制准备，不证明服务器已更新。

这些是联合交付条件；当前已测五个原版没有新增严重阻碍。没有把“候选准备完成”写成“所有公开发布门禁已通过”。

# 目录与资产发布

`catalog/source.json` 是唯一手工维护的运行时目录。`catalog/v1/*.json` 是签名成品，不能手改；应用、网站、自有存储都复制同一来源。`provenance/` 保存构建收据和生成的源码输入包索引。

## 身份规则

- runtimeId 固定主版本、平台和布局；buildId 固定 Java 版本、文件名、大小与 SHA-256。修改包字节使用新 buildId/文件名，不 `--clobber` 旧资产。
- `catalogRevision` 每次目录变化增加；只改变某个 JDK 推荐时只增加该项 `recommendationRevision`。镜像变化不增加推荐代次。
- 撤回将 build 设为 `withdrawn` 并提供其它推荐。回滚指向仍登记的旧 build，但推荐代次继续增加，不能回退 JSON 代次。
- 需要精确回退时，在该通道 recommendations 中增加 `rollback: { "fromBuildIds": ["坏构建ID"], "reason": "已定位的回归与回退原因" }`，生成后位于 runtime.rollback。fromBuildIds 必须属于同一 runtime 且全部标记 withdrawn；两个通道都不能继续推荐撤回构建。修改回退范围/原因也增加 recommendationRevision。撤回 ID 不可复活，修复或更正使用新的 buildId。
- 新平台/adapter 可以进入结构合法的目录，当前不支持的 HAP 不安装。新主版本须经过构建与验收，不能只修改主版本号。
- 稳定通道新源码构建必须达到 `device-matrix-tested`，legacy 为兼容迁移例外。当前新包均在预览通道，用户单场景反馈不能冒充设备矩阵。

## 标准步骤

要求 Node 22+、已登录有写权限的 `gh`、主工程 Docker 构建环境。签名私钥和 HAP 证书分离，由维护者保管，不能上传网页服务器。初次 keygen 只运行一次；信任根轮换需客户端迁移，不能覆盖现用键。

```powershell
# 先完整构建候选与 manifest，再更新 source.json 的相应 build/推荐与真实验收证据。
node tools/catalog.mjs check
node --test tests/*.test.mjs

# assets-map 为仓外“文件名: 本地绝对路径”JSON，含已登记包与源码输入 ZIP。
# 只上传不存在的文件，不覆盖旧项；完整远端回读后生成收据。
node tools/publish.mjs assets --assets-map <assets-map.json> --receipt <new-github-receipt.json>

# 首次可省略 previous；后续指向已发布目录。激活也会校验现有目录的代次/身份。
node tools/catalog.mjs generate --key <private-key.pem> --kid amcl-runtime-2026-01 --out <new-candidate-dir> --previous catalog/v1
node tools/publish.mjs activate --catalog-dir <new-candidate-dir> --receipt <new-github-receipt.json>

# 首次接入或更新随包离线快照；日常更新远程目录无需再构建 HAP。
node tools/export-clients.mjs --catalog-dir catalog/v1 --app <MyApplication> --web <AMCL-web>
```

提交源、签名目录、来源收据和文档，推送 GitHub 后取回两个通道 JSON，核对原字节和验签。自有服务器用 `AMCL-web/deploy/deploy-runtimes.ps1` 上传相同成品，先包后目录。只改一个版本时，其余 ZIP 继续复用。

自有源验收用 `node tools/publish.mjs verify-web --receipt <new-web-receipt.json>` 完整读回所有 web 包；同时检查 HEAD 长度、Range 206、ETag/304 和签名 JSON 一致。上传成功不等于读回验收。

## 统一 Release 与来源

活跃池为 `ohos-runtimes`，所有新版 JDK 的独立 ZIP 与源码输入 ZIP 集中其中，稳定/预览推荐由签名目录决定。历史独立 Release 与 Gitee 分卷保留。

若开启 GitHub immutable releases，已发布池不能再追加。工具失败后应创建新的**批次统一 Release**并更新新包 URL，不能按版本继续拆分，也不能因配额删除仍被旧客户端引用的资产。

每个新包的 `*-build-inputs.zip` 经导出器逐项核对收据中的核心配方、源码锁定和 patch SHA。Git blob 与旧 Windows checkout 的 CRLF/LF 差异只有在能精确命中原收据摘要时才物化，并记录在 source-inputs.json 中。

源码包包含配方、补丁、Docker 项目入口与路径工具；OpenJDK/FreeType 由固定 commit 取源。OHOS SDK 和宿主镜像是单独前提，不公开凭据、不冒称任意机器仅克隆 Git 就能恢复历史 apt 供应链。新机器须取得同身份输入，或重建工具链并登记新身份后重新验收。

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

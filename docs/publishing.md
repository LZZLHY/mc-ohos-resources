# 目录与资产发布

`catalog/source.json` 是唯一手工维护的运行时目录。`catalog/v1/*.json` 是签名成品，不能手改；应用、网站、自有存储都复制同一来源。`provenance/` 保存构建收据和生成的源码输入包索引。

## 身份规则

- runtimeId 固定主版本、平台和布局；buildId 固定 Java 版本、文件名、大小与 SHA-256。修改包字节使用新 buildId/文件名，不 `--clobber` 旧资产。
- `catalogRevision` 每次目录变化增加；只改变某个 JDK 推荐时只增加该项 `recommendationRevision`。镜像变化不增加推荐代次。
- 撤回将 build 设为 `withdrawn` 并提供其它推荐。回滚指向仍登记的旧 build，但推荐代次继续增加，不能回退 JSON 代次。
- 需要精确回退时，在该通道 recommendations 中增加 `rollback: { "fromBuildIds": ["坏构建ID"], "reason": "已定位的回归与回退原因" }`，生成后位于 runtime.rollback。fromBuildIds 必须属于同一 runtime 且全部标记 withdrawn；两个通道都不能继续推荐撤回构建。修改回退范围/原因也增加 recommendationRevision。撤回 ID 不可复活，修复或更正使用新的 buildId。
- 新平台/adapter 可以进入结构合法的目录，当前不支持的 HAP 不安装。新主版本须经过构建与验收，不能只修改主版本号。
- 预览需要新宿主时，可以仅在该槽的 `recommendations.preview` 覆盖 `loaderProtocol`、`minimumApi`、`minimumCatalogProtocol`。通道不能覆盖 runtime 的平台/布局身份；准入下限改变也必须增加该槽推荐代次。宿主协议尚未取得资格时保持不支持，不因目录准备完成就开启新协议。
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

旧 `compatible-cxx-provider-repack` 继续兼容。新派生保存执行时的再封包配方原件；
历史派生缺该副本时，可用主工程导出器的 `--repack-recipe` 显式指定原配方，必须
精确命中旧收据 SHA。当前脚本演进不要求重写旧 ZIP、旧收据或旧资产身份。

旧客户端准入可用 `tools/verify-client-admission.mjs --app <MyApplication> --client-ref <真实旧提交> --required-loader-protocol 2 --receipt <外置证据>` 检查。该工具加载指定提交的生产验证器和 Repository，实际验签更高协议目录后核 `supportsRuntime` / `buildFor` 拒绝下载，并先证明旧协议基线仍可用；其结果是宿主协议证据，不能替代旧 HAP 真机安装行为。

## 回滚与恢复

客户端拒绝未验签、未知 schema、重复身份、内容漂移和降代次。目录失败不删除安装；新包和 receipt 在 staging 验证后一起切换，在用时受租约保护。

服务器包只追加，每次发布保留旧目录/网页和 nginx include。正常业务回滚发布更高代次的旧 build 推荐；紧急恢复旧文件只是临时可用性措施，新客户端不会接受低代次覆盖已接受高代次。每次 receipt 的 archive 字段给出恢复资料，不能靠清空客户端缓存绕过规则。

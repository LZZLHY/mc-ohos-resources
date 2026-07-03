# mc-ohos-resources

> ✅ **生产 release 通道**。AMCL 启动器从此仓库 GitHub Releases 拉取预编译的 OpenJDK 完整
> 运行时（模块化：`lib/server/libjvm.so` + `lib/modules` + `conf/`；经典布局 JDK 8：
> `jre/lib/aarch64/server/libjvm.so` + `rt.jar`），通过自定义 ELF loader 加载，
> 绕过 HarmonyOS NEXT MAP_XPM 代码签名验证。

为 HarmonyOS NEXT（aarch64 · **musl**）预编译的 OpenJDK 资源，用于在鸿蒙设备上运行
Minecraft Java 版。配合 [AMCL 启动器](https://github.com/LZZLHY/amcl) 使用。

---

## 当前可用版本

AMCL 目前维护 **四套** 运行时，覆盖从远古到最新的 MC：

| JDK | 标签 | 布局 | 覆盖的 MC | 状态 |
|---|---|---|---|---|
| **JDK 8** | `v8u452-ohos-3` | 经典 | 1.13 ~ 1.16.5 | ✅ 可用（老 Forge / 老整合包，**仅手动选择**） |
| **JDK 17** | `v17.0.13-ohos-4` | 模块化 | 1.17 ~ 1.20.4 | ✅ 上线运行时（默认、最稳） |
| **JDK 21** | `v21.0.5-ohos-6` | 模块化 | 1.20.5 ~ 1.21.x | ✅ 上线运行时 |
| **JDK 25** | `v25.0.4-ohos-1` | 模块化 | 26.1 及更新 | ✅ 上线运行时（⚠️ 实验性） |

### 版本自动路由

AMCL 启动器 `JdkManager.autoSelectVersion(mcVersion)` 按 MC 版本「纪元」路由：

- **YEARLY 纪元**（26.1 及更新，新版 `YY.D.H` 版本号如 `26.1` / `26.2`）→ **JDK 25**
- **CLASSIC 纪元** 且 ≥ 1.20.5 → **JDK 21**
- **CLASSIC 纪元** 且 ≤ 1.20.4 → **JDK 17**
- **JDK 8** 不参与自动路由，**仅手动选择**（给 1.13–1.16.5 的老 Forge / 老整合包，配
  gl4es + LWJGL 3.2 套跑固定管线）

用户也可在 SettingsTab 手动固定版本。Forge / NeoForge 安装器所需 JDK 按同一套纪元判定自动匹配。

> **JDK 25（2026-05-30 上线）**：MC 26.1「Tiny Takeover」是首个要求 Java 25 的版本，并启用
> 全新 `YY.D.H` 版本号格式。走真 headless 模式（`-Djava.awt.headless=true` +
> `sun.awt.HeadlessToolkit`），与 21 v6 同构。
>
> **JDK 21 v6（2026-05-19）关键决策**：放弃 Cacio AWT，改走真 headless 路径，修复 1.20.5+
> 错装 mod 触发 Fabric Swing 错误对话框时的 native crash。
>
> **JDK 8（2026-06-12 真机跑通）**：鸿蒙无现成 OHOS aarch64 OpenJDK 8，AMCL 用 OHOS NDK +
> clang-15 交叉编译 jdk8u（经典森林），并修好 clang 把老代码 UB「优化坏」的若干代码生成问题。

---

## Release 文件清单

| 文件 | 大小 | 内容 | 解压目标 |
|---|---|---|---|
| `jdk8-ohos-full.zip` | ~39.6 MB | 完整 JDK 8（经典布局：`jre/lib/aarch64/server/libjvm.so` + `rt.jar`） | `filesDir/jdk/8/` |
| `jdk17-ohos-full-v4.zip` | ~114 MB | 完整 JDK 17（`lib/` + `conf/` + `release`） | `filesDir/jdk/17/` |
| `jdk21-ohos-full.zip` | ~118 MB | 完整 JDK 21（同 17 结构） | `filesDir/jdk/21/` |
| `jdk25-ohos-full.zip` | ~122 MB | 完整 JDK 25（同 17 结构） | `filesDir/jdk/25/` |

每个 release 在 GitHub Release 页面附 `sha256` + `sizeBytes`，AMCL 下载完会校验，
失败重试下个镜像（避免劫持注入）。版本元数据以 AMCL 主仓 `deps.lock` 为单一事实源。

---

## 布局差异：经典（JDK 8） vs 模块化（17 / 21 / 25）

| | JDK 8（经典） | JDK 17 / 21 / 25（模块化） |
|---|---|---|
| JVM | `jre/lib/aarch64/server/libjvm.so` | `lib/server/libjvm.so` |
| 类库 | `jre/lib/rt.jar` | `lib/modules`（jimage 容器） |
| `java.home` | 指向 `jdk/8/jre` | 指向 jdk 根 |
| 启动器适配 | 经典布局专属（`-Dos.name=Linux`、`JNI_VERSION_1_8`、剔除 `--add-opens` 等 JDK9+ 选项） | 模块化通用（`JNI_VERSION_10`） |

---

## .so 文件清单（模块化 JDK 17 / 21 / 25 同构）

OpenJDK 标准 Linux aarch64 build 一共约 39 个 `.so`。OHOS 包**统一 36-37 个**，
缺失的均为 OHOS 上不可用且 MC 不需要的组件。

### ✅ 已包含

- **JVM 核心**：`lib/server/libjvm.so`、`libjli.so`、`libjsig.so`、`libjava.so`、`libjimage.so`、`libverify.so`、`libsyslookup.so`
- **IO / 网络**：`libnio.so`、`libnet.so`、`libzip.so`、`libextnet.so`、`libsctp.so`
- **加密 / 安全**：`libj2pkcs11.so`、`libj2gss.so`、`libj2pcsc.so`、`libjaas.so`、`libsaproc.so`
- **2D 图形 / 字体**：`libawt.so`、`libawt_headless.so`、`libjawt.so`、`libfontmanager.so`、`libfreetype.so`、`libfontconfig.so.1`（自编注入）、`libexpat.so.1`、`libjavajpeg.so`、`liblcms.so`、`libmlib_image.so`
- **音频**：`libjsound.so`（MC 走 LWJGL OpenAL，此仅留 `javax.sound` API 兼容）
- **监控 / 调试 / Agent**：`libmanagement*.so`、`libinstrument.so`、`libjdwp.so`、`libdt_socket.so`、`libattach.so`、`libprefs.so`、`librmi.so`
- **OHOS 适配 stub**：`libcxxabi_shim.so`（OHOS musl libc++ ABI 桥，打包时现编注入）

### ❌ 不包含（OHOS 上不可用且 MC 不需要）

| .so | 原因 |
|---|---|
| `libawt_xawt.so` | OHOS 无 X11 server；`--enable-headless-only` 跳过。走真 headless 模式（`sun.awt.HeadlessToolkit` 接管） |
| `libsplashscreen.so` | `-splash:` 启动闪屏，MC / 启动器都不用 |
| `libjsound_alsa.so` | OHOS 不基于 ALSA；MC 经 LWJGL OpenAL 直连系统音频 |

> JDK 8（经典布局）native 位于 `jre/lib/aarch64/`，同样 headless-only（无 X11）；另运行时
> 由启动器铺一份 `fontconfig.properties`（指向 `/system/fonts`）避免 AWT 字体子系统 NPE。

---

## HotSpot 关键 patch

### 模块化 JDK 17 / 21 / 25 —— 8 个同构 patch

git diff series 格式，全部用 `__MUSL__` 宏门控，只对 `aarch64-linux-musl` target 生效
（buildjdk 走 host glibc 时为 no-op）：

| # | 文件 | 影响 |
|---|---|---|
| 0001 | musl-dlvsym-dlinfo | 删除 JDK 自带 static dlvsym shim；`dlinfo` 在 `MUSL_LIBC && !__GLIBC__` 时 no-op |
| 0002 | java-home-env | OHOS 沙箱 JAVA_HOME 路径推断失败，优先读环境变量 |
| 0003 | dll-dir-env | 同 0002，针对 `SUN_BOOT_LIBRARY_PATH` |
| 0004 | musl-utmpx | musl 无 `setutxent`/`getutxent`/`endutxent` |
| 0005 | signals-posix-abort | OHOS 设备会发未识别信号，不 abort |
| 0006 | aarch64-elf-safepoint-fallback | ELF loader 加载的代码不在 CodeCache，SafePoint polling SEGV 时 disarm polling page |
| 0007 | safepoint-mechanism-mem-prot-read | polling page 用 `MEM_PROT_READ` 配合 0006 |
| 0008 | libjli-skip-re-exec | `RequiresSetenv` 永远 `JNI_FALSE`，跳过 re-exec 死锁路径 |

### 经典 JDK 8 —— 3 个 patch

| # | 文件 | 影响 |
|---|---|---|
| 0001 | ohos-musl-clang-source-fixes | musl/clang/aarch64 源码级合并修复（isnanf、prfm、SIGCLD、JAVA_HOME 环境变量优先、避免 musl re-exec 死锁等） |
| 0002 | ohos-clang-codegen-ub-fixes | 修 clang 把 JDK8 老代码 UB「优化坏」的 4 类代码生成问题（逻辑立即数表移位 UB、markOop 伪指针对齐 UB、null-this 保护被删、`init_array` 懒初始化） |
| 0003 | manifestentryverifier-ctor | 补回 `sun.security.util.ManifestEntryVerifier(Manifest)` 单参构造器，让老 Forge modlauncher 的 SecureJarHandler 不再 NoSuchMethodError |

完整 patch 源码 + 编译流程见 AMCL 主仓 `prebuilt/jdk/{8,17,21,25}/patches/` 与各版本 README。

---

## MC + Mod 兼容性评估

四套运行时对 Minecraft 客户端 + 主流 mod（Sodium / Iris / JEI / Create / WorldEdit /
Distant Horizons / Fabric API / Forge 等）功能性完备。可能踩坑的场景**都不在 JDK 这层**：

| 失败模式 | 原因 |
|---|---|
| Mod 自带 x86_64 / glibc `.so` | ABI / libc 不匹配，需 aarch64 musl 版本 |
| Mod 用 `Runtime.exec()` 启动外部进程 | OHOS 沙箱限制 |
| Mod 弹 Swing 配置窗 | 真 headless 模式：HeadlessException 自动 catch / `fabric.noGui` 抑制 |
| Mod 读 `/proc`、`/sys/class` | OHOS 沙箱限制 |
| Mod 用 JNA `libjnidispatch.so` | JNA 默认 aarch64 是 glibc；AMCL HAP 内置 musl 版本 |

---

## 工作原理

1. 用户安装 AMCL 启动器（HAP 含 ELF loader + LWJGL native 等）。
2. 首次启动，JDK 管理面板提示下载 JDK。
3. AMCL 按 MC 版本纪元自动选 JDK 17 / 21 / 25（或手动选 8），从本仓库 Releases 下载对应 zip。
4. 解压到 `filesDir/jdk/<version>/`，校验 sha256。
5. JVM 启动时 ELF loader 加载 `libjvm.so` 等（绕过 MAP_XPM）。

### 设备沙箱目录结构

```
filesDir/
├── jdk/
│   ├── 8/                        ← JDK 8（经典布局，手动选，老 MC）
│   │   └── jre/lib/aarch64/server/libjvm.so + jre/lib/rt.jar ...
│   ├── 17/                       ← JDK 17（CLASSIC ≤ 1.20.4 默认）
│   │   ├── lib/{modules, server/libjvm.so, security/cacerts, *.so}
│   │   ├── conf/
│   │   └── release
│   ├── 21/                       ← JDK 21（CLASSIC ≥ 1.20.5）
│   └── 25/                       ← JDK 25（YEARLY 26.1+）
└── .minecraft/                   ← MC 游戏文件（versions / libraries / mods ...）
```

各版本目录互不影响、可共存。

---

## 编译方式

JDK 通过 Docker + OpenHarmony NDK 交叉编译：

```bash
docker exec ohos-debug bash /build/build_jdk8_ohos.sh    # JDK 8（经典）
docker exec ohos-debug bash /build/build_jdk17_ohos.sh   # JDK 17
docker exec ohos-debug bash /build/build_jdk21_ohos.sh   # JDK 21
docker exec ohos-debug bash /build/build_jdk25_ohos.sh   # JDK 25
```

输出：`/output/jdk{8,17,21,25}-ohos-full.zip`。模块化版脚本会依次应用 patch、configure +
`make images`、重链 libjli、并在打包时现编注入 `libcxxabi_shim.so`。

### 模块化版关键 configure 参数

```
--openjdk-target=aarch64-unknown-linux-musl
--with-jvm-variants=server
--enable-headless-only          # 跳过 libawt_xawt.so / libsplashscreen.so
--with-freetype=bundled
--disable-warnings-as-errors
--with-toolchain-type=clang
```

### 上游 base

| JDK | 仓库 | tag |
|---|---|---|
| 8 | `https://github.com/openjdk/jdk8u.git` | `jdk8u452` |
| 17 | `https://github.com/openjdk/jdk17u.git` | `jdk-17.0.13+11` |
| 21 | `https://github.com/openjdk/jdk21u.git` | `jdk-21.0.5+11` |
| 25 | `https://github.com/openjdk/jdk25u.git` | `jdk-25.0.4+3` |

完整编译流程、OHOS 适配技术细节见 AMCL 主仓 `prebuilt/jdk/{8,17,21,25}/README.md`。

---

## 许可证

OpenJDK 8 / 17 / 21 / 25 — **GPLv2 with Classpath Exception**（随上游）。

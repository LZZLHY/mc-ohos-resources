# mc-ohos-resources

> ✅ **生产 release 通道**。AMCL 启动器从此仓库 GitHub Releases 拉取预编译的 OpenJDK 完整运行时
> （含 `lib/server/libjvm.so` + `lib/modules` + `conf/` 等），通过自定义 ELF loader 加载，
> 绕过 HarmonyOS NEXT MAP_XPM 代码签名验证。

为 HarmonyOS NEXT 预编译的 OpenJDK 资源，用于在鸿蒙设备上运行 Minecraft Java 版。

配合 [AMCL 启动器](https://github.com/LZZLHY/amcl) 使用。

---

## 当前可用版本

| JDK | 标签 | 支持的 MC 版本 | 状态 |
|---|---|---|---|
| **JDK 17** | `v17.0.13-ohos-4` | 1.17 ~ 1.20.4 | ✅ 上线运行时（默认） |
| **JDK 21** | `v21.0.5-ohos-6` | 1.20.5+（含 1.21.x） | ✅ 上线运行时（实验性） |

AMCL 启动器在 `JdkManager.autoSelectVersion(mcVersion)` 按 MC 版本路由：MC ≤ 1.20.4 走 17，
≥ 1.20.5 走 21。用户也可在 SettingsTab 手动切换。

> **JDK 21 v6（2026-05-19）关键决策**：放弃 Cacio AWT，改走真 headless 路径
> （`-Djava.awt.headless=true` + OpenJDK 自带 `sun.awt.HeadlessToolkit`），
> 修复 1.20.5+ 错装 mod 触发 Fabric Swing 错误对话框时的 native crash。
> 详见 AMCL 仓库的 `docs/archive/jdk21-awt-headless-journey-202605.md`（v1-v5 完整踩坑记录）。

---

## Release 文件清单

| 文件 | 大小 | 内容 | 解压目标 |
|---|---|---|---|
| `jdk17-ohos-full-v4.zip` | ~109 MB | 完整 JDK 17（lib/ + conf/ + release） | `filesDir/jdk/17/` |
| `jdk21-ohos-full.zip` | ~113 MB | 完整 JDK 21（同上结构） | `filesDir/jdk/21/` |

每个 release 在 GitHub Release 页面附 `sha256` + `sizeBytes`，AMCL 下载完会校验，
失败重试下个镜像（避免劫持注入）。

---

## .so 文件清单（OHOS 完整 JDK 17 / 21 同构）

OpenJDK 标准 Linux aarch64 build 一共 39 个 `.so`。OHOS 包**统一 36-37 个**，
缺失的均为 OHOS 上不可用且 MC 不需要的组件。

### ✅ 已包含

#### JVM 核心

| .so | 用途 |
|---|---|
| `lib/server/libjvm.so` | HotSpot Server JVM（约 22-25 MB） |
| `libjli.so` | Java Launcher Interface |
| `libjsig.so` | 信号链处理 |
| `libjava.so` | java.* 核心 native |
| `libjimage.so` | jimage 容器（lib/modules） |
| `libverify.so` | 字节码验证器 |
| `libsyslookup.so` | 系统符号查找 |

#### IO / 网络

| .so | 用途 |
|---|---|
| `libnio.so` | NIO direct buffer / socket channel |
| `libnet.so` | java.net.* native |
| `libzip.so` | ZIP / JAR 处理 |
| `libextnet.so` | 扩展网络选项（SO_REUSEPORT 等） |
| `libsctp.so` | SCTP 协议（MC 不用，保留兼容） |

#### 加密 / 安全

| .so | 用途 |
|---|---|
| `libj2pkcs11.so` | PKCS#11 加密接口 |
| `libj2gss.so` | GSS-API（Kerberos） |
| `libj2pcsc.so` | 智能卡 |
| `libjaas.so` | JAAS 认证 |
| `libsaproc.so` | Serviceability Agent |

#### 2D 图形 / 字体

| .so | 用途 |
|---|---|
| `libawt.so` | AWT 核心 |
| `libawt_headless.so` | 无头 AWT 后端（v6 起 JDK 21 走真 headless 模式必需） |
| `libjawt.so` | JAWT 桥接（LWJGL 偶尔用） |
| `libfontmanager.so` | 字体管理 |
| `libfreetype.so` | TrueType 渲染（中文字体必需） |
| `libfontconfig.so.1` | 系统字体查找（自编译注入） |
| `libexpat.so.1` | XML 解析（fontconfig 依赖） |
| `libjavajpeg.so` | JPEG 编解码 |
| `liblcms.so` | 色彩管理（LittleCMS） |
| `libmlib_image.so` | 图像变换 mediaLib |

#### 音频（MC 走 OpenAL，下面这个仅留作 javax.sound API 兼容）

| .so | 用途 |
|---|---|
| `libjsound.so` | javax.sound 裸接口 |

#### 监控 / 调试 / Agent

| .so | 用途 |
|---|---|
| `libmanagement.so` | JMX 核心 |
| `libmanagement_ext.so` | JMX 扩展 |
| `libmanagement_agent.so` | JMX agent |
| `libinstrument.so` | java.lang.instrument |
| `libjdwp.so` | JDWP 调试协议 |
| `libdt_socket.so` | JDWP socket transport |
| `libattach.so` | Attach API |
| `libprefs.so` | Preferences API |
| `librmi.so` | RMI |

#### OHOS 适配 stub

| .so | 用途 |
|---|---|
| `libcxxabi_shim.so` | OHOS musl libc++ ABI 桥（自编译注入） |

### ❌ 不包含（OHOS 上不可用且 MC 不需要）

| .so | 原因 |
|---|---|
| `libawt_xawt.so` | OHOS 没有 X11 server；`--enable-headless-only` 编译跳过。v6 起走真 headless 模式（`sun.awt.HeadlessToolkit` 接管），AWT 类的 `<clinit>` 通过 `if (!isHeadless()) initIDs()` 保护跳过 native 调用 |
| `libsplashscreen.so` | JVM `-splash:` 启动闪屏，MC / 启动器都不用 |
| `libjsound_alsa.so` | OHOS 不基于 ALSA；MC 通过 LWJGL OpenAL 直接走系统音频 |

---

## HotSpot 关键 patch

JDK 17 / 21 同构 8 个 OHOS patch（git diff series 格式，全部用 `__MUSL__` 宏门控
只对 aarch64-linux-musl target 生效）：

| # | 文件 | 影响 |
|---|---|---|
| 0001 | musl-dlvsym-dlinfo | 删除 JDK 自带的 static dlvsym shim（现代 OHOS musl 自带 dlvsym）；dlinfo 在 `MUSL_LIBC && !__GLIBC__` 时 no-op |
| 0002 | java-home-env | OHOS 沙箱 JAVA_HOME 路径推断失败，优先读环境变量 |
| 0003 | dll-dir-env | 同 0002，针对 SUN_BOOT_LIBRARY_PATH |
| 0004 | musl-utmpx | musl 没有 setutxent/getutxent/endutxent |
| 0005 | signals-posix-abort | OHOS 设备会发未识别信号，不 abort |
| 0006 | aarch64-elf-safepoint-fallback | ELF loader 加载的代码不在 CodeCache，SafePoint polling SEGV 时 disarm polling page |
| 0007 | safepoint-mechanism-mem-prot-read | polling page 用 `MEM_PROT_READ` 配合 0006（核心：`MEM_PROT_NONE` → `MEM_PROT_READ`） |
| 0008 | libjli-skip-re-exec | RequiresSetenv 永远 JNI_FALSE，跳过 re-exec 死锁路径 |

完整 patch 源码 + 编译流程见 AMCL 主仓 `docs/JDK_ADAPTATION_GUIDE.md` + `prebuilt/jdk/{17,21}/patches/`。

---

## MC + Mod 兼容性评估

JDK 17 / 21 双版本对 Minecraft 客户端 + 主流 mod（Sodium / Iris / JEI / Create / OptiFine /
WorldEdit / Distant Horizons / Fabric API / Forge 等）功能性完备。

可能踩坑的场景**都不在 JDK 这层**：

| 失败模式 | 原因 |
|---|---|
| Mod 自带 x86_64 / glibc `.so` | ABI / libc 不匹配，需要 mod 提供 aarch64 musl 版本 |
| Mod 用 `Runtime.exec()` 启动外部进程 | OHOS 沙箱限制 |
| Mod 弹 Swing 配置窗 | v6 起真 headless 模式：HeadlessException 自动 catch（mod 自身处理）或 fabric.noGui 抑制 |
| Mod 读 `/proc`、`/sys/class` | OHOS 沙箱限制 |
| Mod 用 JNA `libjnidispatch.so` | JNA 默认 aarch64 是 glibc，OHOS 是 musl；AMCL HAP 内置 musl 版本（5.14.0） |

---

## 工作原理

1. 用户安装 AMCL 启动器（HAP 包含 ELF loader + LWJGL native 等）
2. 首次启动 JDK 管理面板提示下载 JDK
3. AMCL 按 MC 版本自动选 JDK 17 或 21，从 GitHub Releases 下载对应 zip
4. 解压到 `filesDir/jdk/<version>/`，AMCL 校验 sha256
5. JVM 启动时 ELF loader 加载 `lib/server/libjvm.so` 等（绕过 MAP_XPM）

## 设备沙箱目录结构

```
filesDir/
├── jdk/
│   ├── 17/                       ← JDK 17 数据（MC ≤ 1.20.4 默认）
│   │   ├── lib/
│   │   │   ├── modules           ← jimage 容器，所有 java 类
│   │   │   ├── server/libjvm.so
│   │   │   ├── security/cacerts
│   │   │   └── *.so              ← native libs
│   │   ├── conf/
│   │   └── release
│   └── 21/                       ← JDK 21 数据（MC ≥ 1.20.5 默认）
│       └── ...（同 17 结构）
└── .minecraft/                   ← MC 游戏文件
    ├── versions/
    ├── libraries/
    ├── mods/
    └── ...
```

---

## 编译方式

JDK 通过 Docker + OpenHarmony NDK 交叉编译：

```bash
# JDK 17
docker exec ohos-debug bash /build/build_jdk17_ohos.sh

# JDK 21
docker exec ohos-debug bash /build/build_jdk21_ohos.sh
```

输出：`/output/jdk{17,21}-ohos-full.zip`。

完整编译流程见 AMCL 主仓：

- `docs/BUILD_INSTRUCTIONS.md` —— 编译指南
- `docs/JDK_ADAPTATION_GUIDE.md` —— OHOS 适配技术细节
- `prebuilt/jdk/{17,21}/README.md` —— 各版本现状

### 关键 configure 参数

```
--openjdk-target=aarch64-unknown-linux-musl
--with-jvm-variants=server
--enable-headless-only          # 跳过 libawt_xawt.so / libsplashscreen.so
--with-freetype=bundled
--disable-warnings-as-errors
--with-toolchain-type=clang
```

### 上游 base

| JDK | 仓库 | tag | commit |
|---|---|---|---|
| 17 | `https://github.com/openjdk/jdk17u.git` | `jdk-17.0.13+11` | （见 AMCL 仓 `deps.lock [openjdk]`） |
| 21 | `https://github.com/openjdk/jdk21u.git` | `jdk-21.0.5+11` | `dfcd8d2eecfe` |

---

## 许可证

OpenJDK 17 / 21 — GPLv2 with Classpath Exception

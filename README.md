# MC-OHOS 资源仓库

为 HarmonyOS NEXT 预编译的 OpenJDK 17 资源，用于在鸿蒙设备上运行 Minecraft Java 版。

配合 [MC-OHOS 启动器（amcl）](https://github.com/LZZLHY/amcl) 使用。

---

## 可用版本

| JDK 版本 | 标签 | 支持的 MC 版本 | 状态 |
|---|---|---|---|
| **JDK 17** | `v17.0.13-ohos-4` | 1.17 ~ 1.20.4 | ✅ 当前推荐 |

> **JDK 21 暂不维护**：现网 MC 1.20.5+ 用户量极少，且 OHOS 上 G1 GC 在 musl 环境
> 下还有兼容性问题待解。等用户基数到位再重启。
>
> **JDK 17 v3 / v3 之前已废弃**：v3 使用 `MEM_PROT_NONE` safepoint，在 OHOS 上
> 触发 SIGSEGV 自陷不可恢复；v4 已改为 `MEM_PROT_READ` 全量解决，**v3 / v2 / v1
> 不应再使用**。

---

## .so 文件清单（与标准 Linux JDK 17 aarch64 对照）

OpenJDK 17 标准 Linux 版本一共 39 个 `.so`。OHOS v4 包含 **36 个**，缺失的 3 个均为
不影响 Minecraft 运行的非核心组件。

### ✅ 已包含（36 个）

#### JVM 核心

| .so | 大小 | 用途 |
|---|---|---|
| `lib/server/libjvm.so` | 23 MB | HotSpot Server JVM |
| `libjli.so` | 64 KB | Java Launcher Interface |
| `libjsig.so` | 12 KB | 信号链处理 |
| `libjava.so` | 204 KB | java.* 核心 native |
| `libjimage.so` | 35 KB | jimage 容器（lib/modules） |
| `libverify.so` | 60 KB | 字节码验证器 |
| `libsyslookup.so` | 6 KB | 系统符号查找 |

#### IO / 网络

| .so | 大小 | 用途 |
|---|---|---|
| `libnio.so` | 103 KB | NIO direct buffer / socket channel |
| `libnet.so` | 106 KB | java.net.* native |
| `libzip.so` | 38 KB | ZIP / JAR 处理 |
| `libextnet.so` | 13 KB | 扩展网络选项（SO_REUSEPORT 等） |
| `libsctp.so` | 27 KB | SCTP 协议（MC 不用，保留兼容） |

#### 加密 / 安全

| .so | 大小 | 用途 |
|---|---|---|
| `libj2pkcs11.so` | 94 KB | PKCS#11 加密接口 |
| `libj2gss.so` | 48 KB | GSS-API（Kerberos） |
| `libj2pcsc.so` | 19 KB | 智能卡 |
| `libjaas.so` | 9 KB | JAAS 认证 |
| `libsaproc.so` | 67 KB | Serviceability Agent |

#### 2D 图形 / 字体

| .so | 大小 | 用途 |
|---|---|---|
| `libawt.so` | 693 KB | AWT 核心 |
| `libawt_headless.so` | 39 KB | 无头 AWT 后端 |
| `libjawt.so` | 7 KB | JAWT 桥接（LWJGL 偶尔用） |
| `libfontmanager.so` | 1.4 MB | 字体管理 |
| `libfreetype.so` | 687 KB | TrueType 渲染（中文字体必需） |
| `libfontconfig.so.1` | — | 系统字体查找（自编译，注入） |
| `libexpat.so.1` | — | XML 解析（fontconfig 依赖） |
| `libjavajpeg.so` | 220 KB | JPEG 编解码 |
| `liblcms.so` | 424 KB | 色彩管理（LittleCMS） |
| `libmlib_image.so` | 433 KB | 图像变换 mediaLib |

#### 音频（MC 走 OpenAL，下面这个仅留作 javax.sound API 兼容）

| .so | 大小 | 用途 |
|---|---|---|
| `libjsound.so` | 93 KB | javax.sound 裸接口 |

#### 监控 / 调试 / Agent

| .so | 大小 | 用途 |
|---|---|---|
| `libmanagement.so` | 26 KB | JMX 核心 |
| `libmanagement_ext.so` | 31 KB | JMX 扩展 |
| `libmanagement_agent.so` | 8 KB | JMX agent |
| `libinstrument.so` | 52 KB | java.lang.instrument |
| `libjdwp.so` | 282 KB | JDWP 调试协议 |
| `libdt_socket.so` | 29 KB | JDWP socket transport |
| `libattach.so` | 12 KB | Attach API |
| `libprefs.so` | 9 KB | Preferences API |
| `librmi.so` | 7 KB | RMI |

#### 其他

| .so | 大小 | 用途 |
|---|---|---|
| `libcxxabi_shim.so` | 14 KB | OHOS musl libc++ ABI 桥（自编译注入） |

### ❌ 缺失（3 个，但 MC 不需要）

| .so | 用途 | 为什么没有 | 对 MC 影响 |
|---|---|---|---|
| **`libawt_xawt.so`** | AWT X11 GUI 后端 | OHOS 没有 X11 server，编出来也没法 `XOpenDisplay`；`--enable-headless-only` 跳过 | **无影响** — 启动器 JVM 启动参数 `-Djava.awt.headless=true` + Cacio AWT (`cacio-tta.jar`) 已覆盖 |
| `libsplashscreen.so` | JVM `-splash:` 启动闪屏 | `--enable-headless-only` 跳过 | **无影响** — MC / 启动器都不用 splash |
| `libjsound_alsa.so` | ALSA 音频后端 | OHOS 不基于 ALSA | **无影响** — MC 通过 LWJGL OpenAL 直接走系统音频，不经过 javax.sound |

---

## MC + Mod 兼容性评估

v4 对 Minecraft 客户端 + 主流 mod（Sodium / Iris / JEI / Create / OptiFine /
WorldEdit / Distant Horizons 等）功能性完备。

可能踩坑的场景**都不在 JDK 这层**：

| 失败模式 | 原因 |
|---|---|
| Mod 自带 x86_64 / glibc `.so` | ABI / libc 不匹配，需要 mod 提供 aarch64 musl 版本 |
| Mod 用 `Runtime.exec()` 启动外部进程 | OHOS 沙箱限制 |
| Mod 弹 Swing 配置窗 | 启动器侧 `-Djava.awt.headless=true` 拦截，配置 mod 自己处理 |
| Mod 读 `/proc`、`/sys/class` | OHOS 沙箱限制 |
| Mod 用 JNA `libjnidispatch.so` | JNA 默认 aarch64 是 glibc，OHOS 是 musl，需替换 |

---

## Release 文件说明

| 文件 | 大小 | 内容 | 用途 |
|---|---|---|---|
| `jdk17-ohos-full-v4.zip` | ~95 MB | 完整 JDK 17 数据：`lib/`（含 36 个 .so）、`conf/`、`release` | 解压到 `filesDir/jdk/17/` |

> **设计取舍**：早期版本曾把 `.so` 与数据分开（`.so` 入 HAP，数据走 Release）。
> v4 改为完整包，因为 HarmonyOS 代码签名机制下 `.so` 必须随 HAP 分发。
> 当前部署做法：`scripts/sync_prebuilt.sh` 把 zip 内 `.so` 同步到 `entry/libs/arm64-v8a/`，
> 数据部分仍走 Release。

---

## 工作原理

1. 用户安装 MC-OHOS 启动器（HAP 包含所有 `.so`）
2. 首次启动 JDK 管理面板提示下载 JDK 数据
3. 从 GitHub Releases 下载 `jdk17-ohos-full-v4.zip`（支持镜像加速）
4. 解压到 `filesDir/jdk/17/`
5. JVM 用 HAP 内 `.so` + Release 数据启动

## 设备沙箱目录结构

```
filesDir/
├── jdk/
│   └── 17/                       ← JDK 17 数据（MC 1.17 ~ 1.20.4）
│       ├── lib/
│       │   ├── modules           ← jimage 容器，所有 java 类
│       │   ├── server/libjvm.so
│       │   ├── security/cacerts
│       │   └── *.so              ← 36 个 native lib
│       ├── conf/
│       └── release
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
cd docker/
docker build -f Dockerfile.openjdk-ohos -t ohos-jdk .
docker run --name ohos-debug ohos-jdk bash /build/build_jdk17_ohos.sh
bash scripts/pack_jdk_split.sh 17
```

### 关键 configure 参数

```
--openjdk-target=aarch64-unknown-linux-musl
--with-jvm-variants=server
--enable-headless-only          # 跳过 libawt_xawt.so / libsplashscreen.so
--with-freetype=bundled
--disable-warnings-as-errors
--with-toolchain-type=clang
```

### HotSpot 关键 patch（v4 的 8 个修改）

| Patch | 解决问题 |
|---|---|
| `icache_patch.hpp` | OHOS musl 没 `__clear_cache`，用 ARM64 汇编替代 |
| `safepointMechanism.cpp` | `MEM_PROT_NONE` → `MEM_PROT_READ`（核心）|
| `globals_aarch64.hpp` | ImplicitNullChecks 默认关 |
| `assembler.cpp` | `needs_explicit_null_check` 永真 |
| `signals_posix.cpp` | `javaSignalHandler abort_if_unrecognized=false` |
| `patch_java_home.py` | `JAVA_HOME` 环境变量设置 java.home |
| `patch_dll_dir.py` | `SUN_BOOT_LIBRARY_PATH` 设置 dll_dir |

---

## 许可证

OpenJDK 17 — GPLv2 with Classpath Exception

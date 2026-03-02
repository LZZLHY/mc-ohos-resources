# MC-OHOS 资源仓库

为 HarmonyOS NEXT 预编译的 OpenJDK 和 LWJGL 原生库，用于在鸿蒙设备上运行 Minecraft Java 版。

配合 [MC-OHOS 启动器](https://github.com/LZZLHY/MyApplication) 使用。

## 可用版本

| JDK 版本 | 标签 | 支持的 MC 版本 | 状态 |
|----------|------|----------------|------|
| JDK 17 | v17.0.13-ohos-1 | 1.17 ~ 1.20.4 | ✅ 可用 |
| JDK 21 | v21.0.5-ohos-1 | 1.20.5+ | ✅ 可用 |

## Release 文件说明

每个 JDK 版本的 Release 包含以下文件：

| 文件 | 大小 | 内容 | 用途 |
|------|------|------|------|
| **jdkXX-data.zip** | ~66-97 MB | JDK 数据文件（`lib/modules`、`conf/` 等） | 解压到 `filesDir/jdk/<version>/` |

> **注意**：`.so` 原生库文件随 HAP 打包（HarmonyOS 代码签名限制，无法 dlopen 下载的 .so 文件）

## 工作原理

1. 用户安装 MC-OHOS 启动器（HAP 包含所有 `.so` 文件）
2. 首次启动时，JDK 管理面板提示用户下载 JDK 数据
3. 从 GitHub Releases 下载 `jdkXX-data.zip`（支持镜像加速）
4. 解压到 `filesDir/jdk/<version>/`
5. JVM 使用 HAP 中的 `.so` 文件 + 下载的数据文件启动

## 设备沙箱目录结构

```
filesDir/
  jdk/
    17/                    ← JDK 17 数据（MC 1.17~1.20.4）
      lib/modules
      conf/
      ...
    21/                    ← JDK 21 数据（MC 1.20.5+）
      lib/modules
      conf/
      ...
  .minecraft/              ← Minecraft 游戏文件
```

## 多版本 JDK 支持

MC-OHOS 支持多版本 JDK 并存：

- **JDK 17**：适用于 Minecraft 1.17 ~ 1.20.4
- **JDK 21**：适用于 Minecraft 1.20.5+

`.so` 文件使用版本后缀区分：
- JDK 17: `libjvm.so`, `libjava.so`, ...
- JDK 21: `libjvm21.so`, `libjava21.so`, ...

## 编译说明

JDK 使用 Docker 交叉编译：

```bash
# 构建 Docker 镜像
cd docker/
docker build -f Dockerfile.openjdk-ohos -t ohos-jdk .

# 编译 JDK 17
docker run --name ohos-debug ohos-jdk bash /build/build_jdk17_ohos.sh

# 编译 JDK 21
docker exec ohos-debug bash /build/build_jdk21_ohos.sh

# 打包
bash scripts/pack_jdk_split.sh 17
bash scripts/pack_jdk_split.sh 21
```

## 许可证

- OpenJDK: GPL v2 with Classpath Exception
- LWJGL: BSD 3-Clause

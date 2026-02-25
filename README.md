# mc-ohos-resources

Cloud resource repository for MC-OHOS — pre-compiled native libraries and JDK data for running Minecraft Java Edition on HarmonyOS NEXT.

Used by [MC-OHOS](https://github.com/LZZLHY/MyApplication) launcher. The HAP only ships `libentry.so`; all other native dependencies are downloaded on first launch.

## Available Versions

| JDK Version | Tag | MC Versions | Status |
|---|---|---|---|
| 17 | v17.0.13-ohos-1 | 1.17 ~ 1.20.4 | ✅ Available |
| 21 | v21.0.1-ohos-1 | 1.20.5+ | 🔜 Planned |

## Release Files (per JDK version)

Each release contains **3 packages**:

| File | Size | Contents | Extract To |
|---|---|---|---|
| **jdkXX-ohos-data.zip** | ~97 MB | JDK data (`lib/modules`, `conf/`, etc.) | `filesDir/jdk/<version>/` |
| **jdkXX-ohos-libs.zip** | ~9 MB | JDK native `.so` (`libjvm.so`, etc.) | `filesDir/libs/` |
| **lwjgl-ohos-libs.zip** | ~0.4 MB | LWJGL native `.so` (shared across all versions) | `filesDir/libs/` |

## How It Works

1. User installs MC-OHOS (HAP ~3 MB, only contains `libentry.so`)
2. On first launch, the JDK Management panel prompts user to download
3. Three packages are downloaded in order: LWJGL libs → JDK libs → JDK data
4. All `.so` files extracted to `filesDir/libs/`, JDK data to `filesDir/jdk/<version>/`
5. Native layer loads `.so` from `filesDir/libs/` via `dlopen()`
6. JVM is initialized with the downloaded JDK data

## Device Sandbox Layout

```
filesDir/
  libs/                    ← All .so files (JDK + LWJGL)
    libjvm.so
    libjli.so
    liblwjgl.so
    liblwjgl_opengl.so
    ...
  jdk/
    17/                    ← JDK 17 data (MC 1.17~1.20.4)
      lib/modules
      conf/
      ...
    21/                    ← JDK 21 data (MC 1.20.5+, future)
      lib/modules
      ...
  .minecraft/              ← Minecraft game files
```

## Build

JDK is cross-compiled from OpenJDK source using Docker:

```bash
cd docker/
docker build -f Dockerfile.openjdk-ohos -t ohos-jdk17 .
docker run --name ohos-debug ohos-jdk17 bash /build/build_jdk17_ohos.sh
bash scripts/pack_jdk_release.sh 17 v17.0.13-ohos-1
```

## License

OpenJDK is licensed under GPL v2 with Classpath Exception.
LWJGL is licensed under BSD 3-Clause.

# mc-ohos-jdk

Pre-compiled OpenJDK for HarmonyOS NEXT (aarch64-linux-musl).

Used by [MC-OHOS](https://github.com/LZZLHY/MyApplication) launcher for running Minecraft Java Edition on HarmonyOS devices.

## Available Versions

| JDK Version | Tag | MC Versions | Status |
|---|---|---|---|
| 17 | v17.0.13-ohos-1 | 1.17 ~ 1.20.4 | ✅ Available |
| 21 | v21.0.1-ohos-1 | 1.20.5+ | 🔜 Planned |

## Release Files

Each release contains:

- **jdkXX-ohos-data.zip** — JDK data files (`lib/modules`, `conf/`, etc.)
- **jdkXX-ohos-libs.zip** — Native shared libraries (`libjvm.so`, etc.)

## How It Works

1. MC-OHOS launcher downloads the appropriate JDK version based on the Minecraft version
2. Files are extracted to the app sandbox: `filesDir/jdk/<version>/`
3. The embedded JVM is initialized using the downloaded JDK data

## Build

JDK is cross-compiled from OpenJDK source using Docker:

```bash
cd docker/
docker build -f Dockerfile.openjdk-ohos -t ohos-jdk17 .
docker run --name ohos-debug ohos-jdk17 bash /build/build_jdk17_ohos.sh
```

## License

OpenJDK is licensed under GPL v2 with Classpath Exception.

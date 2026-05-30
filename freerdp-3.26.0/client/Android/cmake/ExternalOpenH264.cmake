include(ExternalProject)

set(OPENH264_VERSION "v2.6.0")

# Map Android ABI to OpenH264 architecture names
if(ANDROID_ABI STREQUAL "arm64-v8a")
  set(O264_ARCH "arm64")
elseif(ANDROID_ABI STREQUAL "armeabi-v7a")
  set(O264_ARCH "arm")
elseif(ANDROID_ABI STREQUAL "x86_64")
  set(O264_ARCH "x86_64")
elseif(ANDROID_ABI STREQUAL "x86")
  set(O264_ARCH "x86")
else()
  message(FATAL_ERROR "ExternalOpenH264: unsupported ABI '${ANDROID_ABI}'")
endif()

ExternalProject_Add(
  openh264
  SOURCE_DIR ${CMAKE_SOURCE_DIR}/external/openh264
  URL https://github.com/cisco/openh264/archive/refs/tags/${OPENH264_VERSION}.tar.gz
  URL_HASH SHA256=558544ad358283a7ab2930d69a9ceddf913f4a51ee9bf1bfb9e377322af81a69
  CONFIGURE_COMMAND ""
  BUILD_COMMAND
    ${CMAKE_COMMAND} -E env "PATH=${NDK_ROOT}:$ENV{PATH}" make -C <SOURCE_DIR> ENABLEPIC=Yes LDFLAGS=-static-libstdc++
    OS=android NDKROOT=${NDK_ROOT} NDK_TOOLCHAIN_VERSION=clang TARGET=android-${NDK_API_LEVEL} NDKLEVEL=${NDK_API_LEVEL}
    ARCH=${O264_ARCH} -j libraries
  INSTALL_COMMAND
    ${CMAKE_COMMAND} -E env "PATH=${NDK_ROOT}:$ENV{PATH}" make -C <SOURCE_DIR> install OS=android NDKROOT=${NDK_ROOT}
    NDK_TOOLCHAIN_VERSION=clang TARGET=android-${NDK_API_LEVEL} NDKLEVEL=${NDK_API_LEVEL} ARCH=${O264_ARCH}
    PREFIX=${DEPS_INSTALL_DIR}
)

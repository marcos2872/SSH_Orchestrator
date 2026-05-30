cmake_minimum_required(VERSION 3.13)
project(rdp-bridge C)

set(CMAKE_C_STANDARD 11)

# Detectar diretório FreeRDP (freerdp-*) automaticamente
file(GLOB FREERDP_DIRS "${CMAKE_SOURCE_DIR}/../freerdp-*")
list(FILTER FREERDP_DIRS EXCLUDE REGEX ".*build.*")
list(GET FREERDP_DIRS 0 FREERDP_SOURCE_DIR)
set(FREERDP_BUILD_DIR "${FREERDP_SOURCE_DIR}/build")
message(STATUS "FreeRDP source: ${FREERDP_SOURCE_DIR}")
message(STATUS "FreeRDP build:  ${FREERDP_BUILD_DIR}")

# Binário principal
add_executable(rdp-bridge
    src/main.c
    src/protocol.c
    src/session.c
    src/display.c
    src/clipboard.c
    deps/cJSON/cJSON.c
)

# Include paths
target_include_directories(rdp-bridge PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/deps/cJSON
    # FreeRDP headers
    ${FREERDP_SOURCE_DIR}/include
    ${FREERDP_SOURCE_DIR}/winpr/include
    # Generated config headers
    ${FREERDP_BUILD_DIR}/include
    ${FREERDP_BUILD_DIR}/winpr/include
)

# FreeRDP static libraries (order matters for static linking)
target_link_libraries(rdp-bridge PRIVATE
    ${FREERDP_BUILD_DIR}/client/common/libfreerdp-client3.a
    ${FREERDP_BUILD_DIR}/libfreerdp/libfreerdp3.a
    ${FREERDP_BUILD_DIR}/winpr/libwinpr/libwinpr3.a
    ${FREERDP_BUILD_DIR}/winpr/tools/libwinpr-tools3.a
)

# System dependencies
find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)
find_package(ZLIB REQUIRED)
find_package(ICU COMPONENTS uc i18n data REQUIRED)

target_link_libraries(rdp-bridge PRIVATE
    OpenSSL::SSL
    OpenSSL::Crypto
    Threads::Threads
    ZLIB::ZLIB
    ICU::uc
    ICU::i18n
    ICU::data
    ${CMAKE_DL_LIBS}
    m
)

# Channel static libs (built by FreeRDP)
file(GLOB CHANNEL_LIBS "${FREERDP_BUILD_DIR}/channels/*/*.a" "${FREERDP_BUILD_DIR}/channels/*/*/*.a")
target_link_libraries(rdp-bridge PRIVATE ${CHANNEL_LIBS})

# Repetir libs FreeRDP para resolver dependências circulares em link estático
target_link_libraries(rdp-bridge PRIVATE
    ${FREERDP_BUILD_DIR}/client/common/libfreerdp-client3.a
    ${FREERDP_BUILD_DIR}/libfreerdp/libfreerdp3.a
    ${FREERDP_BUILD_DIR}/winpr/libwinpr/libwinpr3.a
)

target_compile_options(rdp-bridge PRIVATE -Wall -Wextra -Wno-unused-parameter)

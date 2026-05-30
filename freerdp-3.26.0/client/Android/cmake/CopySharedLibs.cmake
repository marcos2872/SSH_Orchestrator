# Copies only .so files from SRC_DIR to DST_DIR.
if(NOT IS_DIRECTORY "${SRC_DIR}")
  message(WARNING "CopySharedLibs: source dir '${SRC_DIR}' does not exist, skipping.")
  return()
endif()

file(GLOB_RECURSE SO_FILES "${SRC_DIR}/*.so")
if(SO_FILES)
  file(MAKE_DIRECTORY "${DST_DIR}")
  file(COPY ${SO_FILES} DESTINATION "${DST_DIR}")
  message(STATUS "CopySharedLibs: copied ${SO_FILES} -> ${DST_DIR}")
else()
  message(WARNING "CopySharedLibs: no .so files found in '${SRC_DIR}'")
endif()

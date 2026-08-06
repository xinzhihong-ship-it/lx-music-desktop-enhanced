{
  "targets": [
    {
      "target_name": "lx_mpv_video",
      "sources": ["mpv_video.mm"],
      "variables": {
        "mpv_prefix%": "/opt/homebrew/opt/mpv"
      },
      "include_dirs": ["<(mpv_prefix)/include"],
      "libraries": ["<(mpv_prefix)/lib/libmpv.dylib"],
      "defines": ["NAPI_VERSION=8", "GL_SILENCE_DEPRECATION=1"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.15",
        "OTHER_CFLAGS": ["-fobjc-arc"],
        "OTHER_LDFLAGS": ["-framework", "AppKit", "-framework", "QuartzCore"]
      }
    }
  ]
}

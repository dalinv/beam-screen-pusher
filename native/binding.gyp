{
  "targets": [
    {
      "target_name": "screen-capture",
      "sources": ["src/capture.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "libraries": ["winmm.lib"],
      "cflags_cc": ["-std=c++17", "-fexceptions"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/utf-8", "/EHsc"]
        }
      }
    }
  ]
}

{
  "targets": [
    {
      "target_name": "rochedb_native",
      "sources": ["native/rochedb_node.cc"],
      "include_dirs": [
        "<!(node -p \"const path=require('node:path'); const core=process.env.ROCHEDB_CORE_DIR || path.resolve(process.cwd(), '../ceresdb'); path.resolve(core, 'include')\")"
      ],
      "libraries": [
        "-L<!(node -p \"const path=require('node:path'); const core=process.env.ROCHEDB_CORE_DIR || path.resolve(process.cwd(), '../ceresdb'); path.resolve(process.env.ROCHEDB_LIB_DIR || path.resolve(core, 'lib'))\")",
        "-lrochedb"
      ],
      "cflags_cc": ["-std=c++17"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17"]
          }
        }]
      ]
    }
  ]
}

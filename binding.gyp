{
  "targets": [
    {
      "target_name": "koutendb_native",
      "sources": ["native/koutendb_node.cc"],
      "include_dirs": [
        "<!(node -p \"const path=require('node:path'); const core=process.env.KOUTENDB_CORE_DIR || path.resolve(process.cwd(), '../ceresdb'); path.resolve(core, 'include')\")"
      ],
      "libraries": [
        "-L<!(node -p \"const path=require('node:path'); const core=process.env.KOUTENDB_CORE_DIR || path.resolve(process.cwd(), '../ceresdb'); path.resolve(process.env.KOUTENDB_LIB_DIR || path.resolve(core, 'lib'))\")",
        "-lkoutendb"
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

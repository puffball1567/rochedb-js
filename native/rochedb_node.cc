#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#include <string>
#include <vector>

#include "rochedb.h"

namespace {

struct DbHandle {
  void *db;
};

napi_value Undefined(napi_env env) {
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}

napi_value Null(napi_env env) {
  napi_value v;
  napi_get_null(env, &v);
  return v;
}

void Throw(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
}

void ThrowLast(napi_env env) {
  const char *message = roche_last_error();
  Throw(env, message && message[0] ? message : "RocheDB C ABI error");
}

bool IsBuffer(napi_env env, napi_value value) {
  bool is_buffer = false;
  napi_is_buffer(env, value, &is_buffer);
  return is_buffer;
}

bool IsTypedArray(napi_env env, napi_value value) {
  bool is_typed_array = false;
  napi_is_typedarray(env, value, &is_typed_array);
  return is_typed_array;
}

bool IsNullOrUndefined(napi_env env, napi_value value) {
  napi_valuetype type;
  napi_typeof(env, value, &type);
  return type == napi_null || type == napi_undefined;
}

std::string StringArg(napi_env env, napi_value value) {
  size_t len = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &len);
  std::string s(len + 1, '\0');
  napi_get_value_string_utf8(env, value, s.data(), s.size(), &len);
  s.resize(len);
  return s;
}

int32_t IntArg(napi_env env, napi_value value) {
  int32_t out = 0;
  napi_get_value_int32(env, value, &out);
  return out;
}

double DoubleArg(napi_env env, napi_value value) {
  double out = 0.0;
  napi_get_value_double(env, value, &out);
  return out;
}

DbHandle *DbArg(napi_env env, napi_value value) {
  DbHandle *handle = nullptr;
  napi_get_value_external(env, value, reinterpret_cast<void **>(&handle));
  if (handle == nullptr || handle->db == nullptr) {
    Throw(env, "RocheDB handle is closed");
    return nullptr;
  }
  return handle;
}

roche_id IdArg(napi_env env, napi_value value) {
  roche_id id{};
  napi_value field;
  bool lossless = false;

  napi_get_named_property(env, value, "parent", &field);
  napi_get_value_bigint_uint64(env, field, &id.parent, &lossless);

  napi_get_named_property(env, value, "epoch", &field);
  uint32_t epoch = 0;
  napi_get_value_uint32(env, field, &epoch);
  id.epoch = epoch;

  napi_get_named_property(env, value, "seq", &field);
  uint32_t seq = 0;
  napi_get_value_uint32(env, field, &seq);
  id.seq = seq;

  napi_get_named_property(env, value, "tWrite", &field);
  napi_get_value_double(env, field, &id.t_write);

  return id;
}

napi_value IdObject(napi_env env, roche_id id) {
  napi_value obj;
  napi_create_object(env, &obj);

  napi_value parent;
  napi_create_bigint_uint64(env, id.parent, &parent);
  napi_set_named_property(env, obj, "parent", parent);

  napi_value epoch;
  napi_create_uint32(env, id.epoch, &epoch);
  napi_set_named_property(env, obj, "epoch", epoch);

  napi_value seq;
  napi_create_uint32(env, id.seq, &seq);
  napi_set_named_property(env, obj, "seq", seq);

  napi_value t_write;
  napi_create_double(env, id.t_write, &t_write);
  napi_set_named_property(env, obj, "tWrite", t_write);

  return obj;
}

void FinalizeDb(napi_env, void *data, void *) {
  DbHandle *handle = reinterpret_cast<DbHandle *>(data);
  if (handle != nullptr) {
    if (handle->db != nullptr) {
      roche_close(handle->db);
      handle->db = nullptr;
    }
    delete handle;
  }
}

napi_value ExternalDb(napi_env env, void *db) {
  if (db == nullptr) {
    ThrowLast(env);
    return nullptr;
  }
  DbHandle *handle = new DbHandle{db};
  napi_value external;
  napi_create_external(env, handle, FinalizeDb, nullptr, &external);
  return external;
}

struct BytesArg {
  const void *data = nullptr;
  size_t len = 0;
};

BytesArg DataArg(napi_env env, napi_value value, std::string &string_storage) {
  BytesArg out;
  if (IsBuffer(env, value)) {
    void *data = nullptr;
    size_t len = 0;
    napi_get_buffer_info(env, value, &data, &len);
    out.data = data;
    out.len = len;
    return out;
  }
  string_storage = StringArg(env, value);
  out.data = string_storage.data();
  out.len = string_storage.size();
  return out;
}

struct FloatVecArg {
  const float *data = nullptr;
  size_t len = 0;
};

FloatVecArg VecArg(napi_env env, napi_value value) {
  FloatVecArg out;
  if (IsTypedArray(env, value)) {
    napi_typedarray_type type;
    size_t len = 0;
    void *data = nullptr;
    napi_value array_buffer;
    size_t byte_offset = 0;
    napi_get_typedarray_info(env, value, &type, &len, &data, &array_buffer, &byte_offset);
    if (type != napi_float32_array) {
      Throw(env, "vector must be a Float32Array");
      return out;
    }
    out.data = reinterpret_cast<const float *>(data);
    out.len = len;
    return out;
  }
  Throw(env, "vector must be a Float32Array");
  return out;
}

napi_value Open(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  int nodes = argc > 0 ? IntArg(env, args[0]) : 8;
  return ExternalDb(env, roche_open(nodes));
}

napi_value OpenDir(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "openDir requires nodes and dir");
    return nullptr;
  }
  int nodes = IntArg(env, args[0]);
  std::string dir = StringArg(env, args[1]);
  return ExternalDb(env, roche_open_dir(nodes, dir.c_str()));
}

napi_value Connect(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    Throw(env, "connect requires peers");
    return nullptr;
  }
  std::string peers = StringArg(env, args[0]);
  return ExternalDb(env, roche_connect(peers.c_str()));
}

napi_value ConnectAuth(napi_env env, napi_callback_info info) {
  size_t argc = 6;
  napi_value args[6];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    Throw(env, "connectAuth requires peers");
    return nullptr;
  }
  std::string peers = StringArg(env, args[0]);
  std::string username = argc > 1 ? StringArg(env, args[1]) : "";
  std::string password = argc > 2 ? StringArg(env, args[2]) : "";
  std::string auth_token = argc > 3 ? StringArg(env, args[3]) : "";
  std::string secret_key = argc > 4 ? StringArg(env, args[4]) : "";
  std::string galaxy = argc > 5 ? StringArg(env, args[5]) : "";
  return ExternalDb(env, roche_connect_auth(peers.c_str(), username.c_str(),
                                            password.c_str(), auth_token.c_str(),
                                            secret_key.c_str(), galaxy.c_str()));
}

napi_value Close(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    Throw(env, "close requires db handle");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  roche_close(handle->db);
  handle->db = nullptr;
  return Undefined(env);
}

napi_value Put(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    Throw(env, "put requires db, ring, and data");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  std::string ring = StringArg(env, args[1]);
  std::string storage;
  BytesArg data = DataArg(env, args[2], storage);
  roche_id id{};
  int rc = ROCHE_ERR;
  if (argc >= 4) {
    FloatVecArg vec = VecArg(env, args[3]);
    if (vec.data == nullptr && vec.len == 0) return nullptr;
    rc = roche_put_vec(handle->db, ring.c_str(), data.data, data.len, vec.data, vec.len, &id);
  } else {
    rc = roche_put(handle->db, ring.c_str(), data.data, data.len, &id);
  }
  if (rc != ROCHE_OK) {
    ThrowLast(env);
    return nullptr;
  }
  return IdObject(env, id);
}

napi_value Get(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "get requires db and id");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  roche_id id = IdArg(env, args[1]);
  size_t len = 0;
  void *p = roche_get(handle->db, id, &len);
  if (p == nullptr) return Null(env);
  napi_value buf;
  napi_create_buffer_copy(env, len, p, nullptr, &buf);
  roche_free(p);
  return buf;
}

napi_value BatchGet(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "batchGet requires db and ids");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;

  bool is_array = false;
  napi_is_array(env, args[1], &is_array);
  if (!is_array) {
    Throw(env, "ids must be an array");
    return nullptr;
  }

  uint32_t len = 0;
  napi_get_array_length(env, args[1], &len);
  std::vector<roche_id> ids(len);
  for (uint32_t i = 0; i < len; ++i) {
    napi_value item;
    napi_get_element(env, args[1], i, &item);
    ids[i] = IdArg(env, item);
  }

  roche_batch_result *br = roche_batch_get(handle->db, ids.data(), ids.size());
  if (br == nullptr) {
    ThrowLast(env);
    return nullptr;
  }

  napi_value out;
  napi_create_array_with_length(env, br->len, &out);
  for (size_t i = 0; i < br->len; ++i) {
    if (br->values[i].data == nullptr) {
      napi_set_element(env, out, static_cast<uint32_t>(i), Null(env));
      continue;
    }
    napi_value buf;
    napi_create_buffer_copy(env, br->values[i].len, br->values[i].data, nullptr, &buf);
    napi_set_element(env, out, static_cast<uint32_t>(i), buf);
  }

  roche_batch_get_free(br);
  return out;
}

napi_value Query(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    Throw(env, "query requires db, id, and selection");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  roche_id id = IdArg(env, args[1]);
  std::string selection = StringArg(env, args[2]);
  size_t len = 0;
  void *p = roche_query(handle->db, id, selection.c_str(), &len);
  if (p == nullptr) {
    ThrowLast(env);
    return nullptr;
  }
  napi_value buf;
  napi_create_buffer_copy(env, len, p, nullptr, &buf);
  roche_free(p);
  return buf;
}

napi_value Retrieve(napi_env env, napi_callback_info info) {
  size_t argc = 6;
  napi_value args[6];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "retrieve requires db and vector");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  FloatVecArg vec = VecArg(env, args[1]);
  std::string ring = argc > 2 ? StringArg(env, args[2]) : "";
  int budget = argc > 3 ? IntArg(env, args[3]) : 8;
  int top_rings = argc > 4 ? IntArg(env, args[4]) : 0;
  int focus = argc > 5 ? IntArg(env, args[5]) : 0;
  roche_retrieve_result *rr = roche_retrieve(handle->db, vec.data, vec.len,
                                             ring.c_str(), budget, top_rings, focus);
  if (rr == nullptr) {
    ThrowLast(env);
    return nullptr;
  }

  napi_value out;
  napi_create_object(env, &out);
  napi_value hits;
  napi_create_array_with_length(env, rr->len, &hits);
  for (size_t i = 0; i < rr->len; ++i) {
    napi_value hit;
    napi_create_object(env, &hit);
    napi_set_named_property(env, hit, "id", IdObject(env, rr->hits[i].id));
    napi_value score;
    napi_create_double(env, rr->hits[i].score, &score);
    napi_set_named_property(env, hit, "score", score);
    napi_value payload;
    napi_create_buffer_copy(env, rr->hits[i].payload_len, rr->hits[i].payload,
                            nullptr, &payload);
    napi_set_named_property(env, hit, "payload", payload);
    napi_set_element(env, hits, static_cast<uint32_t>(i), hit);
  }
  napi_set_named_property(env, out, "hits", hits);

  napi_value stats;
  napi_create_object(env, &stats);
  auto set_i32 = [&](const char *name, int value) {
    napi_value v;
    napi_create_int32(env, value, &v);
    napi_set_named_property(env, stats, name, v);
  };
  set_i32("totalVectors", rr->total_vectors);
  set_i32("scanned", rr->scanned);
  set_i32("skippedVectors", rr->skipped_vectors);
  set_i32("returned", rr->returned);
  set_i32("ringsTouched", rr->rings_touched);
  set_i32("payloadBytes", rr->payload_bytes);
  set_i32("estimatedTokens", rr->estimated_tokens);
  set_i32("fanoutNodes", rr->fanout_nodes);
  napi_value reduction;
  napi_create_double(env, rr->candidate_reduction, &reduction);
  napi_set_named_property(env, stats, "candidateReduction", reduction);
  napi_set_named_property(env, out, "stats", stats);
  roche_retrieve_free(rr);
  return out;
}

napi_value Atlas(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    Throw(env, "atlas requires db");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  const float *vec_data = nullptr;
  size_t vec_len = 0;
  if (argc > 1 && !IsNullOrUndefined(env, args[1])) {
    FloatVecArg vec = VecArg(env, args[1]);
    vec_data = vec.data;
    vec_len = vec.len;
  }
  int max_dims = argc > 2 ? IntArg(env, args[2]) : 8;
  size_t len = 0;
  void *p = roche_atlas(handle->db, vec_data, vec_len, max_dims, &len);
  if (p == nullptr) {
    ThrowLast(env);
    return nullptr;
  }
  napi_value str;
  napi_create_string_utf8(env, reinterpret_cast<const char *>(p), len, &str);
  roche_free(p);
  return str;
}

napi_value Locate(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "locate requires db and id");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  roche_id id = IdArg(env, args[1]);
  double at = argc > 2 ? DoubleArg(env, args[2]) : -1.0;
  int node = roche_locate(handle->db, id, at);
  napi_value out;
  napi_create_int32(env, node, &out);
  return out;
}

napi_value Now(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    Throw(env, "now requires db");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  napi_value out;
  napi_create_double(env, roche_now(handle->db), &out);
  return out;
}

napi_value Advance(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "advance requires db and dt");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  roche_advance(handle->db, DoubleArg(env, args[1]));
  return Undefined(env);
}

napi_value NextVisit(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    Throw(env, "nextVisit requires db, id, and node");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  roche_id id = IdArg(env, args[1]);
  int node = IntArg(env, args[2]);
  napi_value out;
  napi_create_double(env, roche_next_visit(handle->db, id, node), &out);
  return out;
}

napi_value NextJoin(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    Throw(env, "nextJoin requires db and two ids");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  roche_id a = IdArg(env, args[1]);
  roche_id b = IdArg(env, args[2]);
  napi_value out;
  napi_create_double(env, roche_next_join(handle->db, a, b), &out);
  return out;
}

napi_value ConfigureRing(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    Throw(env, "configureRing requires db, ring, and period");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  std::string ring = StringArg(env, args[1]);
  double period = DoubleArg(env, args[2]);
  if (roche_ring_configure(handle->db, ring.c_str(), period) != ROCHE_OK) {
    ThrowLast(env);
    return nullptr;
  }
  return Undefined(env);
}

napi_value SetGalaxyDescription(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "setGalaxyDescription requires db and description");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  std::string description = StringArg(env, args[1]);
  if (roche_set_galaxy_description(handle->db, description.c_str()) != ROCHE_OK) {
    ThrowLast(env);
    return nullptr;
  }
  return Undefined(env);
}

napi_value SetRingDescription(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    Throw(env, "setRingDescription requires db, ring, and description");
    return nullptr;
  }
  DbHandle *handle = DbArg(env, args[0]);
  if (handle == nullptr) return nullptr;
  std::string ring = StringArg(env, args[1]);
  std::string description = StringArg(env, args[2]);
  if (roche_set_ring_description(handle->db, ring.c_str(), description.c_str()) != ROCHE_OK) {
    ThrowLast(env);
    return nullptr;
  }
  return Undefined(env);
}

napi_value Init(napi_env env, napi_value exports) {
  roche_init();
  napi_property_descriptor props[] = {
    {"open", nullptr, Open, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openDir", nullptr, OpenDir, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"connect", nullptr, Connect, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"connectAuth", nullptr, ConnectAuth, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"close", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"put", nullptr, Put, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"get", nullptr, Get, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"batchGet", nullptr, BatchGet, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"query", nullptr, Query, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"retrieve", nullptr, Retrieve, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"atlas", nullptr, Atlas, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"locate", nullptr, Locate, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"now", nullptr, Now, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"advance", nullptr, Advance, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"nextVisit", nullptr, NextVisit, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"nextJoin", nullptr, NextJoin, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"configureRing", nullptr, ConfigureRing, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setGalaxyDescription", nullptr, SetGalaxyDescription, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setRingDescription", nullptr, SetRingDescription, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)

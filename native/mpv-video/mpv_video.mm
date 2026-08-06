#include <node_api.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>

#import <AppKit/AppKit.h>
#import <OpenGL/gl.h>
#import <OpenGL/OpenGL.h>

#include <cstdint>
#include <cstring>
#include <dlfcn.h>
#include <string>
#include <thread>
#include <vector>

mpv_handle *player = nullptr;
mpv_render_context *renderContext = nullptr;
__strong NSOpenGLView *videoView = nil;
std::string pendingAudioUrl;
napi_env callbackEnv = nullptr;
napi_ref doubleClickCallback = nullptr;

void notifyDoubleClick();

void *getOpenGLProcAddress(void *, const char *name) {
  return dlsym(RTLD_DEFAULT, name);
}

@interface MpvVideoView : NSOpenGLView
@end

@implementation MpvVideoView
- (instancetype)initWithFrame:(NSRect)frame {
  NSOpenGLPixelFormatAttribute attributes[] = {
      NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
      NSOpenGLPFAColorSize, 24,
      NSOpenGLPFAAlphaSize, 8,
      NSOpenGLPFADoubleBuffer,
      NSOpenGLPFADepthSize, 0,
      0,
  };
  NSOpenGLPixelFormat *format = [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
  self = [super initWithFrame:frame pixelFormat:format];
  if (self) {
    self.wantsBestResolutionOpenGLSurface = YES;
    GLint swapInterval = 1;
    [self.openGLContext setValues:&swapInterval forParameter:NSOpenGLContextParameterSwapInterval];
  }
  return self;
}

- (BOOL)isOpaque {
  return YES;
}

- (void)prepareOpenGL {
  [super prepareOpenGL];
  [self.openGLContext makeCurrentContext];
  glClearColor(0, 0, 0, 1);
}

- (void)drawRect:(NSRect)dirtyRect {
  [self.openGLContext makeCurrentContext];
  const NSRect bounds = self.bounds;
  const CGFloat scale = self.window.backingScaleFactor > 0 ? self.window.backingScaleFactor : 1;
  const int width = static_cast<int>(bounds.size.width * scale);
  const int height = static_cast<int>(bounds.size.height * scale);
  glViewport(0, 0, width, height);
  glClear(GL_COLOR_BUFFER_BIT);
  if (renderContext && width > 0 && height > 0) {
    mpv_opengl_fbo fbo = {0, width, height, 0};
    int flipY = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
        {MPV_RENDER_PARAM_FLIP_Y, &flipY},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    mpv_render_context_render(renderContext, params);
  }
  [self.openGLContext flushBuffer];
}

- (void)mouseDown:(NSEvent *)event {
  if (event.clickCount >= 2) notifyDoubleClick();
  [super mouseDown:event];
}
@end

void requestRenderUpdate(void *) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (videoView) [videoView setNeedsDisplay:YES];
  });
}

void notifyDoubleClick() {
  if (!doubleClickCallback || !callbackEnv) return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(callbackEnv, &scope) != napi_ok) return;
  napi_value callback;
  napi_value global;
  napi_value result;
  if (napi_get_reference_value(callbackEnv, doubleClickCallback, &callback) == napi_ok &&
      napi_get_global(callbackEnv, &global) == napi_ok) {
    napi_call_function(callbackEnv, global, callback, 0, nullptr, &result);
  }
  napi_close_handle_scope(callbackEnv, scope);
}

namespace {

napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

napi_value ok(napi_env env) {
  napi_value value;
  napi_get_undefined(env, &value);
  return value;
}

bool getString(napi_env env, napi_value value, std::string &result) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  result.resize(length + 1);
  const bool success = napi_get_value_string_utf8(env, value, result.data(), result.size(), &length) == napi_ok;
  result.resize(length);
  return success;
}

bool getNamedValue(napi_env env, napi_value object, const char *name, napi_value &value) {
  napi_value key;
  if (napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &key) != napi_ok) return false;
  bool has = false;
  if (napi_has_property(env, object, key, &has) != napi_ok || !has) return false;
  return napi_get_property(env, object, key, &value) == napi_ok;
}

void setHeaderList(const std::vector<std::string> &headers) {
  if (!player) return;
  std::vector<mpv_node> values(headers.size());
  for (size_t i = 0; i < headers.size(); i++) {
    values[i].format = MPV_FORMAT_STRING;
    values[i].u.string = const_cast<char *>(headers[i].c_str());
  }
  mpv_node_list list;
  list.num = static_cast<int>(values.size());
  list.values = values.empty() ? nullptr : values.data();
  mpv_node value;
  value.format = MPV_FORMAT_NODE_ARRAY;
  value.u.list = &list;
  mpv_set_property(player, "http-header-fields", MPV_FORMAT_NODE, &value);
}

void removeView() {
  if (videoView) {
    [videoView removeFromSuperview];
    videoView = nil;
  }
}

void clearDoubleClickCallback() {
  if (doubleClickCallback && callbackEnv) napi_delete_reference(callbackEnv, doubleClickCallback);
  doubleClickCallback = nullptr;
  callbackEnv = nullptr;
}

void destroyPlayer() {
  if (renderContext) {
    [videoView.openGLContext makeCurrentContext];
    mpv_render_context_free(renderContext);
    renderContext = nullptr;
  }
  if (player) {
    mpv_handle *handle = player;
    player = nullptr;
    const char *quit[] = {"quit", nullptr};
    mpv_command(handle, quit);
    std::thread([handle]() { mpv_terminate_destroy(handle); }).detach();
  }
  pendingAudioUrl.clear();
  clearDoubleClickCallback();
  removeView();
}

napi_value create(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) {
    return fail(env, "mpv video parent handle is required");
  }

  void *rawHandle = nullptr;
  size_t handleLength = 0;
  if (napi_get_buffer_info(env, argv[0], &rawHandle, &handleLength) != napi_ok || handleLength < sizeof(uintptr_t)) {
    return fail(env, "invalid macOS native window handle");
  }

  uintptr_t handleValue = 0;
  std::memcpy(&handleValue, rawHandle, sizeof(handleValue));
  NSView *parentView = (__bridge NSView *)(void *)handleValue;
  if (!parentView) return fail(env, "macOS native window handle is empty");

  destroyPlayer();

  if (argc >= 2) {
    napi_valuetype callbackType;
    if (napi_typeof(env, argv[1], &callbackType) == napi_ok && callbackType == napi_function) {
      callbackEnv = env;
      napi_create_reference(env, argv[1], 1, &doubleClickCallback);
    }
  }

  videoView = [[MpvVideoView alloc] initWithFrame:parentView.bounds];
  videoView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [parentView addSubview:videoView positioned:NSWindowAbove relativeTo:nil];

  player = mpv_create();
  if (!player) {
    removeView();
    return fail(env, "mpv_create failed");
  }

  mpv_set_option_string(player, "config", "no");
  mpv_set_option_string(player, "terminal", "no");
  mpv_set_option_string(player, "idle", "yes");
  mpv_set_option_string(player, "vo", "libmpv");
  mpv_set_option_string(player, "gpu-api", "opengl");
  mpv_set_option_string(player, "audio-display", "no");
  mpv_set_option_string(player, "keepaspect", "yes");
  mpv_set_option_string(player, "hr-seek", "yes");
  mpv_set_option_string(player, "pause", "yes");
  mpv_set_option_string(player, "osd-level", "0");

  const int initResult = mpv_initialize(player);
  if (initResult < 0) {
    destroyPlayer();
    return fail(env, mpv_error_string(initResult));
  }

  [videoView.openGLContext makeCurrentContext];
  const char *apiType = MPV_RENDER_API_TYPE_OPENGL;
  mpv_opengl_init_params glInit = {getOpenGLProcAddress, nullptr};
  mpv_render_param renderParams[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(apiType)},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
      {MPV_RENDER_PARAM_INVALID, nullptr},
  };
  const int renderResult = mpv_render_context_create(&renderContext, player, renderParams);
  if (renderResult < 0) {
    destroyPlayer();
    return fail(env, mpv_error_string(renderResult));
  }
  mpv_render_context_set_update_callback(renderContext, requestRenderUpdate, nullptr);

  mpv_observe_property(player, 1, "time-pos", MPV_FORMAT_DOUBLE);
  mpv_observe_property(player, 2, "duration", MPV_FORMAT_DOUBLE);
  mpv_observe_property(player, 3, "pause", MPV_FORMAT_FLAG);

  return ok(env);
}

napi_value load(napi_env env, napi_callback_info info) {
  if (!player) return fail(env, "mpv video is not initialized");
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) {
    return fail(env, "mpv video load parameters are required");
  }

  napi_value value;
  std::string videoUrl;
  if (!getNamedValue(env, argv[0], "videoUrl", value) || !getString(env, value, videoUrl) || videoUrl.empty()) {
    return fail(env, "mpv video URL is required");
  }

  pendingAudioUrl.clear();
  if (getNamedValue(env, argv[0], "audioUrl", value)) {
    getString(env, value, pendingAudioUrl);
  }

  std::vector<std::string> headers;
  if (getNamedValue(env, argv[0], "headers", value)) {
    bool isArray = false;
    if (napi_is_array(env, value, &isArray) == napi_ok && isArray) {
      uint32_t length = 0;
      napi_get_array_length(env, value, &length);
      headers.reserve(length);
      for (uint32_t i = 0; i < length; i++) {
        napi_value item;
        std::string header;
        if (napi_get_element(env, value, i, &item) == napi_ok && getString(env, item, header) && !header.empty()) {
          headers.push_back(header);
        }
      }
    }
  }
  setHeaderList(headers);

  const char *command[] = {"loadfile", videoUrl.c_str(), "replace", nullptr};
  const int result = mpv_command(player, command);
  if (result < 0) return fail(env, mpv_error_string(result));
  return ok(env);
}

napi_value command(napi_env env, napi_callback_info info) {
  if (!player) return fail(env, "mpv video is not initialized");
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) {
    return fail(env, "mpv video command is required");
  }
  napi_value value;
  if (!getNamedValue(env, argv[0], "name", value)) return fail(env, "mpv video command name is required");
  std::string name;
  if (!getString(env, value, name)) return fail(env, "invalid mpv video command name");

  if (name == "audio-add") {
    if (pendingAudioUrl.empty()) return ok(env);
    const char *args[] = {"audio-add", pendingAudioUrl.c_str(), "select", nullptr};
    const int result = mpv_command(player, args);
    if (result < 0) return fail(env, mpv_error_string(result));
    return ok(env);
  }
  if (name == "play" || name == "pause" || name == "stop") {
    if (name == "stop") {
      const char *args[] = {"stop", nullptr};
      const int result = mpv_command(player, args);
      if (result < 0) return fail(env, mpv_error_string(result));
      return ok(env);
    }
    int paused = name == "pause" ? 1 : 0;
    const int result = mpv_set_property(player, "pause", MPV_FORMAT_FLAG, &paused);
    if (result < 0) return fail(env, mpv_error_string(result));
    return ok(env);
  }
  if (name == "seek") {
    if (!getNamedValue(env, argv[0], "seconds", value)) return fail(env, "mpv video seek position is required");
    double seconds = 0;
    if (napi_get_value_double(env, value, &seconds) != napi_ok) return fail(env, "invalid mpv video seek position");
    std::string position = std::to_string(seconds);
    const char *args[] = {"seek", position.c_str(), "absolute", "exact", nullptr};
    const int result = mpv_command(player, args);
    if (result < 0) return fail(env, mpv_error_string(result));
    return ok(env);
  }
  return fail(env, "unsupported mpv video command");
}

napi_value setVolume(napi_env env, napi_callback_info info) {
  if (!player) return fail(env, "mpv video is not initialized");
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) return fail(env, "volume is required");
  double volume = 100;
  if (napi_get_value_double(env, argv[0], &volume) != napi_ok) return fail(env, "invalid volume");
  int result = mpv_set_property(player, "volume", MPV_FORMAT_DOUBLE, &volume);
  if (result < 0) return fail(env, mpv_error_string(result));
  return ok(env);
}

napi_value setAudioDevice(napi_env env, napi_callback_info info) {
  if (!player) return fail(env, "mpv video is not initialized");
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) return fail(env, "audio device is required");
  std::string device;
  if (!getString(env, argv[0], device)) return fail(env, "invalid audio device");
  if (device.empty()) device = "auto";
  const int result = mpv_set_property_string(player, "audio-device", device.c_str());
  if (result < 0) return fail(env, mpv_error_string(result));
  return ok(env);
}

napi_value getProperty(napi_env env, napi_callback_info info) {
  if (!player) return fail(env, "mpv video is not initialized");
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) return fail(env, "property is required");
  std::string property;
  if (!getString(env, argv[0], property)) return fail(env, "invalid property");
  napi_value result;
  if (property == "pause") {
    int paused = 1;
    if (mpv_get_property(player, "pause", MPV_FORMAT_FLAG, &paused) < 0) return fail(env, "mpv pause property failed");
    napi_get_boolean(env, paused != 0, &result);
  } else {
    double value = 0;
    if (mpv_get_property(player, property.c_str(), MPV_FORMAT_DOUBLE, &value) < 0) return fail(env, "mpv numeric property failed");
    napi_create_double(env, value, &result);
  }
  return result;
}

napi_value setBounds(napi_env env, napi_callback_info info) {
  if (!videoView) return ok(env);
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) return fail(env, "bounds are required");
  auto number = [&](const char *name, double fallback) {
    napi_value value;
    if (!getNamedValue(env, argv[0], name, value)) return fallback;
    double result = fallback;
    napi_get_value_double(env, value, &result);
    return result;
  };
  const CGFloat x = number("x", 0);
  const CGFloat y = number("y", 0);
  const CGFloat width = number("width", 0);
  const CGFloat height = number("height", 0);
  NSRect parentBounds = videoView.superview.bounds;
  videoView.frame = NSMakeRect(x, parentBounds.size.height - y - height, width, height);
  return ok(env);
}

napi_value setVisible(napi_env env, napi_callback_info info) {
  if (!videoView) return ok(env);
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 1) return fail(env, "visibility is required");
  bool visible = false;
  if (napi_get_value_bool(env, argv[0], &visible) != napi_ok) return fail(env, "invalid visibility");
  videoView.hidden = !visible;
  return ok(env);
}

napi_value poll(napi_env env, napi_callback_info info) {
  napi_value events;
  napi_create_array(env, &events);
  if (!player) return events;
  uint32_t index = 0;
  while (true) {
    mpv_event *event = mpv_wait_event(player, 0);
    if (!event || event->event_id == MPV_EVENT_NONE) break;
    napi_value item;
    napi_create_object(env, &item);
    const char *name = nullptr;
    double number = 0;
    bool hasNumber = false;
    bool flag = false;
    bool hasFlag = false;
    switch (event->event_id) {
      case MPV_EVENT_START_FILE:
        name = "start";
        break;
      case MPV_EVENT_FILE_LOADED:
        name = "loaded";
        if (!pendingAudioUrl.empty()) {
          const char *args[] = {"audio-add", pendingAudioUrl.c_str(), "select", nullptr};
          mpv_command(player, args);
        }
        break;
      case MPV_EVENT_END_FILE: {
        auto *end = static_cast<mpv_event_end_file *>(event->data);
        if (end && end->reason == MPV_END_FILE_REASON_EOF) name = "ended";
        else if (end && end->reason == MPV_END_FILE_REASON_ERROR) {
          name = "error";
          number = end->error;
          hasNumber = true;
        } else name = "stopped";
        break;
      }
      case MPV_EVENT_VIDEO_RECONFIG:
        name = "video-reconfig";
        break;
      case MPV_EVENT_SHUTDOWN:
        name = "shutdown";
        break;
      case MPV_EVENT_PROPERTY_CHANGE: {
        auto *property = static_cast<mpv_event_property *>(event->data);
        if (!property || !property->name || !property->data) break;
        if (std::strcmp(property->name, "time-pos") == 0 && property->format == MPV_FORMAT_DOUBLE) {
          name = "time";
          number = *static_cast<double *>(property->data);
          hasNumber = true;
        } else if (std::strcmp(property->name, "duration") == 0 && property->format == MPV_FORMAT_DOUBLE) {
          name = "duration";
          number = *static_cast<double *>(property->data);
          hasNumber = true;
        } else if (std::strcmp(property->name, "pause") == 0 && property->format == MPV_FORMAT_FLAG) {
          name = "pause";
          flag = *static_cast<int *>(property->data) != 0;
          hasFlag = true;
        }
        break;
      }
      default:
        break;
    }
    if (!name) continue;
    napi_value nameValue;
    napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &nameValue);
    napi_set_named_property(env, item, "name", nameValue);
    if (hasNumber) {
      napi_value numberValue;
      napi_create_double(env, number, &numberValue);
      napi_set_named_property(env, item, "value", numberValue);
    }
    if (hasFlag) {
      napi_value flagValue;
      napi_get_boolean(env, flag, &flagValue);
      napi_set_named_property(env, item, "value", flagValue);
    }
    napi_set_element(env, events, index++, item);
  }
  return events;
}

napi_value destroy(napi_env env, napi_callback_info info) {
  destroyPlayer();
  return ok(env);
}

napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"create", nullptr, create, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"load", nullptr, load, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"command", nullptr, command, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setVolume", nullptr, setVolume, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setAudioDevice", nullptr, setAudioDevice, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"getProperty", nullptr, getProperty, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setBounds", nullptr, setBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setVisible", nullptr, setVisible, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"poll", nullptr, poll, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"destroy", nullptr, destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

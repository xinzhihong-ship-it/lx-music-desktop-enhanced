#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>

#include <node_api.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <cstdio>

namespace {

constexpr wchar_t kWindowClassName[] = L"LXMusicMpvVideoHost";
HWND g_parent = nullptr;
HWND g_window = nullptr;

LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_ERASEBKGND) return 1;
  return DefWindowProcW(window, message, wParam, lParam);
}

bool throwLastError(napi_env env, const char* prefix) {
  const DWORD code = GetLastError();
  char message[128];
  std::snprintf(message, sizeof(message), "%s (Win32 error %lu)", prefix,
           static_cast<unsigned long>(code));
  napi_throw_error(env, nullptr, message);
  return false;
}

bool getBuffer(napi_env env, napi_value value, void** data, size_t* length) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) {
    napi_throw_type_error(env, nullptr, "parent handle must be a Buffer");
    return false;
  }
  if (napi_get_buffer_info(env, value, data, length) != napi_ok ||
      *length < sizeof(uint32_t)) {
    napi_throw_type_error(env, nullptr, "invalid native window handle");
    return false;
  }
  return true;
}

HWND readWindowHandle(void* data, size_t length) {
  uintptr_t raw = 0;
  std::memcpy(&raw, data, std::min(length, sizeof(raw)));
  return reinterpret_cast<HWND>(raw);
}

bool registerWindowClass(napi_env env) {
  WNDCLASSEXW windowClass{};
  windowClass.cbSize = sizeof(windowClass);
  windowClass.lpfnWndProc = windowProc;
  windowClass.hInstance = GetModuleHandleW(nullptr);
  windowClass.lpszClassName = kWindowClassName;
  windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  windowClass.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
  if (RegisterClassExW(&windowClass) != 0) return true;
  if (GetLastError() == ERROR_CLASS_ALREADY_EXISTS) return true;
  return throwLastError(env, "failed to register native video host window");
}

napi_value create(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, nullptr, "create requires a parent window handle");
    return nullptr;
  }

  void* data = nullptr;
  size_t length = 0;
  if (!getBuffer(env, argv[0], &data, &length)) return nullptr;
  HWND parent = readWindowHandle(data, length);
  if (!parent || !IsWindow(parent)) {
    napi_throw_error(env, nullptr, "parent window handle is not valid");
    return nullptr;
  }

  if (g_window && IsWindow(g_window) && g_parent == parent) {
    char handle[32];
    std::snprintf(handle, sizeof(handle), "%llu",
             static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(g_window)));
    napi_value result;
    napi_create_string_utf8(env, handle, NAPI_AUTO_LENGTH, &result);
    return result;
  }

  if (g_window && IsWindow(g_window)) DestroyWindow(g_window);
  g_window = nullptr;
  g_parent = parent;
  if (!registerWindowClass(env)) return nullptr;

  g_window = CreateWindowExW(
      WS_EX_NOACTIVATE,
      kWindowClassName,
      L"LX Music MPV Video Host",
      WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
      0,
      0,
      1,
      1,
      g_parent,
      nullptr,
      GetModuleHandleW(nullptr),
      nullptr);
  if (!g_window) {
    g_parent = nullptr;
    throwLastError(env, "failed to create native video host window");
    return nullptr;
  }

  char handle[32];
  std::snprintf(handle, sizeof(handle), "%llu",
           static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(g_window)));
  napi_value result;
  napi_create_string_utf8(env, handle, NAPI_AUTO_LENGTH, &result);
  return result;
}

bool getNumber(napi_env env, napi_value object, const char* name, double* result) {
  napi_value value;
  if (napi_get_named_property(env, object, name, &value) != napi_ok ||
      napi_get_value_double(env, value, result) != napi_ok) {
    napi_throw_type_error(env, nullptr, "bounds must contain numeric x, y, width, height");
    return false;
  }
  return true;
}

int getDpi(HWND window) {
  HDC dc = GetDC(window);
  if (!dc) return 96;
  const int dpi = GetDeviceCaps(dc, LOGPIXELSX);
  ReleaseDC(window, dc);
  return dpi > 0 ? dpi : 96;
}

napi_value setBounds(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, nullptr, "setBounds requires bounds");
    return nullptr;
  }
  if (!g_window || !IsWindow(g_window)) return nullptr;

  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  if (!getNumber(env, argv[0], "x", &x) || !getNumber(env, argv[0], "y", &y) ||
      !getNumber(env, argv[0], "width", &width) ||
      !getNumber(env, argv[0], "height", &height))
    return nullptr;

  const int dpi = getDpi(g_parent);
  const auto scale = [dpi](double value) {
    return static_cast<int>((value * dpi / 96.0) + (value >= 0 ? 0.5 : -0.5));
  };
  const int scaledWidth = std::max(1, scale(width));
  const int scaledHeight = std::max(1, scale(height));
  if (!SetWindowPos(g_window, HWND_TOP, scale(x), scale(y), scaledWidth,
                    scaledHeight, SWP_NOACTIVATE | SWP_NOSENDCHANGING))
    throwLastError(env, "failed to position native video host window");
  return nullptr;
}

napi_value setVisible(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc < 1) {
    napi_throw_type_error(env, nullptr, "setVisible requires a boolean");
    return nullptr;
  }
  if (!g_window || !IsWindow(g_window)) return nullptr;
  bool visible = false;
  if (napi_get_value_bool(env, argv[0], &visible) != napi_ok) {
    napi_throw_type_error(env, nullptr, "setVisible requires a boolean");
    return nullptr;
  }
  if (visible) {
    SetWindowPos(g_window, HWND_TOP, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  } else {
    ShowWindow(g_window, SW_HIDE);
  }
  return nullptr;
}

napi_value destroy(napi_env env, napi_callback_info info) {
  if (g_window && IsWindow(g_window)) DestroyWindow(g_window);
  g_window = nullptr;
  g_parent = nullptr;
  return nullptr;
}

}  // namespace

NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
      {"create", nullptr, create, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setBounds", nullptr, setBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setVisible", nullptr, setVisible, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"destroy", nullptr, destroy, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}
#endif

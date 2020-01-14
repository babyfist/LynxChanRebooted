#include <napi.h>
#include "captcha.h"
#include "imageBounds.h"
#include "videoBounds.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "buildCaptcha"),
      Napi::Function::New(env, buildCaptcha));
  exports.Set(Napi::String::New(env, "getImageBounds"),
      Napi::Function::New(env, getImageBounds));
  exports.Set(Napi::String::New(env, "getVideoBounds"),
      Napi::Function::New(env, getVideoBounds));
  return exports;
}

NODE_API_MODULE(native, Init)

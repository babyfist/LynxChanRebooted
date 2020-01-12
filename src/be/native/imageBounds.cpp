#include <Magick++.h>
#include "imageBounds.h"

class SizeWorker: public Napi::AsyncWorker {
public:
  SizeWorker(Napi::Function& callback, std::string path) :
      Napi::AsyncWorker(callback), path(path) {
  }
  ~SizeWorker() {
  }

  void Execute() {

    std::list < Magick::Image > frameList;

    try {
      readImages(&frameList, path);
    } catch (Magick::Exception exception) {
      error = exception.what();
      failed = true;
      return;
    }

    for (std::list<Magick::Image>::iterator it = frameList.begin();
        it != frameList.end(); it++) {

      Magick::Geometry dimensions = it->size();

      size_t currentWidth = dimensions.width();
      size_t currentHeight = dimensions.height();

      width = currentWidth > width ? currentWidth : width;
      height = currentHeight > height ? currentHeight : height;

    }

  }

  void OnOK() {
    Napi::HandleScope scope(Env());

    Callback().Call(
        { failed ? Napi::String::New(Env(), error) : Env().Undefined(),
            Napi::Number::New(Env(), width), Napi::Number::New(Env(), height) });

  }

private:
  std::string path, error;
  bool failed = false;
  size_t width = 0, height = 0;
};

Napi::Value getImageBounds(const Napi::CallbackInfo& args) {

  Napi::Env env = args.Env();

  Napi::Function callback = args[1].As<Napi::Function>();

  SizeWorker* sizeWorker = new SizeWorker(callback, args[0].As<Napi::String>());
  sizeWorker->Queue();

  return env.Undefined();

}

// Runs before the module bundle, including when that bundle cannot load or parse.
(function () {
  var ready = false;
  var failure = "";
  var timer;
  function show() {
    var panel = document.getElementById("startup");
    if (!panel) return;
    panel.style.display = "flex";
    document.getElementById("startup-message").textContent = "启动失败，请重新加载。";
    document.getElementById("startup-detail").textContent = failure;
    var retry = document.getElementById("startup-retry");
    retry.hidden = false;
    retry.onclick = function () { location.reload(); };
  }
  window.rallyStartup = {
    ready: function () {
      ready = true;
      clearTimeout(timer);
      document.getElementById("startup").style.display = "none";
    },
    fail: function (reason) {
      clearTimeout(timer);
      failure = String(reason || "未知启动错误").slice(0, 1500);
      show();
    }
  };
  window.addEventListener("error", function (event) {
    if (ready) return;
    var target = event.target;
    if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
      window.rallyStartup.fail("界面资源加载失败：" + (target.src || target.href).split("/").pop());
    } else if (event.message) window.rallyStartup.fail(event.message);
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    if (!ready) window.rallyStartup.fail(event.reason);
  });
  document.addEventListener("DOMContentLoaded", function () { if (failure) show(); });
  timer = setTimeout(function () {
    if (!ready) window.rallyStartup.fail("启动超时，请重新打开。若仍然失败，请检查 Android System WebView 是否可更新。");
  }, 90000);
})();

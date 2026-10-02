// 主視窗的大小和位置：第一次開啟最大化；之後記住上次關窗時的樣子（大小、位置、是否最大化），
// 存在 userData 下的 window-state.json。上次所在的顯示器拔掉了，就回到當前螢幕居中。
const { app, screen } = require("electron");
const fs = require("fs");
const path = require("path");

const file = () => path.join(app.getPath("userData"), "window-state.json");

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(file(), "utf8"));
    const b = s.bounds;
    if (!b || !(b.width > 0 && b.height > 0)) return { maximized: true };
    // 視窗至少有一部分落在某塊螢幕上才用記下的位置
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width && b.x + b.width > area.x && b.y < area.y + area.height && b.y + b.height > area.y;
    return { bounds: visible ? b : { width: b.width, height: b.height }, maximized: !!s.maximized };
  } catch (_) {
    return { maximized: true };  // 第一次開啟
  }
}

// 返回給 BrowserWindow 的尺寸選項；視窗建好後呼叫 track(win)
function options() {
  const s = load();
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    opts: s.bounds ? s.bounds : { width: Math.min(1440, area.width), height: Math.min(960, area.height) },
    maximized: s.maximized,
  };
}

function track(win) {
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    try {
      // 最大化時記最大化之前的大小，取消最大化後能回到原來那樣
      fs.writeFileSync(file(), JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch (_) {
      // 寫不進去就算了，下次按預設開啟
    }
  };
  win.on("close", save);
}

module.exports = { options, track };

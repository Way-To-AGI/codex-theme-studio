(async (control) => {
  const ID = "codex-theme-studio-switcher";
  const STYLE_ID = `${ID}-style`;
  const STATE_KEY = "__CODEX_THEME_STUDIO_SWITCHER_STATE__";
  window[STATE_KEY]?.cleanup?.();
  if (!control?.bridge || !document.body) return false;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${ID}{position:fixed;left:0;top:0;z-index:2147483000;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4f7fb;pointer-events:auto}
#${ID}[hidden],#${ID} [hidden]{display:none!important}
#${ID} .cts-switch-button{width:38px;height:38px;padding:0;border:1px solid #ffffff2b;border-radius:12px;background:#0b111ce8;color:#f5f8fc;box-shadow:0 12px 34px #0008;backdrop-filter:blur(18px);cursor:pointer;font-size:17px;line-height:1}
#${ID} .cts-switch-button:hover,#${ID} .cts-switch-button:focus-visible{border-color:#72e6ff99;background:#122335;outline:2px solid #72e6ff66;outline-offset:2px}
#${ID} .cts-switch-panel{position:absolute;right:0;bottom:46px;width:244px;padding:10px;border:1px solid #ffffff24;border-radius:15px;background:#08111df5;box-shadow:0 22px 64px #000c;backdrop-filter:blur(24px)}
#${ID}[data-panel-below="true"] .cts-switch-panel{top:46px;bottom:auto}
#${ID}[data-align="left"] .cts-switch-panel{left:0;right:auto}
#${ID} .cts-switch-title{display:flex;align-items:center;justify-content:space-between;padding:3px 6px 9px;color:#96a7ba;font-size:10px;font-weight:750;letter-spacing:.12em}
#${ID} .cts-switch-list{display:grid;gap:4px;max-height:260px;overflow:auto}
#${ID} .cts-switch-item,#${ID} .cts-switch-action{width:100%;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:#edf4f8;text-align:left;cursor:pointer;font-size:12px}
#${ID} .cts-switch-item:hover,#${ID} .cts-switch-item[aria-current="true"],#${ID} .cts-switch-action:hover{background:#72e6ff18}
#${ID} .cts-switch-item[aria-current="true"]{color:#8eeaff;font-weight:700}
#${ID} .cts-switch-footer{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:7px;padding-top:7px;border-top:1px solid #ffffff16}
#${ID} .cts-switch-action{color:#b9c7d6;text-align:center}.cts-switch-error{padding:7px;color:#ffabab;font-size:11px}
`;
  (document.head || document.documentElement).appendChild(style);
  const root = document.createElement("div");
  root.id = ID;
  root.hidden = true;
  const button = document.createElement("button");
  button.type = "button"; button.className = "cts-switch-button"; button.textContent = "◐";
  button.setAttribute("aria-label", "切换 Codex 主题 / Switch Codex theme"); button.setAttribute("aria-expanded", "false");
  const panel = document.createElement("div"); panel.className = "cts-switch-panel"; panel.hidden = true;
  const title = document.createElement("div"); title.className = "cts-switch-title";
  const titleText = document.createElement("span"); titleText.textContent = "CODEX THEMES";
  const current = document.createElement("span"); current.textContent = "—"; title.append(titleText, current);
  const list = document.createElement("div"); list.className = "cts-switch-list";
  const footer = document.createElement("div"); footer.className = "cts-switch-footer";
  const nativeButton = document.createElement("button"); nativeButton.type = "button"; nativeButton.className = "cts-switch-action"; nativeButton.textContent = "原生外观";
  const webButton = document.createElement("button"); webButton.type = "button"; webButton.className = "cts-switch-action"; webButton.textContent = "主题库 ↗";
  footer.append(nativeButton, webButton); panel.append(title, list, footer); root.append(button, panel); document.body.appendChild(root);

  const requests = [];
  const pending = new Map();
  let nextRequestId = 1;
  const request = (route, body) => new Promise((resolve, reject) => {
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Theme manager did not respond"));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    requests.push({ id, route, body: body ?? null });
  });
  const deliver = (id, result, error) => {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id); clearTimeout(entry.timer);
    if (error) entry.reject(new Error(error)); else entry.resolve(result);
    return true;
  };
  const showError = (error) => { list.replaceChildren(); const node = document.createElement("div"); node.className = "cts-switch-error"; node.textContent = error.message; list.append(node); };
  const render = async () => {
    try {
      const data = await request("themes"); list.replaceChildren(); current.textContent = data.activeTheme || "NATIVE";
      for (const item of data.themes) {
        const option = document.createElement("button"); option.type = "button"; option.className = "cts-switch-item";
        option.textContent = `${item.designedFor === "dark" ? "◐" : "◑"}  ${item.displayName}`;
        option.setAttribute("aria-current", String(item.id === data.activeTheme));
        option.addEventListener("click", async () => { option.disabled = true; try { await request("switch", { theme: item.id }); await render(); } catch (error) { showError(error); } });
        list.append(option);
      }
    } catch (error) { showError(error); }
  };
  button.addEventListener("click", async () => { panel.hidden = !panel.hidden; button.setAttribute("aria-expanded", String(!panel.hidden)); if (!panel.hidden) await render(); });
  nativeButton.addEventListener("click", async () => { try { await request("native", {}); panel.hidden = true; button.setAttribute("aria-expanded", "false"); } catch (error) { showError(error); } });
  webButton.addEventListener("click", () => request("open", {}).catch(showError));

  const visible = (node) => { const s = getComputedStyle(node); if (s.display === "none" || s.visibility === "hidden") return null; const r = node.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? r : null; };
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const place = () => {
    const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
    if (dialog || innerWidth < 760 || innerHeight < 540) { root.hidden = true; return; }
    const controls = [...document.querySelectorAll('button,a[href],input,textarea,select,[contenteditable="true"],[role="button"],[role="link"]')]
      .filter((node) => !root.contains(node) && !node.closest('#codex-theme-studio-decorations')).map(visible).filter(Boolean);
    const size = 38; const candidates = [
      { left: innerWidth - size - 18, top: innerHeight - size - 76, align: "right" },
      { left: 18, top: innerHeight - size - 76, align: "left" },
      { left: innerWidth - size - 18, top: 72, align: "right", below: true },
    ];
    const safe = candidates.find((p) => !controls.some((r) => overlaps({ ...p, right:p.left+size, bottom:p.top+size }, { left:r.left-7, top:r.top-7, right:r.right+7, bottom:r.bottom+7 })));
    if (!safe) { root.hidden = true; return; }
    root.style.left = `${safe.left}px`; root.style.top = `${safe.top}px`; root.dataset.align = safe.align; root.dataset.panelBelow = String(Boolean(safe.below)); root.hidden = false;
  };
  const close = (event) => { if (!root.contains(event.target)) { panel.hidden = true; button.setAttribute("aria-expanded", "false"); } };
  document.addEventListener("pointerdown", close, true); addEventListener("resize", place, { passive:true });
  const observer = new MutationObserver(() => queueMicrotask(place)); observer.observe(document.documentElement, { childList:true, subtree:true });
  const timer = setInterval(place, 3500);
  const cleanup = () => {
    observer.disconnect(); clearInterval(timer); removeEventListener("resize", place); document.removeEventListener("pointerdown", close, true);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Theme manager reloaded")); }
    pending.clear(); requests.length = 0; root.remove(); style.remove(); delete window[STATE_KEY]; return true;
  };
  window[STATE_KEY] = { cleanup, place, drainRequests: () => requests.splice(0), deliver }; place();
  return true;
})(__CTS_CONTROL_JSON__)

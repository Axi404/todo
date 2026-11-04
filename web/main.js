import { html, render } from "./vendor/preact-htm.js";
import { App } from "./components/App.js";

render(html`<${App} />`, document.getElementById("root"));
// On iPhone, the :active style of a pressed button only shows up when there is a touchstart listener
document.addEventListener("touchstart", () => {}, { passive: true });
